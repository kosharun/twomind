import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeJsonParse } from '../core/util.js';

/**
 * Connecting Twomind to each agent without stepping on the user's own
 * configuration. Claude uses project hooks. Codex uses its user-level
 * end-of-turn notification because project hooks need a separate trust step.
 *
 * Rules we hold ourselves to:
 *  - never overwrite an existing settings file; read, merge, write back
 *  - always keep a backup of whatever was there before (in .twomind/.local/)
 *  - our entries are identifiable (they run our `hook prompt|stop` subcommand)
 *    so we can find, replace or remove exactly ours and nothing else
 */

export type AgentId = 'claude' | 'codex';

export interface InstallResult {
  agent: AgentId;
  file: string;
  action: 'created' | 'updated' | 'already-installed';
  backup?: string;
  note?: string;
}

export interface CodexNotifyResult {
  file: string;
  action: 'created' | 'updated' | 'already-installed' | 'kept-existing';
  backup?: string;
  note?: string;
}

interface HookCommand {
  type: 'command';
  command: string;
  args?: string[];
  timeout?: number;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

interface HookSettings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

// Not the literal word "twomind": during development the CLI is invoked as
// ".../simplifycode/dist/cli.js", so that word never appears in the command.
// "hook prompt --agent" / "hook stop --agent" is unique to our subcommands
// regardless of install path or package name.
const MARKER = /\bhook (prompt|stop|tool) --agent\b/;

/**
 * A path written so no shell can break it.
 *
 * On Windows, Claude Code runs hook commands through Git Bash ("/usr/bin/bash
 * -c ..."). Bash treats "\" as an escape character, so an unquoted Windows path
 * like C:\Users\me\node.exe reaches it as "C:Usersmenode.exe" and the hook dies
 * with "command not found", every single time, silently. That is exactly what
 * happened here, and it is a known problem across many tools (anthropics/
 * claude-code#21878). Windows accepts forward slashes everywhere, and no shell
 * treats "/" as special, so we always write those. Quotes only when a path has
 * spaces, which bash needs.
 */
function shellSafePath(p: string): string {
  const forward = p.replace(/\\/g, '/');
  return /\s/.test(forward) ? `"${forward}"` : forward;
}

/** Absolute invocation of this CLI, safe to paste into a hook config. */
export function selfCommand(subcommand: string): string {
  const cli = selfCliPath();
  return `${shellSafePath(process.execPath)} ${shellSafePath(cli)} ${subcommand}`;
}

function selfCliPath(): string {
  const here = fileURLToPath(import.meta.url);
  // dist/adapters/install.js -> dist/cli.js
  return path.resolve(path.dirname(here), '..', 'cli.js');
}

/** argv form used by Codex's user-level `notify` setting. */
export function selfCommandArgs(...args: string[]): string[] {
  return [process.execPath, selfCliPath(), ...args];
}

function codexConfigFile(): string {
  const codexHome = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(homedir(), '.codex');
  return path.join(codexHome, 'config.toml');
}

function lineEndingOf(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function firstTableIndex(text: string): number {
  const match = /^[ \t]*\[{1,2}[^\r\n]+/m.exec(text);
  return match?.index ?? text.length;
}

function topLevelNotifyMatch(text: string): RegExpExecArray | null {
  const beforeTables = text.slice(0, firstTableIndex(text));
  return /^[ \t]*notify[ \t]*=[^\r\n]*(?:\r?\n|$)/m.exec(beforeTables);
}

function isOurCodexNotify(text: string): boolean {
  return /["']notify["'][ \t]*,[ \t]*["']codex["']/.test(text) && /cli\.js/.test(text);
}

function tomlStringArray(values: string[]): string {
  // JSON basic strings are valid TOML basic strings for these paths and words.
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

function parseNotifyCommand(assignment: string): string[] | null {
  const equals = assignment.indexOf('=');
  if (equals === -1) return null;
  try {
    const value = JSON.parse(assignment.slice(equals + 1).trim()) as unknown;
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value
      : null;
  } catch {
    return null;
  }
}

function previousNotify(command: string[]): string[] {
  const marker = command.indexOf('--then');
  return marker === -1 ? [] : command.slice(marker + 1);
}

/**
 * Connect the Codex VS Code extension through its supported end-of-turn
 * notification. Unlike project hooks, this does not need hook trust.
 */
export function installCodexNotify(root: string): CodexNotifyResult {
  const file = codexConfigFile();
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const found = topLevelNotifyMatch(existing);
  const currentCommand = found ? parseNotifyCommand(found[0]) : null;

  if (found && !currentCommand) {
    return {
      file,
      action: 'kept-existing',
      note: 'You already have a Codex end-of-turn command that Twomind could not safely read, so it was left alone. Automatic Codex stories are off. You can use "twomind record" by hand.',
    };
  }

  const oldCommand = currentCommand
    ? isOurCodexNotify(found?.[0] ?? '')
      ? previousNotify(currentCommand)
      : currentCommand
    : [];
  const command = [
    ...selfCommandArgs('notify', 'codex'),
    ...(oldCommand.length ? ['--then', ...oldCommand] : []),
  ];
  const desired = `notify = ${tomlStringArray(command)}`;

  const newline = lineEndingOf(existing);
  let next: string;
  let action: CodexNotifyResult['action'];
  if (found) {
    const old = found[0].replace(/\r?\n$/, '');
    if (old.trim() === desired) return { file, action: 'already-installed' };
    next = existing.slice(0, found.index) + desired + (found[0].endsWith('\n') ? newline : '') + existing.slice(found.index + found[0].length);
    action = 'updated';
  } else {
    const at = firstTableIndex(existing);
    const before = existing.slice(0, at);
    const after = existing.slice(at);
    const prefix = before.length > 0 && !before.endsWith('\n') ? newline : '';
    const suffix = after.length > 0 ? newline : '';
    next = `${before}${prefix}${desired}${newline}${suffix}${after}`;
    action = existing ? 'updated' : 'created';
  }

  const bak = existing ? backup(root, file) : undefined;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, next, 'utf8');
  return {
    file,
    action,
    backup: bak,
    note: oldCommand.length
      ? 'Twomind kept your existing Codex end-of-turn command and will run it after saving the story.'
      : undefined,
  };
}

export function codexNotifyInstalled(): boolean {
  const file = codexConfigFile();
  if (!existsSync(file)) return false;
  const found = topLevelNotifyMatch(readFileSync(file, 'utf8'));
  return Boolean(found && isOurCodexNotify(found[0]));
}

/** Remove only Twomind's user-level Codex notification, never another one. */
export function uninstallCodexNotify(): CodexNotifyResult | null {
  const file = codexConfigFile();
  if (!existsSync(file)) return null;
  const existing = readFileSync(file, 'utf8');
  const found = topLevelNotifyMatch(existing);
  if (!found || !isOurCodexNotify(found[0])) return null;
  const command = parseNotifyCommand(found[0]) ?? [];
  const oldCommand = previousNotify(command);
  const newline = lineEndingOf(existing);
  const replacement = oldCommand.length
    ? `notify = ${tomlStringArray(oldCommand)}${found[0].endsWith('\n') ? newline : ''}`
    : '';
  const next = existing.slice(0, found.index) + replacement + existing.slice(found.index + found[0].length);
  writeFileSync(file, next, 'utf8');
  return { file, action: 'updated' };
}

function agentFile(root: string, agent: AgentId): string {
  return agent === 'claude'
    ? path.join(root, '.claude', 'settings.json')
    : path.join(root, '.codex', 'hooks.json');
}

/**
 * Backups live inside .twomind/.local/, never next to the file they back up.
 *
 * They used to sit right beside settings.json as `settings.json.bak-<time>`.
 * That put a brand-new, untracked file straight into the working tree at
 * exactly the moment a diagnostic capture might run. Being new, config-
 * shaped, and 24 lines long, it scored higher than a real one-line edit and
 * won "Start here". Putting backups under `.twomind/.local/` means they are
 * gitignored AND already excluded from every diff twomind ever takes, so this
 * whole failure mode is structurally impossible rather than separately guarded.
 */
function backup(root: string, file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const dir = path.join(root, '.twomind', '.local', 'backups');
    mkdirSync(dir, { recursive: true });
    const bak = path.join(dir, `${path.basename(file)}.bak-${Date.now()}`);
    copyFileSync(file, bak);
    return bak;
  } catch {
    return undefined;
  }
}

/** Exported so every other command checks "is this hook ours?" the same way. */
export function isOurHookCommand(command: string | undefined, args: string[] = []): boolean {
  return MARKER.test([command ?? '', ...args].join(' '));
}

function hasOurHook(entries: HookMatcher[] | undefined): boolean {
  if (!entries) return false;
  return entries.some((entry) => (entry.hooks ?? []).some((h) => isOurHookCommand(h.command, h.args)));
}

function stripOurHooks(entries: HookMatcher[] | undefined): HookMatcher[] {
  if (!entries) return [];
  return entries
    .map((entry) => ({ ...entry, hooks: (entry.hooks ?? []).filter((h) => !isOurHookCommand(h.command, h.args)) }))
    .filter((entry) => (entry.hooks ?? []).length > 0);
}

/**
 * Claude accepts an executable plus an argument list. This avoids asking a
 * shell to split a long command string, so paths with spaces and Windows path
 * rules cannot change what gets executed.
 */
function hookCommand(event: 'prompt' | 'stop', agent: AgentId): HookCommand {
  return {
    type: 'command',
    command: process.execPath,
    args: [selfCliPath(), 'hook', event, '--agent', agent],
    timeout: 30,
  };
}

export function installHooks(root: string, agent: AgentId): InstallResult {
  const file = agentFile(root, agent);
  mkdirSync(path.dirname(file), { recursive: true });

  const existingRaw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const settings = existingRaw ? safeJsonParse<HookSettings>(existingRaw, {}) : {};

  settings.hooks = settings.hooks ?? {};

  const alreadyInstalled =
    hasOurHook(settings.hooks.UserPromptSubmit) && hasOurHook(settings.hooks.Stop);

  // Replace any previous version of our hooks, keep everyone else's untouched.
  const promptEntries = stripOurHooks(settings.hooks.UserPromptSubmit);
  const stopEntries = stripOurHooks(settings.hooks.Stop);
  const preToolEntries = stripOurHooks(settings.hooks.PreToolUse);
  const postToolEntries = stripOurHooks(settings.hooks.PostToolUse);

  promptEntries.push({ hooks: [hookCommand('prompt', agent)] });
  stopEntries.push({ hooks: [hookCommand('stop', agent)] });

  settings.hooks.UserPromptSubmit = promptEntries;
  settings.hooks.Stop = stopEntries;

  // Older installs added PreToolUse/PostToolUse diagnostic hooks. Those were
  // only for finding the Git Bash path bug; strip them, and drop the event
  // entirely when nothing of the user's own is left in it.
  for (const event of ['PreToolUse', 'PostToolUse'] as const) {
    const remaining = event === 'PreToolUse' ? preToolEntries : postToolEntries;
    if (remaining.length) settings.hooks[event] = remaining;
    else delete settings.hooks[event];
  }

  const bak = existingRaw ? backup(root, file) : undefined;
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  return {
    agent,
    file,
    action: existingRaw ? (alreadyInstalled ? 'already-installed' : 'updated') : 'created',
    backup: bak,
  };
}

export function uninstallHooks(root: string, agent: AgentId): InstallResult | null {
  const file = agentFile(root, agent);
  if (!existsSync(file)) return null;

  const settings = safeJsonParse<HookSettings>(readFileSync(file, 'utf8'), {});
  if (!settings.hooks) return null;

  const bak = backup(root, file);
  for (const event of Object.keys(settings.hooks)) {
    const cleaned = stripOurHooks(settings.hooks[event]);
    if (cleaned.length) settings.hooks[event] = cleaned;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { agent, file, action: 'updated', backup: bak };
}

export function detectAgents(root: string): AgentId[] {
  const found: AgentId[] = [];
  if (existsSync(path.join(root, '.claude')) || existsSync(path.join(root, 'CLAUDE.md'))) found.push('claude');
  if (existsSync(path.join(root, '.codex')) || existsSync(path.join(root, 'AGENTS.md'))) found.push('codex');
  return found;
}

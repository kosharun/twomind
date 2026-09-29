import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeJsonParse } from '../core/util.js';

/**
 * Installing our capture hooks into each agent, without stepping on the user's
 * own configuration.
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

interface HookCommand {
  type: 'command';
  command: string;
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
  const here = fileURLToPath(import.meta.url);
  // dist/adapters/install.js -> dist/cli.js
  const cli = path.resolve(path.dirname(here), '..', 'cli.js');
  return `${shellSafePath(process.execPath)} ${shellSafePath(cli)} ${subcommand}`;
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
export function isOurHookCommand(command: string | undefined): boolean {
  return MARKER.test(command ?? '');
}

function hasOurHook(entries: HookMatcher[] | undefined): boolean {
  if (!entries) return false;
  return entries.some((entry) => (entry.hooks ?? []).some((h) => isOurHookCommand(h.command)));
}

function stripOurHooks(entries: HookMatcher[] | undefined): HookMatcher[] {
  if (!entries) return [];
  return entries
    .map((entry) => ({ ...entry, hooks: (entry.hooks ?? []).filter((h) => !isOurHookCommand(h.command)) }))
    .filter((entry) => (entry.hooks ?? []).length > 0);
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

  promptEntries.push({ hooks: [{ type: 'command', command: selfCommand(`hook prompt --agent ${agent}`) }] });
  stopEntries.push({ hooks: [{ type: 'command', command: selfCommand(`hook stop --agent ${agent}`) }] });

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
    note:
      agent === 'codex'
        ? 'Codex asks you to trust project hooks before they run. Open Codex and run /hooks once.'
        : undefined,
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

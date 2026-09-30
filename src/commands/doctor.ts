import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { codexNotifyInstalled, isOurHookCommand } from '../adapters/install.js';
import { loadConfig } from '../core/config.js';
import { FALLBACK_FILE } from '../core/debuglog.js';
import { findProjectRoot, isInitialised, resolveProjectPaths } from '../core/paths.js';
import { isGitRepo, takeSnapshot } from '../core/snapshot.js';
import { listStories } from '../core/story.js';
import { safeJsonParse } from '../core/util.js';

const c = {
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  yellow: (s: string) => `\u001b[33m${s}\u001b[0m`,
  red: (s: string) => `\u001b[31m${s}\u001b[0m`,
  cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
};

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

function ourHookCommands(file: string): string[] {
  if (!existsSync(file)) return [];
  const settings = safeJsonParse<any>(readFileSync(file, 'utf8'), {});
  const events = settings?.hooks ?? {};
  const listed = [...(events.UserPromptSubmit ?? []), ...(events.Stop ?? [])];
  return listed
    .flatMap((entry: any) => entry.hooks ?? [])
    .map((h: any) => String(h.command ?? ''))
    .filter((command: string) => isOurHookCommand(command));
}

function hookInstalled(file: string): boolean {
  return ourHookCommands(file).length > 0;
}

/**
 * Claude Code runs hooks through Git Bash on Windows, and bash eats "\".
 * A hook command with a backslash in it dies with "command not found" every
 * time, silently. This is the bug that hid every story at first.
 */
function hookSafeForBash(file: string): boolean {
  return ourHookCommands(file).every((command) => !command.includes('\\'));
}

/** Why isn't it capturing? Answer that in one command. */
export async function doctor(cwd = process.cwd()): Promise<void> {
  const root = await findProjectRoot(cwd);
  const checks: Check[] = [];

  console.log('');
  console.log(`  ${c.bold('twomind doctor')}  ${c.dim(root)}`);
  console.log('');

  const gitOk = await isGitRepo(root);
  checks.push({
    name: 'git repository',
    ok: gitOk,
    detail: gitOk ? 'found' : 'not a git repository',
    fix: 'Run "git init". Twomind uses git to see exactly what each prompt changed.',
  });

  const initialised = isInitialised(root);
  checks.push({
    name: 'project set up',
    ok: initialised,
    detail: initialised ? '.twomind/config.json found' : 'not set up here',
    fix: 'Run "twomind init".',
  });

  if (gitOk) {
    const { snapshots } = resolveProjectPaths(root);
    const tree = await takeSnapshot(root, snapshots);
    checks.push({
      name: 'snapshots',
      ok: Boolean(tree),
      detail: tree ? `working tree captured (${tree.slice(0, 8)})` : 'could not capture the working tree',
      fix: 'A merge or rebase in progress will block this. Finish or abort it, then try again.',
    });
  }

  const claudeFile = path.join(root, '.claude', 'settings.json');
  const codexFile = path.join(root, '.codex', 'hooks.json');
  const claudeOk = hookInstalled(claudeFile);
  const oldCodexHooks = hookInstalled(codexFile);
  const codexOk = codexNotifyInstalled();

  checks.push({
    name: 'Claude Code hooks',
    ok: claudeOk,
    detail: claudeOk ? 'installed' : 'not installed',
    fix: 'Run "twomind refresh" to install them.',
  });
  checks.push({
    name: 'Codex extension save',
    ok: codexOk,
    detail: codexOk ? 'end-of-turn command installed' : 'not installed',
    fix: 'Run "twomind refresh". You do not need the separate Codex terminal app.',
  });

  if (claudeOk || oldCodexHooks) {
    const safe = hookSafeForBash(claudeFile) && hookSafeForBash(codexFile);
    checks.push({
      name: 'hook paths',
      ok: safe,
      detail: safe ? 'written with "/", safe for Git Bash' : 'contain "\\", Git Bash breaks these',
      fix: 'Run "twomind refresh" to rewrite them.',
    });
  }

  const claudeMd = path.join(root, 'CLAUDE.md');
  const agentsMd = path.join(root, 'AGENTS.md');
  const importsAgents =
    existsSync(claudeMd) && /^\s*@\.?\/?AGENTS\.md\s*$/im.test(readFileSync(claudeMd, 'utf8'));
  checks.push({
    name: 'agent instructions',
    ok: existsSync(agentsMd) && importsAgents,
    detail: importsAgents ? 'CLAUDE.md reads AGENTS.md' : 'CLAUDE.md does not import AGENTS.md',
    fix: 'Run "twomind refresh".',
  });

  if (initialised) {
    const config = loadConfig(root);
    const stories = listStories(root);
    checks.push({
      name: 'captured changes',
      ok: stories.length > 0,
      detail: stories.length ? `${stories.length} stored` : 'none yet',
      fix: 'Run a prompt that changes a file, then check again.',
    });
    if (config) {
      const { local } = resolveProjectPaths(root);
      const pendingDir = path.join(local, 'pending');
      const waiting = existsSync(pendingDir);
      checks.push({
        name: 'pending capture',
        ok: true,
        detail: waiting ? 'a session snapshot is waiting for its Stop event' : 'nothing in flight',
      });
    }
  }

  for (const check of checks) {
    const mark = check.ok ? c.green('ok  ') : c.red('fail');
    console.log(`  ${mark} ${check.name.padEnd(20)} ${c.dim(check.detail)}`);
    if (!check.ok && check.fix) console.log(`       ${c.yellow('→')} ${check.fix}`);
  }

  console.log('');
  const failing = checks.filter((check) => !check.ok);
  if (failing.length === 0) {
    console.log(`  ${c.green('Everything is wired up.')}`);
  } else {
    console.log(`  ${failing.length} thing${failing.length === 1 ? '' : 's'} to fix, listed above.`);
  }
  console.log('');
  console.log(c.dim('  Note: if Codex was already open when you ran init or refresh, reload VS Code once.'));
  console.log('');
  console.log(c.dim(`  Hook activity log: ${path.join(root, '.twomind', '.local', 'hook.log')}`));
  console.log(c.dim(`  Fallback log (used even if the project could not be found): ${FALLBACK_FILE}`));
  console.log('');
}

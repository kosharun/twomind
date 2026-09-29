#!/usr/bin/env node
import path from 'node:path';
import { loadConfig } from './core/config.js';
import { findProjectRoot, isInitialised } from './core/paths.js';
import { ensureClaudeImport, managedBlock, upsertManagedBlock } from './core/brain.js';
import { hookPrompt, hookStop } from './commands/hook.js';
import { init } from './commands/init.js';
import { score } from './commands/score.js';
import { doctor } from './commands/doctor.js';
import { backfillFromGit } from './commands/backfill.js';
import { ensureStartingPoint, recordNow } from './commands/record.js';
import { serve } from './web/server.js';
import { installHooks, selfCommand, uninstallHooks } from './adapters/install.js';

const VERSION = '0.1.0';

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function value(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return args[index + 1];
}

function help(): void {
  const c = {
    bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
    dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
    cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
  };
  console.log(`
  ${c.bold('twomind')} ${c.dim(`v${VERSION}`)}
  ${c.dim('Your AI remembers how you build. You remember what it built, and why.')}

  ${c.bold('Commands')}
    ${c.cyan('init')}              set up this project and connect your agents
      ${c.dim('--yes')}             skip the questions, accept every suggestion
      ${c.dim('--backfill <n>')}    also turn the last n commits into (unexplained) stories

    ${c.cyan('serve')}             open the dashboard
      ${c.dim('--port <n>')}        port to listen on
      ${c.dim('--no-open')}         do not launch a browser

    ${c.cyan('record')}            save a story now, using the agent's note
                      ${c.dim('(for agents without a Twomind hook)')}
    ${c.cyan('refresh')}           update hooks and agent instructions after upgrading
    ${c.cyan('doctor')}            check why capture is not working
    ${c.cyan('score')}             rate any repository, nothing installed needed
    ${c.cyan('backfill')}          turn recent commits into (unexplained) stories
      ${c.dim('--limit <n>')}       how many commits to read (default 25)

    ${c.cyan('uninstall')}         remove our hooks, leave everything else alone

  ${c.bold('Try it')}
    ${c.dim('$')} twomind init
    ${c.dim('$')} twomind serve
`);
}

async function requireProject(): Promise<string | null> {
  const root = await findProjectRoot();
  if (isInitialised(root)) return root;
  console.log('\n  This project is not set up yet. Run "twomind init" first.\n');
  process.exitCode = 1;
  return null;
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case 'hook': {
      // Runs inside the agent. Must never exit non-zero or print anything
      // except the JSON a Stop hook deliberately returns.
      const agent = value(args, 'agent') ?? 'agent';
      if (args[0] === 'prompt') await hookPrompt(agent);
      else if (args[0] === 'stop') await hookStop(agent);
      return;
    }

    case 'init':
      await init({
        yes: flag(args, 'yes'),
        // Off by default: commit history has no agent explanation, and a story
        // without one is not what Twomind is for.
        backfill: Number(value(args, 'backfill') ?? 0),
      });
      return;

    case 'serve': {
      const root = await requireProject();
      if (!root) return;
      const config = loadConfig(root);
      await serve({
        root,
        port: Number(value(args, 'port') ?? config?.dashboard.port ?? 4317),
        open: !flag(args, 'no-open'),
      });
      return;
    }

    case 'record': {
      const root = await requireProject();
      if (!root) return;
      console.log(`\n  ${await recordNow(root)}\n`);
      return;
    }

    case 'refresh':
    case 'reinstall-hooks': {
      // Rewrites only what Twomind owns: our hook entries and our AGENTS.md
      // block. No interview, and nothing of the user's own is touched.
      const root = await requireProject();
      if (!root) return;
      for (const agent of ['claude', 'codex'] as const) {
        const result = installHooks(root, agent);
        console.log(`  hooks      ${agent.padEnd(7)} ${path.relative(root, result.file)}`);
      }
      const block = upsertManagedBlock(path.join(root, 'AGENTS.md'), managedBlock(selfCommand('record')));
      console.log(`  AGENTS.md  ${block}`);
      console.log(`  CLAUDE.md  ${ensureClaudeImport(root)}`);
      await ensureStartingPoint(root);
      console.log('\n  Now restart the agent (Ctrl+Shift+P → "Reload Window" in VS Code) so it loads the new hooks.\n');
      return;
    }

    case 'score':
      await score();
      return;

    case 'doctor':
      await doctor();
      return;

    case 'backfill': {
      const root = await requireProject();
      if (!root) return;
      const made = await backfillFromGit(root, Number(value(args, 'limit') ?? 25));
      console.log(`\n  ${made} stories written from recent commits (no agent explanation).\n`);
      return;
    }

    case 'uninstall': {
      const root = await findProjectRoot();
      for (const agent of ['claude', 'codex'] as const) {
        const result = uninstallHooks(root, agent);
        if (result) console.log(`  removed our hooks from ${result.file}`);
      }
      console.log('\n  Your .twomind folder was left in place. Delete it by hand if you want it gone.\n');
      return;
    }

    case '--version':
    case '-v':
      console.log(VERSION);
      return;

    default:
      help();
  }
}

main().catch((err) => {
  // Hooks swallow their own errors; anything reaching here is a real CLI fault.
  console.error(`\n  twomind: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});

import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { detectAgents, installHooks, selfCommand, type AgentId } from '../adapters/install.js';
import {
  emptyAnswers,
  ensureClaudeImport,
  managedBlock,
  upsertManagedBlock,
  writeBrain,
  type InterviewAnswers,
} from '../core/brain.js';
import { ensureStartingPoint } from './record.js';
import { defaultConfig, saveConfig } from '../core/config.js';
import { ensureDirs, findProjectRoot, isInitialised, resolveProjectPaths } from '../core/paths.js';
import { scanProject } from '../core/scan.js';
import { isGitRepo } from '../core/snapshot.js';
import { backfillFromGit } from './backfill.js';
import { estimateTokens } from '../core/util.js';

const c = {
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
  yellow: (s: string) => `\u001b[33m${s}\u001b[0m`,
};

interface Question {
  key: keyof InterviewAnswers;
  ask: string;
  why: string;
  suggestion: string;
}

/**
 * The "Core 12".
 *
 * Long setup interviews do not get finished — survey data shows people start
 * rushing after about 30 questions and abandon past 7–8 minutes. So this asks
 * twelve things, pre-fills every answer from the scan, and lets you press Enter
 * to accept or `s` to skip. The rest of what a project needs to know is learned
 * later, in the moment, while you actually work.
 */
function buildQuestions(scan: ReturnType<typeof scanProject>): Question[] {
  const stack = [...scan.frameworks, ...scan.databases].join(' + ') || scan.languages.join(' + ');
  const folders = scan.topFolders.slice(0, 4).join(', ');

  return [
    {
      key: 'summary',
      ask: 'What does this project do, in one sentence?',
      why: 'Every agent session starts by reading this.',
      suggestion: scan.description || '',
    },
    {
      key: 'stage',
      ask: 'What stage is it at? (prototype / MVP / live users / live with money or sensitive data)',
      why: 'Decides how careful agents should be by default.',
      suggestion: scan.hasGit ? 'live users' : 'prototype',
    },
    {
      key: 'importantAreas',
      ask: 'Which parts are most important or most risky?',
      why: 'Changes there get flagged for you first.',
      suggestion: folders,
    },
    {
      key: 'neverWithoutAsking',
      ask: 'What should an AI never do without asking you first?',
      why: 'This becomes a hard rule every agent reads.',
      suggestion: 'push or deploy, change the database schema or data, change money or auth logic, add a new dependency, delete files',
    },
    {
      key: 'autonomy',
      ask: 'How much should the AI decide on its own for normal tasks?',
      why: 'Stops it asking about everything, or about nothing.',
      suggestion: 'Inspect the code first, then just do normal tasks. Explain the plan and wait for approval on anything risky.',
    },
    {
      key: 'conventions',
      ask: `Style rules worth writing down? (detected stack: ${stack || 'unknown'})`,
      why: 'Keeps new code looking like your existing code.',
      suggestion: 'Match the style of the file being changed. Keep files small and focused — split rather than growing one big file.',
    },
    {
      key: 'sharedCodeLocation',
      ask: 'Where do shared helpers and components live?',
      why: 'This is what stops the AI writing a second copy of something you already have.',
      suggestion: scan.topFolders.filter((f) => /^(lib|utils?|helpers?|shared|common|components?)$/i.test(f)).join(', '),
    },
    {
      key: 'testingRules',
      ask: 'What must be tested before something is "done"? Anything that must never run?',
      why: 'Agents will claim things are tested. This sets the bar.',
      suggestion: scan.testCommand ? `Run ${scan.testCommand} for the changed area.` : '',
    },
    {
      key: 'petPeeves',
      ask: 'What has annoyed you most in past AI sessions?',
      why: 'The most valuable rules usually come from real irritation.',
      suggestion: '',
    },
    {
      key: 'deepAreas',
      ask: 'Which parts do you want to properly understand yourself?',
      why: 'Those get fuller explanations and are tracked in your familiarity view.',
      suggestion: '',
    },
    {
      key: 'explanationStyle',
      ask: 'How should explanations be written for you?',
      why: 'Saved to your personal profile, shared across all your projects.',
      suggestion: 'Plain English, short sentences, say what changed and how to test it.',
    },
    {
      key: 'closeness',
      ask: 'How close do you want to stay to the code? (summaries only / summaries plus key diffs / full diffs)',
      why: 'Controls how much each story shows by default.',
      suggestion: 'summaries plus key diffs',
    },
  ];
}

async function runInterview(scan: ReturnType<typeof scanProject>): Promise<InterviewAnswers> {
  const answers = emptyAnswers();
  const questions = buildQuestions(scan);
  const rl = readline.createInterface({ input, output });

  console.log('');
  console.log(c.bold('  Twelve quick questions.'));
  console.log(c.dim('  Enter accepts the suggestion · type your own · "s" skips · "q" stops asking'));
  console.log('');

  try {
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      console.log(c.cyan(`  ${i + 1}/${questions.length}  ${q.ask}`));
      console.log(c.dim(`        ${q.why}`));
      if (q.suggestion) console.log(c.dim(`        suggested: ${q.suggestion}`));

      const reply = (await rl.question('        > ')).trim();
      console.log('');

      if (reply.toLowerCase() === 'q') break;
      if (reply.toLowerCase() === 's') continue;
      answers[q.key] = reply || q.suggestion;
    }
  } finally {
    rl.close();
  }

  return answers;
}

function defaultAnswers(scan: ReturnType<typeof scanProject>): InterviewAnswers {
  const answers = emptyAnswers();
  for (const q of buildQuestions(scan)) {
    answers[q.key] = q.suggestion;
  }
  return answers;
}

export interface InitOptions {
  yes: boolean;
  backfill: number;
  cwd?: string;
}

export async function init(options: InitOptions): Promise<void> {
  const root = await findProjectRoot(options.cwd ?? process.cwd());
  const already = isInitialised(root);

  console.log('');
  console.log(c.bold('  twomind') + c.dim('  ·  two-way memory for AI coding'));
  console.log(c.dim(`  ${root}`));
  console.log('');

  if (!(await isGitRepo(root))) {
    console.log(c.yellow('  ! This is not a git repository.'));
    console.log(c.dim('    Twomind uses git to see exactly what each prompt changed.'));
    console.log(c.dim('    Run "git init" first, then run this again.'));
    console.log('');
    return;
  }

  // Detect agents BEFORE we write anything, otherwise our own AGENTS.md
  // would look like evidence that the user already uses Codex.
  const detected = detectAgents(root);

  const scan = scanProject(root);
  console.log(c.bold('  What I found'));
  console.log(`    languages   ${scan.languages.join(', ') || 'unknown'}`);
  console.log(`    frameworks  ${scan.frameworks.join(', ') || 'none detected'}`);
  console.log(`    data        ${scan.databases.join(', ') || 'none detected'}`);
  if (scan.contextFiles.length) {
    console.log(
      `    AI files    ${scan.contextFiles.length} found, about ${scan.contextTokens.toLocaleString()} tokens read before every task`
    );
    if (scan.contextTokens > 6000) {
      console.log(c.dim('                that is a lot — Twomind can help shrink it later'));
    }
  }
  console.log('');

  const answers = options.yes ? defaultAnswers(scan) : await runInterview(scan);

  const paths = resolveProjectPaths(root);
  ensureDirs(paths);

  const config = defaultConfig(scan.name);
  config.summary = answers.summary;
  saveConfig(root, config);

  const written = writeBrain(root, scan, answers);
  const createdCount = written.filter((w) => w.action === 'created').length;
  const keptCount = written.filter((w) => w.action === 'kept').length;

  console.log(c.bold('  Wrote'));
  console.log(`    ${c.green(String(createdCount))} new files in .twomind/${keptCount ? c.dim(`  (${keptCount} already existed, left alone)`) : ''}`);

  const agentsFile = path.join(root, 'AGENTS.md');
  const blockAction = upsertManagedBlock(agentsFile, managedBlock(selfCommand('record')));
  console.log(`    AGENTS.md ${blockAction === 'created' ? 'created' : `${blockAction} (only our block)`}`);
  const claudeAction = ensureClaudeImport(root);
  if (claudeAction !== 'present') {
    console.log(`    CLAUDE.md ${claudeAction === 'created' ? 'created' : 'updated'} (so Claude Code always reads AGENTS.md)`);
  }
  await ensureStartingPoint(root);

  const targets: AgentId[] = detected.length ? detected : ['claude', 'codex'];
  console.log('');
  console.log(c.bold('  Connected agents'));
  for (const agent of targets) {
    const result = installHooks(root, agent);
    const label = agent === 'claude' ? 'Claude Code' : 'Codex';
    console.log(`    ${c.green('ok')}  ${label.padEnd(12)} ${c.dim(path.relative(root, result.file))}`);
    if (result.backup) console.log(c.dim(`        your previous settings were backed up`));
    if (result.note) console.log(c.yellow(`        ${result.note}`));
  }

  if (options.backfill > 0) {
    console.log('');
    console.log(c.bold('  Reading your recent history'));
    const made = await backfillFromGit(root, options.backfill);
    console.log(`    ${c.green(String(made))} stories written from your last commits`);
    console.log(c.dim('    so the dashboard is useful before your next prompt'));
  }

  console.log('');
  console.log(c.bold('  Next'));
  console.log(`    ${c.cyan('twomind serve')}    open the dashboard`);
  console.log(c.dim('    then just work normally — every prompt that changes files becomes a story'));
  console.log('');

  if (already) {
    console.log(c.dim('  (this project was already set up — settings and hooks were refreshed)'));
    console.log('');
  }
}

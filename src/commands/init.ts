import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  detectAgents,
  installCodexNotify,
  installHooks,
  uninstallHooks,
  type AgentId,
} from '../adapters/install.js';
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

export interface Question {
  key: keyof InterviewAnswers;
  ask: string;
  why: string;
  suggestion: string;
}

/**
 * The "Core 12".
 *
 * Long setup interviews do not get finished: survey data shows people start
 * rushing after about 30 questions and abandon past 7 or 8 minutes. So this asks
 * twelve things, pre-fills every answer from the scan, and lets you press Enter
 * to accept or `s` to skip. The rest of what a project needs to know is learned
 * later, in the moment, while you actually work.
 */
export function buildQuestions(scan: ReturnType<typeof scanProject>): Question[] {
  const folders = scan.topFolders.slice(0, 4).join(', ');

  return [
    {
      key: 'audienceAndPurpose',
      ask: 'Who is this project for, and what do they use it to do?',
      why: 'This gives every AI a clear picture of the people and the goal.',
      suggestion: scan.description || '',
    },
    {
      key: 'currentAndNext',
      ask: 'What works today, and what are you trying to build next?',
      why: 'This stops the AI treating an old feature and your next goal as the same thing.',
      suggestion: '',
    },
    {
      key: 'riskyAreas',
      ask: 'Which parts could cause serious problems if changed badly?',
      why: 'Think about money, user data, login, production, or anything hard to undo.',
      suggestion: 'Anything involving user data, login, payments, production, or deletion.',
    },
    {
      key: 'alwaysAsk',
      ask: 'What must the AI always ask you before doing?',
      why: 'This becomes a clear approval rule.',
      suggestion: 'push or deploy, change the database schema or data, change money or auth logic, add a new dependency, delete files',
    },
    {
      key: 'safeWithoutAsking',
      ask: 'What can the AI safely do without asking you?',
      why: 'This lets normal work move without constant questions.',
      suggestion: 'Inspect the code, make small changes inside the task, add tests, and run existing checks.',
    },
    {
      key: 'protectedAreas',
      ask: 'Is there anything the AI should not edit, delete, rename, or run unless you say so?',
      why: 'This protects files and systems that need extra care.',
      suggestion: '.env files, database migrations, deployment scripts, and production data',
    },
    {
      key: 'sourceOfTruth',
      ask: 'If the code, documentation, comments, and your message disagree, which one should the AI trust?',
      why: 'This tells the AI what to follow and when to warn you.',
      suggestion: 'Trust my newest message first, then tests and working code. Tell me when the documentation is different.',
    },
    {
      key: 'patternToFollow',
      ask: 'Which file or folder is the best example of how new work should look?',
      why: 'This gives the AI a real example to copy instead of inventing a new style.',
      suggestion: folders
        ? `Use the closest similar file in the same feature. Main folders: ${folders}.`
        : 'Use the closest similar file in the same feature.',
    },
    {
      key: 'doneChecks',
      ask: 'What must be checked before a task can be called finished?',
      why: 'This becomes the finishing checklist for every task.',
      suggestion: scan.testCommand
        ? `Run ${scan.testCommand}. Run any existing lint or build check for the changed area. Say what was not checked.`
        : 'Run the existing checks for the changed area. Say what was not checked.',
    },
    {
      key: 'whenUnclearOrFailing',
      ask: 'If your request is unclear or a check fails, what should the AI do?',
      why: 'This stops the AI hiding a problem or making a risky guess.',
      suggestion: 'Stop and explain the problem. Do not hide a failure or remove a test just to make it pass.',
    },
    {
      key: 'storyPreference',
      ask: 'When Twomind explains a task, what do you want to see first?',
      why: 'This tells the agent how to write the story for you.',
      suggestion: 'Show a short summary first, then how it works, the important files, and how it was tested. Use plain English.',
    },
    {
      key: 'pastMistake',
      ask: 'What is one mistake an AI made in this project that should never happen again?',
      why: 'A real mistake makes a much clearer rule than a general preference.',
      suggestion: '',
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
      console.log(c.dim('                that is a lot, Twomind can help shrink it later'));
    }
  }
  console.log('');

  const answers = options.yes ? defaultAnswers(scan) : await runInterview(scan);

  const paths = resolveProjectPaths(root);
  ensureDirs(paths);

  const config = defaultConfig(scan.name);
  config.summary = answers.audienceAndPurpose;
  saveConfig(root, config);

  const written = writeBrain(root, scan, answers);
  const createdCount = written.filter((w) => w.action === 'created').length;
  const keptCount = written.filter((w) => w.action === 'kept').length;

  console.log(c.bold('  Wrote'));
  console.log(`    ${c.green(String(createdCount))} new files in .twomind/${keptCount ? c.dim(`  (${keptCount} already existed, left alone)`) : ''}`);

  const agentsFile = path.join(root, 'AGENTS.md');
  const blockAction = upsertManagedBlock(agentsFile, managedBlock());
  console.log(`    AGENTS.md ${blockAction === 'created' ? 'created' : `${blockAction} (only our block)`}`);
  const claudeAction = ensureClaudeImport(root);
  if (claudeAction !== 'present') {
    console.log(`    CLAUDE.md ${claudeAction === 'created' ? 'created' : 'updated'} (so Claude Code always reads AGENTS.md)`);
  }
  await ensureStartingPoint(root);

  const targets: AgentId[] = detected.length ? [...detected] : ['claude', 'codex'];
  // Codex's end-of-turn command is a user-level setting shared by the IDE.
  // Install it on every init so a project never misses Codex support merely
  // because it happened to contain only Claude files when we scanned it.
  if (!targets.includes('codex')) targets.push('codex');
  console.log('');
  console.log(c.bold('  Connected agents'));
  for (const agent of targets) {
    if (agent === 'codex') {
      // Project hooks wait for manual trust and the VS Code extension has no
      // hook browser. Use Codex's user-level end-of-turn notification instead.
      uninstallHooks(root, 'codex');
      const notify = installCodexNotify(root);
      console.log(`    ${c.green('ok')}  ${'Codex'.padEnd(12)} ${c.dim(notify.file)}`);
      if (notify.backup) console.log(c.dim(`        your previous Codex settings were backed up`));
      if (notify.note) console.log(c.yellow(`        ${notify.note}`));
      continue;
    }
    const result = installHooks(root, agent);
    const label = 'Claude Code';
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
  console.log(c.dim('    then just work normally: every prompt that changes files becomes a story'));
  console.log('');

  if (already) {
    console.log(c.dim('  (this project was already set up, settings and hooks were refreshed)'));
    console.log('');
  }
}

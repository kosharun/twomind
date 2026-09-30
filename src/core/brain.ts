import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveProjectPaths, userHome } from './paths.js';
import { NOTE_TEMPLATE } from './note.js';
import type { ScanResult } from './scan.js';

/**
 * The project brain: short, human-readable files in the repo that both you and
 * every agent read.
 *
 * The size limits here are deliberate. Research on agent instruction files is
 * consistent: long context files do not help and often hurt, because models
 * follow roughly 150 to 200 instructions well and then start ignoring all of them
 * rather than the least important ones. So the always-loaded core stays tiny and
 * everything else is loaded only when it is relevant.
 */

export const ALWAYS_LOADED_LINE_BUDGET = 150;

export interface InterviewAnswers {
  audienceAndPurpose: string;
  currentAndNext: string;
  riskyAreas: string;
  alwaysAsk: string;
  safeWithoutAsking: string;
  protectedAreas: string;
  sourceOfTruth: string;
  patternToFollow: string;
  doneChecks: string;
  whenUnclearOrFailing: string;
  storyPreference: string;
  pastMistake: string;
}

export function emptyAnswers(): InterviewAnswers {
  return {
    audienceAndPurpose: '',
    currentAndNext: '',
    riskyAreas: '',
    alwaysAsk: '',
    safeWithoutAsking: '',
    protectedAreas: '',
    sourceOfTruth: '',
    patternToFollow: '',
    doneChecks: '',
    whenUnclearOrFailing: '',
    storyPreference: '',
    pastMistake: '',
  };
}

function bullet(value: string): string {
  return value.trim() ? value.trim() : '_not answered yet_';
}

export function renderOverview(scan: ScanResult, answers: InterviewAnswers): string {
  return `# What this project is

> Read this first. Keep it short: this file is loaded into every agent session.

**Who uses it and what they use it to do:** ${bullet(answers.audienceAndPurpose || scan.description)}

**What works today and what is next:** ${bullet(answers.currentAndNext)}

**Parts that need extra care:** ${bullet(answers.riskyAreas)}

## Stack (detected, correct anything wrong)

- Languages: ${scan.languages.join(', ') || 'unknown'}
- Frameworks: ${scan.frameworks.join(', ') || 'none detected'}
- Data: ${scan.databases.join(', ') || 'none detected'}
- Package manager: ${scan.packageManager ?? 'unknown'}
- Top-level folders: ${scan.topFolders.join(', ') || 'unknown'}

## Example to follow

${bullet(answers.patternToFollow)}
`;
}

export function renderRules(answers: InterviewAnswers): string {
  return `# Rules

> Always loaded. Keep this under ${ALWAYS_LOADED_LINE_BUDGET} lines in total across the always-loaded files.
> Rules that only apply to one area belong in \`rules/\` with a \`paths:\` header instead.

## Ask before you act

Do not do any of these without asking first:

${bullet(answers.alwaysAsk)}

## Safe without asking

${bullet(answers.safeWithoutAsking)}

## Protected parts

${bullet(answers.protectedAreas)}

## What to trust

${bullet(answers.sourceOfTruth)}

## Pattern to follow

${bullet(answers.patternToFollow)}

## Reuse before you create

Before writing a new function, component or helper, search for an existing one
that already does the job. If you create something new that looks similar to
something that exists, say so and say why.

## Before calling a task finished

${bullet(answers.doneChecks)}

## When something is unclear or a check fails

${bullet(answers.whenUnclearOrFailing)}

## How to explain completed work

${bullet(answers.storyPreference)}

## A mistake that must not happen again

${bullet(answers.pastMistake)}
`;
}

export function renderWorkflow(scan: ScanResult, answers: InterviewAnswers): string {
  return `# Workflow

> Verified commands. Loaded on demand, not on every turn.

- Install: ${scan.packageManager ? `\`${scan.packageManager} install\`` : '_unknown_'}
- Test: ${scan.testCommand ? `\`${scan.testCommand}\`` : '_unknown_'}

## Before calling a task finished

${bullet(answers.doneChecks)}

## If something is unclear or a check fails

${bullet(answers.whenUnclearOrFailing)}

## Unknown / to be filled in

- Build command
- Deployment process
- Branch and release process
`;
}

export function renderReadme(projectName: string): string {
  return `# Twomind

This folder is shared memory for **${projectName}**, for you and for every AI agent
working here. It is plain Markdown and JSON, readable without any tool.

| Folder | What is in it | Loaded by agents |
|---|---|---|
| \`project/\` | What this project is, the rules, decisions, and recording guide | Read when needed |
| \`project/rules/\` | Rules for one area only | Only when those files are touched |
| \`map/\` | Plain-language map of the code and the data | On demand |
| \`stories/\` | One entry per prompt: what changed and why | Never, these are for humans |
| \`inbox/\` | Things the AI wants to remember, waiting for your yes | Never |
| \`.local/\` | Raw prompts and snapshots. Gitignored, stays on your machine | Never |

Run \`twomind serve\` to read the stories in a browser.
`;
}

export function renderUserProfile(answers: InterviewAnswers): string {
  return `# How I like to work

> This file follows you across projects. It stays on your machine and is never committed.

**Show me this first:** ${bullet(answers.storyPreference)}
`;
}

const BLOCK_START = '<!-- twomind:start -->';
const BLOCK_END = '<!-- twomind:end -->';

/**
 * The block every agent reads (via AGENTS.md, and via CLAUDE.md's import).
 *
 * Its main job is to point the agent at Twomind's small project files without
 * crowding out rules the project owner already wrote.
 */
export function managedBlock(): string {
  return `${BLOCK_START}
## Twomind

The project owner's instructions outside this block always win.
Before editing files, read \`.twomind/project/overview.md\` and \`.twomind/project/rules.md\`.
If you changed any file, before your final reply:
1. Read \`.twomind/project/recording.md\`.
2. Write \`.twomind/.local/note.json\` exactly as that file explains.
Twomind saves the note automatically.
${BLOCK_END}`;
}

/** Detailed note instructions, loaded only after files change. */
export function renderRecordingGuide(): string {
  return `# Recording a change

> Twomind manages this file. Run \`twomind refresh\` to update it.

When a task changes files, explain the change for the project owner before your final reply.
Write the explanation to \`.twomind/.local/note.json\` using this shape:

\`\`\`json
${NOTE_TEMPLATE}
\`\`\`

List every file you changed. Use these levels:

- \`start\`: the heart of the change, usually one to three files
- \`important\`: worth reading
- \`small\`: a minor follow-up

Use simple words. Tell the story in reading order. One chapter is enough for a small change.
A bigger change can use more chapters, but each chapter should explain one idea, not one file.
One chapter can cover several files.

Use \`steps\` to walk through the code slowly. Each step should be one plain sentence that
points to only the lines it explains. The first step needs a \`file\`. Later steps can stay on
that file. Keep a chapter to about eight steps or fewer. Split a chapter when it holds two ideas.

Your job ends after writing the note. Do not run \`twomind record\` yourself. Claude's hook or
Codex's end-of-turn notification saves it automatically. The project owner can run
\`twomind record\` by hand only when automatic recording needs a backup.
`;
}

function lineEndingOf(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function withLineEnding(text: string, lineEnding: '\r\n' | '\n'): string {
  return text.replace(/\r\n|\r|\n/g, lineEnding);
}

function separatorBeforeAppend(text: string, lineEnding: '\r\n' | '\n'): string {
  if (!text) return '';
  if (text.endsWith(`${lineEnding}${lineEnding}`)) return '';
  if (text.endsWith(lineEnding)) return lineEnding;
  return `${lineEnding}${lineEnding}`;
}

function markerPositions(text: string, marker: string): number[] {
  const positions: number[] = [];
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(marker, from);
    if (at === -1) break;
    positions.push(at);
    from = at + marker.length;
  }
  return positions;
}

/**
 * Make sure Claude Code reads AGENTS.md.
 *
 * Claude Code reads AGENTS.md on its own only when there is no CLAUDE.md, and
 * only from v2.1.277. A CLAUDE.md that imports AGENTS.md works in every
 * version and every session, so we add that import. It is the same one-line setup
 * as a CLAUDE.md that says only "@AGENTS.md".
 */
export function ensureClaudeImport(root: string): 'created' | 'added' | 'present' {
  const file = path.join(root, 'CLAUDE.md');
  if (!existsSync(file)) {
    writeFileSync(file, '@AGENTS.md\n', 'utf8');
    return 'created';
  }
  const text = readFileSync(file, 'utf8');
  if (/^\s*@\.?\/?AGENTS\.md\s*$/im.test(text)) return 'present';
  const lineEnding = lineEndingOf(text);
  appendFileSync(file, `${separatorBeforeAppend(text, lineEnding)}@AGENTS.md${lineEnding}`, 'utf8');
  return 'added';
}

/** Insert or refresh our block in an existing file without touching the rest. */
export function upsertManagedBlock(filePath: string, block: string): 'created' | 'updated' | 'unchanged' {
  const exists = existsSync(filePath);
  const existing = exists ? readFileSync(filePath, 'utf8') : '';
  const starts = markerPositions(existing, BLOCK_START);
  const ends = markerPositions(existing, BLOCK_END);

  const badMarkers =
    starts.length !== ends.length ||
    starts.length > 1 ||
    (starts.length === 1 && ends[0] < starts[0]);

  if (badMarkers) {
    throw new Error(
      `${path.basename(filePath)} has broken or repeated Twomind markers. ` +
      'Twomind left the file unchanged. Fix the marker lines, then run the command again.'
    );
  }

  const lineEnding = lineEndingOf(existing);
  const safeBlock = withLineEnding(block, lineEnding);

  if (starts.length === 1) {
    const before = existing.slice(0, starts[0]);
    const after = existing.slice(ends[0] + BLOCK_END.length);
    const next = `${before}${safeBlock}${after}`;
    if (next === existing) return 'unchanged';
    writeFileSync(filePath, next, 'utf8');
    return 'updated';
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  if (exists) {
    appendFileSync(
      filePath,
      `${separatorBeforeAppend(existing, lineEnding)}${safeBlock}${lineEnding}`,
      'utf8'
    );
    return 'updated';
  }

  writeFileSync(filePath, `# AGENTS.md${lineEnding}${lineEnding}${safeBlock}${lineEnding}`, 'utf8');
  return 'created';
}

export interface WrittenFile {
  file: string;
  action: 'created' | 'updated' | 'unchanged' | 'kept';
}

function writeIfAbsent(file: string, contents: string): WrittenFile {
  if (existsSync(file)) return { file, action: 'kept' };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, 'utf8');
  return { file, action: 'created' };
}

function writeManagedFile(file: string, contents: string): WrittenFile {
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, contents, 'utf8');
    return { file, action: 'created' };
  }
  if (readFileSync(file, 'utf8') === contents) return { file, action: 'unchanged' };
  writeFileSync(file, contents, 'utf8');
  return { file, action: 'updated' };
}

/** This file belongs to Twomind, so refresh may safely replace it. */
export function writeRecordingGuide(root: string): WrittenFile {
  const file = path.join(resolveProjectPaths(root).project, 'recording.md');
  return writeManagedFile(file, renderRecordingGuide());
}

export function writeBrain(root: string, scan: ScanResult, answers: InterviewAnswers): WrittenFile[] {
  const paths = resolveProjectPaths(root);
  const written: WrittenFile[] = [];

  written.push(writeIfAbsent(path.join(paths.base, 'README.md'), renderReadme(scan.name)));
  written.push(writeIfAbsent(path.join(paths.project, 'overview.md'), renderOverview(scan, answers)));
  written.push(writeIfAbsent(path.join(paths.project, 'rules.md'), renderRules(answers)));
  written.push(writeIfAbsent(path.join(paths.project, 'workflow.md'), renderWorkflow(scan, answers)));
  written.push(writeRecordingGuide(root));
  written.push(
    writeIfAbsent(
      path.join(paths.project, 'decisions', 'README.md'),
      '# Decisions\n\nOne file per durable decision: what was chosen, why, and what future work must respect.\nMark whether the reason was **stated by you** or **inferred from the code**.\n'
    )
  );

  // Keep the machine's raw prompts and snapshots out of git.
  const gitignore = path.join(paths.base, '.gitignore');
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, '.local/\n', 'utf8');
    written.push({ file: gitignore, action: 'created' });
  }

  const home = userHome();
  mkdirSync(home, { recursive: true });
  const meFile = path.join(home, 'me.md');
  if (!existsSync(meFile)) {
    writeFileSync(meFile, renderUserProfile(answers), 'utf8');
    written.push({ file: meFile, action: 'created' });
  }

  return written;
}

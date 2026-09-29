import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveProjectPaths, userHome } from './paths.js';
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
  summary: string;
  stage: string;
  importantAreas: string;
  neverWithoutAsking: string;
  autonomy: string;
  conventions: string;
  sharedCodeLocation: string;
  testingRules: string;
  petPeeves: string;
  deepAreas: string;
  explanationStyle: string;
  closeness: string;
}

export function emptyAnswers(): InterviewAnswers {
  return {
    summary: '',
    stage: '',
    importantAreas: '',
    neverWithoutAsking: '',
    autonomy: '',
    conventions: '',
    sharedCodeLocation: '',
    testingRules: '',
    petPeeves: '',
    deepAreas: '',
    explanationStyle: '',
    closeness: '',
  };
}

function bullet(value: string): string {
  return value.trim() ? value.trim() : '_not answered yet_';
}

export function renderOverview(scan: ScanResult, answers: InterviewAnswers): string {
  return `# What this project is

> Read this first. Keep it short: this file is loaded into every agent session.

**In one sentence:** ${bullet(answers.summary || scan.description)}

**Stage:** ${bullet(answers.stage)}

**Most important or riskiest areas:** ${bullet(answers.importantAreas)}

**Areas the owner wants to understand deeply:** ${bullet(answers.deepAreas)}

## Stack (detected, correct anything wrong)

- Languages: ${scan.languages.join(', ') || 'unknown'}
- Frameworks: ${scan.frameworks.join(', ') || 'none detected'}
- Data: ${scan.databases.join(', ') || 'none detected'}
- Package manager: ${scan.packageManager ?? 'unknown'}
- Top-level folders: ${scan.topFolders.join(', ') || 'unknown'}

## Where things live

- Shared helpers and components: ${bullet(answers.sharedCodeLocation)}
`;
}

export function renderRules(answers: InterviewAnswers): string {
  return `# Rules

> Always loaded. Keep this under ${ALWAYS_LOADED_LINE_BUDGET} lines in total across the always-loaded files.
> Rules that only apply to one area belong in \`rules/\` with a \`paths:\` header instead.

## Ask before you act

Do not do any of these without asking first:

${bullet(answers.neverWithoutAsking)}

## How much to decide alone

${bullet(answers.autonomy)}

## Reuse before you create

Before writing a new function, component or helper, search for an existing one
that already does the job. If you create something new that looks similar to
something that exists, say so and say why.

${answers.sharedCodeLocation.trim() ? `Shared code lives in: ${answers.sharedCodeLocation.trim()}` : ''}

## Style

${bullet(answers.conventions)}

## Testing

${bullet(answers.testingRules)}

## Things that have annoyed the owner before

${bullet(answers.petPeeves)}
`;
}

export function renderWorkflow(scan: ScanResult, answers: InterviewAnswers): string {
  return `# Workflow

> Verified commands. Loaded on demand, not on every turn.

- Install: ${scan.packageManager ? `\`${scan.packageManager} install\`` : '_unknown_'}
- Test: ${scan.testCommand ? `\`${scan.testCommand}\`` : '_unknown_'}

## Testing rules

${bullet(answers.testingRules)}

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
| \`project/\` | What this project is, the rules, decisions | Always (kept small on purpose) |
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

**Explanations:** ${bullet(answers.explanationStyle)}

**How close I want to stay to the code:** ${bullet(answers.closeness)}
`;
}

const BLOCK_START = '<!-- twomind:start -->';
const BLOCK_END = '<!-- twomind:end -->';

/**
 * The block every agent reads (via AGENTS.md, and via CLAUDE.md's import).
 *
 * Its main job: make the agent explain its own changes. Claude Code and Codex
 * also have a Stop hook that asks for the note if the agent forgets; every
 * other agent relies on this text alone, so it also says how to save the note.
 */
export function managedBlock(recordCommand: string): string {
  return `${BLOCK_START}
## Twomind (managed block: edit the files in \`.twomind/project/\`, not this block)

Before substantial work, read \`.twomind/project/overview.md\` and \`.twomind/project/rules.md\`.
Before creating a new function, component or helper, search for an existing one first.

**When you finish a task that changed files, explain it for the owner.** Write this file:
\`.twomind/.local/note.json\`

\`\`\`json
{
  "title": "short title",
  "request": "what the owner asked, in one line",
  "summary": "2-4 short, plain sentences: what changed and why",
  "chapters": [
    { "title": "short name for one part", "what": "1-3 plain sentences about this part",
      "files": ["exact/path"],
      "steps": [
        { "say": "one short, plain sentence: what happens first", "file": "exact/path", "lines": "12-18" },
        { "say": "the next sentence, once the reader has seen that", "lines": "20-24" }
      ] }
  ],
  "howToTest": ["step 1", "step 2"],
  "files": [{ "path": "exact/path", "level": "start | important | small", "why": "one sentence" }],
  "decisions": [{ "choice": "what you chose", "why": "why" }],
  "notTested": ["anything you did not check"]
}
\`\`\`

List every file you changed. You decide the level: "start" = the heart of the change
(1-3 files), "important" = worth reading, "small" = a minor follow-up. Use simple words.
"chapters" tell the change as a story, in reading order: 1 for a small change, around 6 for a
big one. A huge change (many files) can use more, but each chapter is still one idea, not one
file. One chapter can cover many files.

Give each chapter "steps": walk the owner through its code slowly, one plain sentence at a
time, each one pointing at just the few lines it is talking about. This is the part that
matters most: do not only name a file, guide the owner through it like you are sitting next
to them. The first step needs "file"; later steps can leave it out to stay on the same file.
Keep a chapter to around 8 steps or fewer; if one idea needs more, it is really two ideas, so
split it into two chapters.

Claude Code and Codex save the note by themselves. In any other tool, run this after
writing the note: \`${recordCommand}\`
${BLOCK_END}`;
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
  writeFileSync(file, `${text.trimEnd()}\n\n@AGENTS.md\n`, 'utf8');
  return 'added';
}

/** Insert or refresh our block in an existing file without touching the rest. */
export function upsertManagedBlock(filePath: string, block: string): 'created' | 'updated' | 'unchanged' {
  const exists = existsSync(filePath);
  const existing = exists ? readFileSync(filePath, 'utf8') : '';

  if (existing.includes(BLOCK_START) && existing.includes(BLOCK_END)) {
    const before = existing.slice(0, existing.indexOf(BLOCK_START));
    const after = existing.slice(existing.indexOf(BLOCK_END) + BLOCK_END.length);
    const next = `${before}${block}${after}`;
    if (next === existing) return 'unchanged';
    writeFileSync(filePath, next, 'utf8');
    return 'updated';
  }

  const next = exists ? `${existing.trimEnd()}\n\n${block}\n` : `# AGENTS.md\n\n${block}\n`;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, next, 'utf8');
  return exists ? 'updated' : 'created';
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

export function writeBrain(root: string, scan: ScanResult, answers: InterviewAnswers): WrittenFile[] {
  const paths = resolveProjectPaths(root);
  const written: WrittenFile[] = [];

  written.push(writeIfAbsent(path.join(paths.base, 'README.md'), renderReadme(scan.name)));
  written.push(writeIfAbsent(path.join(paths.project, 'overview.md'), renderOverview(scan, answers)));
  written.push(writeIfAbsent(path.join(paths.project, 'rules.md'), renderRules(answers)));
  written.push(writeIfAbsent(path.join(paths.project, 'workflow.md'), renderWorkflow(scan, answers)));
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

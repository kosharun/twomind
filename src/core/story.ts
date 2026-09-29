import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { changedLinesByFile } from './diffparse.js';
import type { AgentNote, NoteChapter, NoteLevel, NoteStep } from './note.js';
import { slashPath } from './note.js';
import type { DiffResult, FileChange } from './snapshot.js';
import { resolveProjectPaths } from './paths.js';
import { redact } from './redact.js';
import { shortId, slugify, timeParts, truncate } from './util.js';

/**
 * A Change Story is the agent's own explanation of one change, attached to the
 * real diff.
 *
 * Twomind supplies the facts: which files changed and which lines. The agent
 * supplies the meaning: what is the heart of the change, what is a small
 * follow-up, and why each file changed. Twomind never ranks or explains files
 * on its own: a file the agent did not explain is shown as exactly that.
 */

export type StoryLevel = NoteLevel | 'unexplained';

export interface StoryFileEntry {
  path: string;
  oldPath?: string;
  status: FileChange['status'];
  category: StoryLevel;
  added: number;
  deleted: number;
  binary: boolean;
  why: string;
  startHere: boolean;
}

export interface StoryGroup {
  category: StoryLevel;
  label: string;
  hint: string;
  files: string[];
  totalAdded: number;
  totalDeleted: number;
}

/** Where the explanation came from. Shown to the owner, never hidden. */
export type ExplainedBy = 'agent-note' | 'agent-message' | 'none';

/** One narrated beat of a chapter: a sentence, and the lines it is about. */
export interface StoryStep {
  say: string;
  /** Null when the agent's file could not be matched to the real diff. */
  file: string | null;
  /** Null when there is no code for this beat, so it shows as words alone. */
  lines: Array<[number, number]> | null;
}

/** One part of the agent's story of a change. */
export interface StoryChapter {
  title: string;
  what: string;
  /** Paths from the real diff. Paths the agent wrote that did not change are dropped. */
  files: string[];
  /** Line ranges per file, kept only where they touch lines that really changed. */
  lines: Record<string, Array<[number, number]>>;
  /** The chapter told slowly. Empty when the agent skipped it; the file list above still holds. */
  steps: StoryStep[];
}

export interface StoryMeta {
  id: string;
  version: 2;
  title: string;
  createdAt: string;
  source: 'agent' | 'commit' | 'record';
  agent: string;
  sessionId: string;
  branch: string;
  /** What the owner asked. Redacted. Empty when prompt capture is off. */
  prompt: string;
  /** The agent's explanation (its note), or its last chat message if it wrote no note. Redacted. */
  agentSummary: string;
  explainedBy: ExplainedBy;
  /** The agent's story in parts. Missing on older stories and when the agent wrote none. */
  chapters?: StoryChapter[];
  howToTest: string[];
  decisions: Array<{ choice: string; why: string }>;
  notTested: string[];
  commit?: { hash: string; shortHash: string; subject: string };
  stats: {
    files: number;
    added: number;
    deleted: number;
    truncated: boolean;
  };
  startHere: string[];
  groups: StoryGroup[];
  files: StoryFileEntry[];
  /** Relative path of the patch file inside the story folder. */
  diffFile: string;
  /** Kept for older readers; Twomind no longer extracts these itself. */
  newSymbols: string[];
}

const LEVEL_ORDER: StoryLevel[] = ['start', 'important', 'small', 'unexplained'];

const LEVEL_LABEL: Record<StoryLevel, string> = {
  start: 'Start here',
  important: 'Also worth reading',
  small: 'Small changes',
  unexplained: 'Not explained by the agent',
};

const LEVEL_HINT: Record<StoryLevel, string> = {
  start: 'The agent says: read these first. They are the heart of the change.',
  important: 'The agent says these matter too.',
  small: 'The agent says these are minor. A quick look is enough.',
  unexplained: 'These files changed, but the agent did not say why.',
};

export interface BuildStoryInput {
  root: string;
  diff: DiffResult;
  /** What the owner asked, from the prompt hook. */
  prompt: string;
  /** The agent's note, or null if it wrote none. */
  note: AgentNote | null;
  /** The agent's last chat message. Used only when there is no note summary. */
  fallbackSummary: string;
  agent: string;
  sessionId: string;
  branch: string;
  includePrompt: boolean;
  source?: StoryMeta['source'];
  commit?: { hash: string; shortHash: string; subject: string };
  createdAt?: Date;
}

const clean = (text: string | undefined | null): string => redact(text ?? '').text.trim();

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().replace(/^[#>\-*\s]+/, '');
}

/** Agents write paths relative to a subfolder, or with a prefix. Match them to the real diff. */
function samePath(a: string, b: string): boolean {
  const x = slashPath(a).toLowerCase();
  const y = slashPath(b).toLowerCase();
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

/** "12-40, 55" -> [[12, 40], [55, 55]] */
function parseRanges(spec: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const part of spec.split(/[,;]/)) {
    const numbers = part.match(/\d+/g)?.map(Number) ?? [];
    if (!numbers.length) continue;
    const from = numbers[0];
    const to = numbers[1] ?? numbers[0];
    ranges.push([Math.min(from, to), Math.max(from, to)]);
  }
  return ranges;
}

/** A line range survives only if it touches a line that really changed, with a little slack. */
function keepTouchedRanges(spec: string, touched: number[]): Array<[number, number]> {
  return parseRanges(spec).filter(([from, to]) => touched.some((n) => n >= from - 3 && n <= to + 3));
}

/**
 * Check one step against the real diff: resolve its file (falling back to the
 * previous step's file, so the agent can leave it out once it has said which
 * file it is on), and keep only the lines that really changed there.
 */
function resolveStep(
  step: NoteStep,
  prevFile: string | null,
  diff: DiffResult,
  changed: Map<string, Set<number>>
): StoryStep {
  const say = clean(step.say);
  const wanted = step.file || prevFile || '';
  const real = wanted ? diff.files.find((f) => samePath(f.path, wanted)) : undefined;
  if (!real) return { say, file: null, lines: null };

  const kept = step.lines ? keepTouchedRanges(step.lines, [...(changed.get(real.path) ?? [])]) : [];
  return { say, file: real.path, lines: kept.length ? kept : null };
}

/**
 * Keep the agent's chapters honest: files must be in the real diff, and a line
 * range survives only if it touches a line that really changed (with a few
 * lines of slack for the code around a change).
 */
function buildChapters(chapters: NoteChapter[], diff: DiffResult): StoryChapter[] {
  const changed = new Map<string, Set<number>>();
  for (const file of diff.files) {
    const lines = file.patch ? changedLinesByFile(file.patch).get(file.path) : undefined;
    changed.set(file.path, lines ?? new Set());
  }

  return chapters.map((chapter) => {
    const files: string[] = [];
    for (const wanted of chapter.files) {
      const real = diff.files.find((f) => samePath(f.path, wanted));
      if (real && !files.includes(real.path)) files.push(real.path);
    }

    const lines: Record<string, Array<[number, number]>> = {};
    for (const [wanted, spec] of Object.entries(chapter.lines)) {
      const real = diff.files.find((f) => samePath(f.path, wanted));
      if (!real) continue;
      const kept = keepTouchedRanges(spec, [...(changed.get(real.path) ?? [])]);
      if (kept.length) lines[real.path] = kept;
      if (!files.includes(real.path)) files.push(real.path);
    }

    let prevFile: string | null = null;
    const steps: StoryStep[] = [];
    for (const step of chapter.steps) {
      const resolved = resolveStep(step, prevFile, diff, changed);
      if (!resolved.say) continue;
      if (resolved.file) {
        prevFile = resolved.file;
        if (!files.includes(resolved.file)) files.push(resolved.file);
      }
      steps.push(resolved);
    }

    return {
      title: clean(chapter.title),
      what: clean(chapter.what),
      files,
      lines,
      steps,
    };
  });
}

export function buildStory(input: BuildStoryInput): { meta: StoryMeta; markdown: string; patch: string } {
  const { diff, note } = input;
  const when = input.createdAt ?? new Date();
  const tp = timeParts(when);

  // Match the agent's per-file notes to the files that really changed.
  const noted = note?.files ?? [];
  const noteIndex = new Map<string, number>();
  noted.forEach((f, i) => noteIndex.set(slashPath(f.path).toLowerCase(), i));

  const findNote = (filePath: string): { level: NoteLevel; why: string; order: number } | null => {
    const key = slashPath(filePath).toLowerCase();
    let index = noteIndex.get(key);
    if (index === undefined) {
      // Agents sometimes write a path relative to a subfolder, or with a prefix.
      for (const [k, i] of noteIndex) {
        if (key.endsWith(`/${k}`) || k.endsWith(`/${key}`)) {
          index = i;
          break;
        }
      }
    }
    return index === undefined ? null : { level: noted[index].level, why: noted[index].why, order: index };
  };

  const ranked = diff.files.map((file) => {
    const found = findNote(file.path);
    const level: StoryLevel = found ? found.level : 'unexplained';
    const entry: StoryFileEntry = {
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      category: level,
      added: file.added,
      deleted: file.deleted,
      binary: file.binary,
      why: found ? clean(found.why) : '',
      startHere: level === 'start',
    };
    return { entry, order: found ? found.order : Number.MAX_SAFE_INTEGER };
  });

  // The agent's own order, grouped by the level it chose. No scoring of our own.
  ranked.sort(
    (a, b) =>
      LEVEL_ORDER.indexOf(a.entry.category) - LEVEL_ORDER.indexOf(b.entry.category) ||
      a.order - b.order ||
      a.entry.path.localeCompare(b.entry.path)
  );
  const files = ranked.map((r) => r.entry);

  const groups: StoryGroup[] = [];
  for (const level of LEVEL_ORDER) {
    const list = files.filter((f) => f.category === level);
    if (list.length === 0) continue;
    groups.push({
      category: level,
      label: LEVEL_LABEL[level],
      hint: LEVEL_HINT[level],
      files: list.map((f) => f.path),
      totalAdded: list.reduce((n, f) => n + f.added, 0),
      totalDeleted: list.reduce((n, f) => n + f.deleted, 0),
    });
  }

  const prompt = input.includePrompt ? clean(input.prompt || note?.request || '') : '';
  const noteSummary = note ? clean(note.summary) : '';
  const fallback = clean(input.fallbackSummary);
  const agentSummary = noteSummary || fallback;

  let explainedBy: ExplainedBy = 'none';
  if (note && (noteSummary || note.files.length > 0)) explainedBy = 'agent-note';
  else if (fallback) explainedBy = 'agent-message';

  const title = truncate(
    clean(note?.title) ||
      input.commit?.subject ||
      firstLine(prompt) ||
      firstLine(fallback) ||
      `Changes in ${files.length} file${files.length === 1 ? '' : 's'}`,
    72
  );

  const id = `${tp.year}-${tp.month}-${tp.stamp}-${shortId(`${when.toISOString()}${input.sessionId}${title}`)}`;

  const meta: StoryMeta = {
    id,
    version: 2,
    title,
    createdAt: when.toISOString(),
    source: input.source ?? 'agent',
    agent: input.agent,
    sessionId: input.sessionId,
    branch: input.branch,
    prompt,
    agentSummary,
    explainedBy,
    chapters: buildChapters(note?.chapters ?? [], diff),
    howToTest: (note?.howToTest ?? []).map(clean).filter(Boolean),
    decisions: (note?.decisions ?? []).map((d) => ({ choice: clean(d.choice), why: clean(d.why) })),
    notTested: (note?.notTested ?? []).map(clean).filter(Boolean),
    commit: input.commit,
    stats: {
      files: diff.files.length,
      added: diff.totalAdded,
      deleted: diff.totalDeleted,
      truncated: diff.truncated,
    },
    startHere: files.filter((f) => f.startHere).map((f) => f.path),
    groups,
    files,
    diffFile: 'changes.diff',
    newSymbols: [],
  };

  const patch = diff.files
    .filter((f) => f.patch)
    .map((f) => f.patch)
    .join('\n');

  return { meta, markdown: renderMarkdown(meta), patch };
}

export function renderMarkdown(meta: StoryMeta): string {
  const lines: string[] = [];
  const time = new Date(meta.createdAt).toLocaleString();

  lines.push(`# ${meta.title}`);
  lines.push('');
  lines.push(
    `*${time} · ${meta.agent || 'unknown agent'} · ${meta.branch || 'no branch'} · ` +
      `${meta.stats.files} file${meta.stats.files === 1 ? '' : 's'} · +${meta.stats.added} / -${meta.stats.deleted}*`
  );
  lines.push('');

  if (meta.prompt) {
    lines.push('## You asked', '', '> ' + meta.prompt.split('\n').join('\n> '), '');
  }

  if (meta.explainedBy === 'agent-note') {
    lines.push("## The agent's explanation", '', meta.agentSummary || '_No summary written._', '');
  } else if (meta.explainedBy === 'agent-message') {
    lines.push('## What the agent said at the end', '', '*The agent did not write a note, so this is its last chat message.*', '', meta.agentSummary, '');
  } else {
    lines.push('> **The agent did not explain this change.**', '');
  }

  if (meta.chapters?.length) {
    lines.push('## The story, in parts', '');
    meta.chapters.forEach((chapter, i) => {
      lines.push(`### ${i + 1}. ${chapter.title || 'Untitled part'}`, '');
      if (chapter.what) lines.push(chapter.what, '');
      for (const step of chapter.steps) {
        lines.push(`- ${step.say}${step.file ? ` (\`${step.file}\`)` : ''}`);
      }
      if (chapter.steps.length) lines.push('');
      if (chapter.files.length) lines.push(`Files: ${chapter.files.map((f) => `\`${f}\``).join(', ')}`, '');
    });
  }

  if (meta.howToTest.length) {
    lines.push('## How to test', '');
    meta.howToTest.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    lines.push('');
  }

  for (const group of meta.groups) {
    lines.push(`## ${group.label} (${group.files.length})`, '', `*${group.hint}*`, '');
    for (const p of group.files) {
      const file = meta.files.find((f) => f.path === p);
      if (!file) continue;
      lines.push(`- \`${p}\`${file.why ? `: ${file.why}` : ''} *(+${file.added} / -${file.deleted})*`);
    }
    lines.push('');
  }

  if (meta.decisions.length) {
    lines.push('## Decisions the agent made', '');
    for (const d of meta.decisions) lines.push(`- **${d.choice}**${d.why ? `: ${d.why}` : ''}`);
    lines.push('');
  }

  if (meta.notTested.length) {
    lines.push('## Not tested', '');
    for (const item of meta.notTested) lines.push(`- ${item}`);
    lines.push('');
  }

  if (meta.stats.truncated) {
    lines.push('> The full patch was larger than the configured limit, so it was cut short.', '');
  }

  lines.push('---', '', '*Written by Twomind. The order and the explanations come from the agent itself.*');
  return lines.join('\n') + '\n';
}

export function storyFolderName(meta: StoryMeta): string {
  return `${meta.id}-${slugify(meta.title, 40)}`;
}

export function writeStory(root: string, story: { meta: StoryMeta; markdown: string; patch: string }): string {
  const paths = resolveProjectPaths(root);
  const date = new Date(story.meta.createdAt);
  const tp = timeParts(date);
  const dir = path.join(paths.stories, tp.year, tp.month, storyFolderName(story.meta));

  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(story.meta, null, 2) + '\n', 'utf8');
  writeFileSync(path.join(dir, 'story.md'), story.markdown, 'utf8');
  if (story.patch) writeFileSync(path.join(dir, 'changes.diff'), story.patch, 'utf8');

  return dir;
}

function walkStoryDirs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (existsSync(path.join(full, 'meta.json'))) out.push(full);
    else walkStoryDirs(full, out);
  }
  return out;
}

export interface LoadedStory {
  meta: StoryMeta;
  dir: string;
}

export function listStories(root: string, limit = 500): LoadedStory[] {
  const paths = resolveProjectPaths(root);
  const stories: LoadedStory[] = [];

  for (const dir of walkStoryDirs(paths.stories)) {
    try {
      const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as StoryMeta;
      stories.push({ meta, dir });
    } catch {
      /* skip unreadable story */
    }
  }

  stories.sort((a, b) => (a.meta.createdAt < b.meta.createdAt ? 1 : -1));
  return stories.slice(0, limit);
}

export function loadStory(root: string, id: string): (LoadedStory & { patch: string }) | null {
  const found = listStories(root).find((s) => s.meta.id === id);
  if (!found) return null;
  const patchPath = path.join(found.dir, found.meta.diffFile);
  const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  return { ...found, patch };
}

/** When the user last opened the dashboard. Drives the Catch-up page. */
export function readLastSeen(root: string): string | null {
  const file = path.join(resolveProjectPaths(root).local, 'last-seen.json');
  if (!existsSync(file)) return null;
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { at?: string }).at ?? null;
  } catch {
    return null;
  }
}

export function writeLastSeen(root: string, at = new Date().toISOString()): void {
  const paths = resolveProjectPaths(root);
  mkdirSync(paths.local, { recursive: true });
  writeFileSync(path.join(paths.local, 'last-seen.json'), JSON.stringify({ at }, null, 2) + '\n', 'utf8');
}

/**
 * The working-tree state at the moment the last story was saved.
 *
 * `twomind record` (for agents without hooks) diffs from here. The Stop hook
 * also reads it: if the agent already ran `record` during the turn, the hook
 * starts from this point instead, so the same change is never saved twice.
 */
export function readLastRecorded(root: string): { tree: string; at: string } | null {
  const file = path.join(resolveProjectPaths(root).local, 'last-recorded.json');
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { tree?: string; at?: string };
    return data.tree && data.at ? { tree: data.tree, at: data.at } : null;
  } catch {
    return null;
  }
}

export function writeLastRecorded(root: string, tree: string): void {
  const paths = resolveProjectPaths(root);
  mkdirSync(paths.local, { recursive: true });
  writeFileSync(
    path.join(paths.local, 'last-recorded.json'),
    JSON.stringify({ tree, at: new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  );
}

export function storyMtime(dir: string): number {
  try {
    return statSync(path.join(dir, 'meta.json')).mtimeMs;
  } catch {
    return 0;
  }
}

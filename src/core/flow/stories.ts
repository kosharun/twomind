import { changedLinesByFile } from '../diffparse.js';
import type { LoadedStory, StoryMeta } from '../story.js';
import { changedLinesOf } from './graph.js';
import { summarise, type FlowProject, type FunctionSummary } from './resolve.js';
import type { FlowFunction } from './types.js';

/**
 * The bridge from a story to the flow: which functions a change touched, and
 * where each chapter's simulation should start.
 *
 * A story's line numbers are from the moment it was saved. They only match
 * today's code if no later story changed the same file, so those files are
 * left unmarked rather than marked in the wrong place.
 */

export function reliableChangedLines(
  meta: StoryMeta,
  patch: string,
  stories: LoadedStory[]
): Map<string, Set<number>> {
  const lines = changedLinesByFile(patch);
  const later = stories.filter((s) => s.meta.createdAt > meta.createdAt);
  for (const file of [...lines.keys()]) {
    if (later.some((s) => s.meta.files.some((f) => f.path === file))) lines.delete(file);
  }
  return lines;
}

export interface FlowStarts {
  starts: FunctionSummary[];
  /** The agent named a function to start from, but the code has none by that name. */
  missingEntry: string | null;
}

export function storyStarts(
  project: FlowProject,
  meta: StoryMeta,
  changed: Map<string, Set<number>>
): { chapters: FlowStarts[]; whole: FlowStarts } {
  const changedIn = (files: string[]): FlowFunction[] =>
    [...project.functions.values()]
      .filter((fn) => files.includes(fn.file) && changedLinesOf(project, fn, changed).length > 0)
      .sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file) || a.line - b.line);

  /** Changed functions that no other changed function calls: where the change begins. */
  const roots = (fns: FlowFunction[]): FlowFunction[] => {
    const ids = new Set(fns.map((fn) => fn.id));
    const called = new Set<string>();
    for (const fn of fns) {
      for (const target of project.targets.get(fn.id) ?? []) {
        if (target.kind === 'fn' && target.id !== fn.id && ids.has(target.id)) called.add(target.id);
      }
    }
    // A function declared inside a changed function is reached through that one.
    // Constructors only set things up; the flow starts where the class is used.
    return fns.filter(
      (fn) => !called.has(fn.id) && !(fn.parent && ids.has(fn.parent)) && fn.name !== 'constructor'
    );
  };

  const startsFor = (files: string[], entry: string): FlowStarts => {
    const picked: FlowFunction[] = [];
    let missingEntry: string | null = null;
    if (entry) {
      const found = findEntry(project, entry, files);
      if (found) picked.push(found);
      else missingEntry = entry;
    }
    for (const fn of roots(changedIn(files))) if (!picked.includes(fn)) picked.push(fn);
    return { starts: picked.slice(0, 6).map((fn) => summarise(project, fn)), missingEntry };
  };

  return {
    chapters: (meta.chapters ?? []).map((chapter) => startsFor(chapter.files, chapter.entry)),
    whole: startsFor(
      meta.files.map((f) => f.path),
      ''
    ),
  };
}

/** The function an agent named, like "login", "login()" or "TicketService.changeStatus". */
function findEntry(project: FlowProject, text: string, files: string[]): FlowFunction | null {
  const wanted = text.trim().replace(/\(\s*\)$/, '').toLowerCase();
  if (!wanted) return null;
  const matches = (fn: FlowFunction): boolean =>
    [fn.name, fn.owner ? `${fn.owner}.${fn.name}` : '', fn.route ?? ''].some((name) => name.toLowerCase() === wanted);

  const all = [...project.functions.values()];
  return all.find((fn) => files.includes(fn.file) && matches(fn)) ?? all.find(matches) ?? null;
}

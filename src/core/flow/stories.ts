import { changedLinesByFile } from '../diffparse.js';
import type { LoadedStory, StoryMeta } from '../story.js';
import { changedLinesOf } from './graph.js';
import { summarise, type FlowProject, type FunctionSummary } from './resolve.js';

/**
 * The bridge from a story to the flow: which functions a change touched.
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

/**
 * The functions a change touched that nothing else in the same change calls:
 * where the change begins. Used for the Code map's "changed recently" list.
 */
export function changedFunctionsIn(
  project: FlowProject,
  files: string[],
  changed: Map<string, Set<number>>
): FunctionSummary[] {
  const touched = [...project.functions.values()]
    .filter((fn) => files.includes(fn.file) && changedLinesOf(project, fn, changed).length > 0)
    .sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file) || a.line - b.line);

  const ids = new Set(touched.map((fn) => fn.id));
  const called = new Set<string>();
  for (const fn of touched) {
    for (const target of project.targets.get(fn.id) ?? []) {
      if (target.kind === 'fn' && target.id !== fn.id && ids.has(target.id)) called.add(target.id);
    }
  }
  // A constructor only sets things up. A function declared inside another one
  // is reached through it. Neither is where the change really begins.
  const roots = touched.filter(
    (fn) => !called.has(fn.id) && !(fn.parent && ids.has(fn.parent)) && fn.name !== 'constructor'
  );
  return roots.slice(0, 6).map((fn) => summarise(project, fn));
}

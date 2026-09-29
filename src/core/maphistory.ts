import type { LoadedStory } from './story.js';

/**
 * The bridge between the code map and the stories.
 *
 * A call graph tells you what calls what. It cannot tell you why any of it
 * exists. Twomind already has that answer, written by the agent at the moment
 * it made each change, so the map borrows its sentences from the stories
 * instead of inventing new ones.
 *
 * Every sentence returned here was written by an agent about that exact file.
 * Nothing is generated at read time.
 */

export interface FileHistoryEntry {
  storyId: string;
  title: string;
  at: string;
  /** What the agent said about THIS file in that story. May be empty. */
  why: string;
  /** How the agent ranked this file in that change. */
  level: string;
}

export interface FileHistory {
  file: string;
  /** Newest first. */
  entries: FileHistoryEntry[];
  /** The most recent thing an agent said about this file, if anything. */
  latestWhy: string;
  changeCount: number;
}

export function historyForFile(stories: LoadedStory[], file: string): FileHistory {
  const entries: FileHistoryEntry[] = [];

  for (const { meta } of stories) {
    const touched = meta.files.find((f) => f.path === file);
    if (!touched) continue;
    entries.push({
      storyId: meta.id,
      title: meta.title,
      at: meta.createdAt,
      why: touched.why ?? '',
      level: touched.category,
    });
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    file,
    entries,
    latestWhy: entries.find((e) => e.why)?.why ?? '',
    changeCount: entries.length,
  };
}

/** Files nobody has ever explained: the honest blind spots of the map. */
export function unexplainedFiles(stories: LoadedStory[], allFiles: string[]): string[] {
  const explained = new Set<string>();
  for (const { meta } of stories) {
    for (const file of meta.files) {
      if (file.why) explained.add(file.path);
    }
  }
  return allFiles.filter((file) => !explained.has(file));
}

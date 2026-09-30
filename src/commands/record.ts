import { loadConfig } from '../core/config.js';
import { clearNote, readNote } from '../core/note.js';
import { resolveProjectPaths } from '../core/paths.js';
import { currentBranch, diffTrees, takeSnapshot } from '../core/snapshot.js';
import { buildStory, readLastRecorded, writeLastRecorded, writeStory } from '../core/story.js';

export interface RecordOptions {
  agent?: string;
  prompt?: string;
  fallbackSummary?: string;
  sessionId?: string;
  source?: 'agent' | 'record';
}

/**
 * `twomind record`: save the prepared agent note now.
 *
 * Claude's hook and Codex's end-of-turn notification normally call recordNow
 * automatically. This public command is the manual backup. It diffs the
 * working tree against the point where the last story was saved, attaches the
 * agent's note, and saves the story.
 */

/** Make sure there is a saved starting point, so the first `record` has something to compare with. */
export async function ensureStartingPoint(root: string): Promise<boolean> {
  if (readLastRecorded(root)) return true;
  const tree = await takeSnapshot(root, resolveProjectPaths(root).snapshots);
  if (!tree) return false;
  writeLastRecorded(root, tree);
  return true;
}

export async function recordNow(root: string, options: RecordOptions = {}): Promise<string> {
  const config = loadConfig(root);
  if (!config) return 'This project is not set up yet. Run "twomind init" first.';

  const after = await takeSnapshot(root, resolveProjectPaths(root).snapshots);
  if (!after) return 'Could not read the project. Is git set up, and is no merge or rebase in progress?';

  const last = readLastRecorded(root);
  if (!last) {
    writeLastRecorded(root, after);
    return 'There was no starting point yet. I saved one now. Changes from now on will be recorded.';
  }
  if (last.tree === after) return 'Nothing changed since the last saved story.';

  const diff = await diffTrees(root, last.tree, after, { maxPatchBytes: config.capture.maxPatchBytes });
  if (diff.files.length === 0) {
    writeLastRecorded(root, after);
    return 'Nothing changed since the last saved story.';
  }

  const note = readNote(root, last.at);
  const story = buildStory({
    root,
    diff,
    prompt: options.prompt ?? '',
    note,
    fallbackSummary: options.fallbackSummary ?? '',
    agent: options.agent ?? 'agent (record)',
    sessionId: options.sessionId ?? `record-${after.slice(0, 12)}`,
    branch: await currentBranch(root),
    includePrompt: config.capture.includePrompt,
    source: options.source ?? 'record',
  });

  writeStory(root, story);
  writeLastRecorded(root, after);
  if (note) clearNote(root);

  const files = `${diff.files.length} file${diff.files.length === 1 ? '' : 's'}`;
  return note
    ? `Saved: "${story.meta.title}" (${files}), explained by the agent.`
    : `Saved: "${story.meta.title}" (${files}). No note was found, so it has no explanation. ` +
        'Write .twomind/.local/note.json before running record next time.';
}

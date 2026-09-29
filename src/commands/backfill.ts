import { loadConfig } from '../core/config.js';
import { diffTrees, parentOf, recentCommits } from '../core/snapshot.js';
import { buildStory, listStories, writeStory } from '../core/story.js';

/**
 * Turn recent git history into stories.
 *
 * The point is that the dashboard is worth opening in the first minute, before
 * you have run a single prompt through it. A commit is a coarser unit than a
 * prompt — several prompts often end up in one commit — so these are marked
 * `source: "commit"` and the UI says where they came from.
 */
export async function backfillFromGit(root: string, limit = 15): Promise<number> {
  const config = loadConfig(root);
  if (!config) return 0;

  const commits = await recentCommits(root, limit);
  if (commits.length === 0) return 0;

  const existing = new Set(
    listStories(root)
      .map((s) => s.meta.commit?.hash)
      .filter(Boolean) as string[]
  );

  let made = 0;

  for (const commit of commits) {
    if (existing.has(commit.hash)) continue;

    let diff;
    try {
      // The repository's first commit has no parent, so it is diffed against
      // the empty tree instead of being silently dropped.
      const base = await parentOf(root, commit.hash);
      diff = await diffTrees(root, base, commit.hash, {
        maxPatchBytes: config.capture.maxPatchBytes,
      });
    } catch {
      continue;
    }

    if (diff.files.length === 0) continue;
    // Merge commits mostly restate other commits; they add noise, not understanding.
    if (diff.files.length > 400) continue;

    const story = buildStory({
      root,
      diff,
      prompt: '',
      // Commit history carries no agent explanation. The commit message body is
      // the closest thing to one, and the story is labelled as such.
      note: null,
      fallbackSummary: commit.body,
      agent: 'git history',
      sessionId: commit.hash,
      branch: '',
      includePrompt: false,
      source: 'commit',
      commit: { hash: commit.hash, shortHash: commit.shortHash, subject: commit.subject },
      createdAt: new Date(commit.date),
    });

    writeStory(root, story);
    made += 1;
  }

  return made;
}

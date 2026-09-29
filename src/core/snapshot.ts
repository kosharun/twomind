import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DIR_NAME } from './paths.js';
import { run, shortId } from './util.js';

/**
 * twomind's own bookkeeping must never be captured as "code the agent changed".
 *
 * Without this, writing a story is itself a working-tree change, so the very
 * next snapshot sees that story's own files as new — and turns THEM into
 * another story, whose files are seen as new by the tick after that, and so
 * on. Each generation's diff embeds the full text of the previous one (an
 * added file's diff IS its contents), so this isn't linear noise, it is
 * exponential: 1KB, then 4KB, 8KB, 16KB, 32KB of nothing but nested copies of
 * itself. This is checked in two places on purpose — excluding it from the git
 * pathspec below keeps the snapshot itself clean and fast, and `diffTrees`
 * filters again as the actual guarantee, since backfill diffs real commit
 * history directly and never goes through `takeSnapshot` at all.
 */
const EXCLUDE_PATHSPEC = `:(exclude)${DIR_NAME}/**`;
const OWN_PATH_PREFIX = `${DIR_NAME}/`;

function isOwnBookkeeping(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').startsWith(OWN_PATH_PREFIX);
}

/**
 * Snapshots of the working tree, taken without touching the user's git state.
 *
 * How it works: we point git at a THROWAWAY index file (GIT_INDEX_FILE), seed it
 * from the real index so the scan is incremental and fast, `git add -A` into it,
 * and `git write-tree` to get a tree object id. The user's staging area, branch,
 * HEAD and stash are never read or modified. The tree objects we create are
 * unreachable and get cleaned up by git's normal garbage collection.
 *
 * This is what lets us diff "before this prompt" against "after this prompt"
 * even when nothing was ever committed.
 */

export interface FileChange {
  path: string;
  /** Previous path, when the file was renamed. */
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  added: number;
  deleted: number;
  binary: boolean;
  /** Unified diff for this one file. Empty for binary or oversized files. */
  patch: string;
}

export interface DiffResult {
  files: FileChange[];
  totalAdded: number;
  totalDeleted: number;
  truncated: boolean;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const res = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeoutMs: 10_000 });
  return res.code === 0 && res.stdout.trim() === 'true';
}

export async function gitDir(cwd: string): Promise<string | null> {
  const res = await run('git', ['rev-parse', '--absolute-git-dir'], { cwd, timeoutMs: 10_000 });
  if (res.code !== 0) return null;
  return res.stdout.trim() || null;
}

export async function currentBranch(cwd: string): Promise<string> {
  const res = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 10_000 });
  return res.code === 0 ? res.stdout.trim() : '';
}

/**
 * Capture the current working tree as a git tree id.
 * Returns null when the repo is in a state we should not touch (merge conflict,
 * no git, etc.) — callers must treat that as "skip capture", never as an error.
 */
export async function takeSnapshot(root: string, scratchDir: string): Promise<string | null> {
  if (!(await isGitRepo(root))) return null;

  mkdirSync(scratchDir, { recursive: true });
  const tmpIndex = path.join(scratchDir, `index-${process.pid}-${Date.now()}-${shortId(String(Math.random()))}`);

  try {
    // Seed from the real index so `git add -A` only has to look at what moved.
    const gd = await gitDir(root);
    if (gd) {
      const realIndex = path.join(gd, 'index');
      if (existsSync(realIndex)) {
        try {
          copyFileSync(realIndex, tmpIndex);
        } catch {
          /* fall through: an empty index still works, just slower */
        }
      }
    }

    const env = { GIT_INDEX_FILE: tmpIndex };
    const add = await run('git', ['add', '-A', '--', '.', EXCLUDE_PATHSPEC], { cwd: root, env, timeoutMs: 120_000 });
    if (add.code !== 0) return null;

    const tree = await run('git', ['write-tree'], { cwd: root, env, timeoutMs: 60_000 });
    if (tree.code !== 0) return null;

    const sha = tree.stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  } finally {
    try {
      rmSync(tmpIndex, { force: true });
    } catch {
      /* best effort */
    }
  }
}

function parseNameStatus(text: string): Map<string, { status: FileChange['status']; oldPath?: string }> {
  const map = new Map<string, { status: FileChange['status']; oldPath?: string }>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0] ?? '';
    if (code.startsWith('R') && parts.length >= 3) {
      map.set(parts[2], { status: 'renamed', oldPath: parts[1] });
    } else if (parts.length >= 2) {
      const p = parts[1];
      if (code.startsWith('A')) map.set(p, { status: 'added' });
      else if (code.startsWith('D')) map.set(p, { status: 'deleted' });
      else map.set(p, { status: 'modified' });
    }
  }
  return map;
}

/** Split a multi-file unified diff into per-file chunks keyed by the new path. */
function splitPatch(patch: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!patch) return out;
  const lines = patch.split('\n');
  let current: string[] = [];
  let currentPath: string | null = null;

  const flush = () => {
    if (currentPath && current.length) out.set(currentPath, current.join('\n'));
    current = [];
    currentPath = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      // diff --git a/path/to/x b/path/to/x   (paths may be quoted when they contain spaces)
      const m = line.match(/^diff --git (?:"?a\/(.*?)"?) (?:"?b\/(.*?)"?)$/);
      currentPath = m ? m[2] : null;
      current.push(line);
    } else if (currentPath !== null) {
      current.push(line);
    }
  }
  flush();
  return out;
}

export async function diffTrees(
  root: string,
  before: string,
  after: string,
  opts: { maxPatchBytes?: number } = {}
): Promise<DiffResult> {
  const maxPatchBytes = opts.maxPatchBytes ?? 4 * 1024 * 1024;

  const [numstat, nameStatus, patchRes] = await Promise.all([
    run('git', ['diff', '--numstat', '-M', before, after], { cwd: root, timeoutMs: 120_000 }),
    run('git', ['diff', '--name-status', '-M', before, after], { cwd: root, timeoutMs: 120_000 }),
    run('git', ['diff', '--no-color', '--no-ext-diff', '--unified=3', '-M', before, after], {
      cwd: root,
      timeoutMs: 120_000,
      maxBuffer: maxPatchBytes * 2,
    }),
  ]);

  const statuses = parseNameStatus(nameStatus.stdout);
  const truncated = patchRes.stdout.length > maxPatchBytes;
  const patches = splitPatch(truncated ? patchRes.stdout.slice(0, maxPatchBytes) : patchRes.stdout);

  const files: FileChange[] = [];
  let totalAdded = 0;
  let totalDeleted = 0;

  for (const line of numstat.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [addRaw, delRaw] = parts;
    // Renames appear as "old => new" or with NUL-ish braces; the name-status
    // pass is authoritative, so prefer its path when we have one.
    let filePath = parts.slice(2).join('\t');
    if (filePath.includes(' => ')) {
      const m = filePath.match(/\{(.*) => (.*)\}/);
      filePath = m ? filePath.replace(/\{.*\}/, m[2]) : filePath.split(' => ').pop()!;
    }

    const meta = statuses.get(filePath) ?? { status: 'modified' as const };

    // Authoritative exclusion: this runs regardless of how `before`/`after`
    // were produced, so it also protects `backfill`, which diffs real commit
    // hashes directly and never passes through the pathspec exclude above —
    // a commit the user made themselves can easily contain earlier story
    // files (e.g. "git add -A && git commit"), and those must never be
    // recaptured as if they were a new code change either. This must happen
    // BEFORE totals are accumulated, or an excluded file's line counts still
    // leak into the story's "+N / -N" header.
    if (isOwnBookkeeping(filePath) || (meta.oldPath && isOwnBookkeeping(meta.oldPath))) continue;

    const binary = addRaw === '-' || delRaw === '-';
    const added = binary ? 0 : Number(addRaw) || 0;
    const deleted = binary ? 0 : Number(delRaw) || 0;
    totalAdded += added;
    totalDeleted += deleted;

    files.push({
      path: filePath,
      oldPath: meta.oldPath,
      status: meta.status,
      added,
      deleted,
      binary,
      patch: binary ? '' : patches.get(filePath) ?? '',
    });
  }

  return { files, totalAdded, totalDeleted, truncated };
}

/** Recent commits, used to backfill stories on first install. */
export interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  author: string;
  date: string;
}

export async function recentCommits(root: string, limit = 25): Promise<CommitInfo[]> {
  const sep = '\u001f';
  const rec = '\u001e';
  const res = await run(
    'git',
    ['log', `-${limit}`, `--pretty=format:%H${sep}%h${sep}%s${sep}%b${sep}%an${sep}%aI${rec}`],
    { cwd: root, timeoutMs: 60_000 }
  );
  if (res.code !== 0) return [];
  return res.stdout
    .split(rec)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, shortHash, subject, body, author, date] = chunk.split(sep);
      return { hash, shortHash, subject, body: (body ?? '').trim(), author, date };
    })
    .filter((c) => c.hash);
}

/** git's fixed id for an empty tree — the parent of a repository's first commit. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export async function parentOf(root: string, hash: string): Promise<string> {
  const res = await run('git', ['rev-parse', '--verify', `${hash}^`], { cwd: root, timeoutMs: 10_000 });
  return res.code === 0 && res.stdout.trim() ? res.stdout.trim() : EMPTY_TREE;
}

export async function diffCommit(root: string, hash: string, opts: { maxPatchBytes?: number } = {}): Promise<DiffResult> {
  const base = await parentOf(root, hash);
  return diffTrees(root, base, hash, opts).catch(() => ({
    files: [],
    totalAdded: 0,
    totalDeleted: 0,
    truncated: false,
  }));
}

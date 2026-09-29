/**
 * Unified diff -> structured lines the dashboard can render as before/after.
 *
 * We parse on the server so the browser gets something simple and already
 * numbered, and so the same parser is reused by any other consumer later.
 */

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface ParsedFileDiff {
  path: string;
  oldPath: string | null;
  lines: DiffLine[];
  /** True when git reported it as binary or we found no textual hunks. */
  empty: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedDiff(patch: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  if (!patch) return files;

  let current: ParsedFileDiff | null = null;
  let oldNo = 0;
  let newNo = 0;

  const push = () => {
    if (current) {
      current.empty = !current.lines.some((l) => l.type === 'add' || l.type === 'del');
      files.push(current);
    }
  };

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      push();
      const m = line.match(/^diff --git (?:"?a\/(.*?)"?) (?:"?b\/(.*?)"?)$/);
      current = { path: m ? m[2] : 'unknown', oldPath: m ? m[1] : null, lines: [], empty: true };
      oldNo = 0;
      newNo = 0;
      continue;
    }

    if (!current) continue;

    if (line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') ||
        line.startsWith('similarity index') || line.startsWith('rename ') || line.startsWith('old mode') ||
        line.startsWith('new mode') || line.startsWith('Binary files')) {
      current.lines.push({ type: 'meta', text: line, oldNo: null, newNo: null });
      continue;
    }

    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;

    const hunk = line.match(HUNK_RE);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      current.lines.push({ type: 'hunk', text: (hunk[5] ?? '').trim(), oldNo: null, newNo: null });
      continue;
    }

    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', text: line.slice(1), oldNo: null, newNo });
      newNo += 1;
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'del', text: line.slice(1), oldNo, newNo: null });
      oldNo += 1;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      continue;
    } else {
      current.lines.push({ type: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    }
  }

  push();
  return files;
}

/** Drop long runs of unchanged lines so a big file stays readable. */
export function collapseContext(lines: DiffLine[], keep = 3): DiffLine[] {
  const out: DiffLine[] = [];
  let run: DiffLine[] = [];

  const flushRun = () => {
    if (run.length <= keep * 2 + 1) {
      out.push(...run);
    } else {
      out.push(...run.slice(0, keep));
      out.push({
        type: 'hunk',
        text: `… ${run.length - keep * 2} unchanged lines …`,
        oldNo: null,
        newNo: null,
      });
      out.push(...run.slice(-keep));
    }
    run = [];
  };

  for (const line of lines) {
    if (line.type === 'ctx') {
      run.push(line);
    } else {
      flushRun();
      out.push(line);
    }
  }
  flushRun();
  return out;
}

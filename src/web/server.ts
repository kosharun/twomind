import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../core/config.js';
import { resolveProjectPaths } from '../core/paths.js';
import { scanProject } from '../core/scan.js';
import { collapseContext, parseUnifiedDiff } from '../core/diffparse.js';
import { listStories, loadStory, readLastSeen, writeLastSeen, type StoryMeta } from '../core/story.js';
import { buildCodeMap, busiestFiles, findSymbol, searchSymbols, type CodeMap } from '../core/codemap.js';
import { historyForFile } from '../core/maphistory.js';
import { createFlowCache } from '../core/flow/cache.js';
import { buildFlowGraph } from '../core/flow/graph.js';
import { FLOW_EXTENSIONS } from '../core/flow/parse.js';
import { flowStarts, searchFunctions } from '../core/flow/resolve.js';
import { changedFunctionsIn, reliableChangedLines } from '../core/flow/stories.js';
import { recordNow } from '../commands/record.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

interface StorySummary {
  id: string;
  title: string;
  createdAt: string;
  agent: string;
  branch: string;
  source: string;
  files: number;
  added: number;
  deleted: number;
  startHere: string[];
  headline: string;
  isNew: boolean;
}

function headlineFor(meta: StoryMeta): string {
  if (meta.explainedBy === 'none') return 'not explained by the agent';
  const chapters = meta.chapters?.length ?? 0;
  if (chapters) return `${chapters} chapter${chapters === 1 ? '' : 's'}`;
  return meta.groups.map((group) => `${group.files.length} ${group.category}`).join(' · ');
}

function summarise(meta: StoryMeta, lastSeen: string | null): StorySummary {
  return {
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    agent: meta.agent,
    branch: meta.branch,
    source: meta.source,
    files: meta.stats.files,
    added: meta.stats.added,
    deleted: meta.stats.deleted,
    startHere: meta.startHere,
    headline: headlineFor(meta),
    isNew: lastSeen ? meta.createdAt > lastSeen : false,
  };
}

interface CatchUp {
  since: string | null;
  /** Nothing has landed since you last looked, so this shows recent work instead. */
  upToDate: boolean;
  storyCount: number;
  fileCount: number;
  added: number;
  deleted: number;
  /** The most important things that happened, newest first. */
  highlights: Array<{ id: string; title: string; why: string }>;
  /** Areas that changed a lot in stories you have not opened. */
  blindSpots: Array<{ path: string; changes: number }>;
  newSymbols: string[];
}

function firstSentence(text: string | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  const match = flat.match(/^.{1,200}?[.!?](\s|$)/);
  return (match ? match[0] : flat.slice(0, 200)).trim();
}

function buildCatchUp(stories: Array<{ meta: StoryMeta }>, lastSeen: string | null): CatchUp {
  const since = lastSeen;
  const newer = since ? stories.filter((s) => s.meta.createdAt > since) : stories.slice(0, 10);
  // An empty page of zeros helps nobody. With nothing new, show recent work and say so.
  const upToDate = newer.length === 0 && stories.length > 0;
  const fresh = upToDate ? stories.slice(0, 5) : newer;

  const fileCounts = new Map<string, number>();
  let fileCount = 0;
  let added = 0;
  let deleted = 0;
  const newSymbols: string[] = [];

  for (const { meta } of fresh) {
    fileCount += meta.stats.files;
    added += meta.stats.added;
    deleted += meta.stats.deleted;
    newSymbols.push(...meta.newSymbols);
    for (const file of meta.files) {
      // Follow-ups the agent itself called small are not where attention belongs.
      if (file.category === 'small') continue;
      const dir = file.path.split('/').slice(0, 2).join('/');
      fileCounts.set(dir, (fileCounts.get(dir) ?? 0) + 1);
    }
  }

  const highlights = fresh.slice(0, 5).map(({ meta }) => {
    const lead = meta.files.find((f) => f.startHere);
    const why = firstSentence(meta.agentSummary) || lead?.why || 'The agent did not explain this change.';
    return { id: meta.id, title: meta.title, why };
  });

  const blindSpots = Array.from(fileCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([p, changes]) => ({ path: p, changes }));

  return {
    since,
    upToDate,
    storyCount: fresh.length,
    fileCount,
    added,
    deleted,
    highlights,
    blindSpots,
    newSymbols: Array.from(new Set(newSymbols)).slice(0, 12),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendFile(res: ServerResponse, filePath: string): void {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(filePath));
}

export interface ServeOptions {
  root: string;
  port: number;
  open: boolean;
}

/**
 * The code map is a full source scan, so it is built once on demand and then
 * reused. It is only structure: nothing in it goes stale in a way that misleads
 * you, and `?refresh=1` rebuilds it after a big change.
 */
function createMapCache(root: string) {
  let cached: CodeMap | null = null;
  return {
    get(refresh = false): CodeMap {
      if (refresh || !cached) cached = buildCodeMap(root);
      return cached;
    },
    invalidate(): void {
      cached = null;
    },
  };
}

export async function serve(options: ServeOptions): Promise<void> {
  const { root } = options;
  const config = loadConfig(root);
  const paths = resolveProjectPaths(root);
  const clients = new Set<ServerResponse>();
  const codeMap = createMapCache(root);
  const flows = createFlowCache(root);

  const broadcast = (event: string) => {
    for (const client of clients) {
      try {
        client.write(`event: ${event}\ndata: {}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const route = url.pathname;

    try {
      if (route === '/api/state') {
        const lastSeen = readLastSeen(root);
        const stories = listStories(root);
        sendJson(res, 200, {
          project: {
            name: config?.projectName ?? path.basename(root),
            summary: config?.summary ?? '',
            root,
          },
          lastSeen,
          catchUp: buildCatchUp(stories, lastSeen),
          stories: stories.map((s) => summarise(s.meta, lastSeen)),
        });
        return;
      }

      // ---- flows: what a function calls, and when ----

      if (route === '/api/flow') {
        const project = flows.get(url.searchParams.get('refresh') === '1');
        const stories = listStories(root);
        // The functions the last few changes touched, so the map starts where the work was.
        const recent = stories.slice(0, 5).flatMap(({ meta }) => {
          const story = loadStory(root, meta.id);
          if (!story) return [];
          const changed = reliableChangedLines(meta, story.patch, stories);
          const functions = changedFunctionsIn(
            project,
            meta.files.map((f) => f.path),
            changed
          ).slice(0, 4);
          return functions.length ? [{ storyId: meta.id, title: meta.title, at: meta.createdAt, functions }] : [];
        });
        sendJson(res, 200, {
          builtAt: project.builtAt,
          fileCount: project.files.size,
          functionCount: project.functions.size,
          unreadable: project.parseErrors.map((e) => e.file),
          ...flowStarts(project),
          recent,
        });
        return;
      }

      if (route === '/api/flow/search') {
        sendJson(res, 200, { results: searchFunctions(flows.get(), url.searchParams.get('q') ?? '') });
        return;
      }

      if (route === '/api/flow/graph') {
        const project = flows.get();
        const id = url.searchParams.get('id') ?? '';
        const depth = Math.min(6, Math.max(1, Number(url.searchParams.get('depth')) || 3));
        const storyId = url.searchParams.get('story');
        const stories = listStories(root);

        let changedLines: Map<string, Set<number>> | undefined;
        if (storyId) {
          const story = loadStory(root, storyId);
          if (story) changedLines = reliableChangedLines(story.meta, story.patch, stories);
        }

        const graph = buildFlowGraph(project, id, { depth, changedLines });
        if (!graph) {
          sendJson(res, 404, { error: 'that function is not in the code any more' });
          return;
        }
        // The only sentences in a flow: what agents wrote about each file.
        const why: Record<string, string> = {};
        for (const node of graph.nodes) {
          if (node.file && !(node.file in why)) why[node.file] = historyForFile(stories, node.file).latestWhy;
        }
        sendJson(res, 200, { ...graph, why });
        return;
      }

      if (route === '/api/flow/outline') {
        const project = flows.get();
        const files = (url.searchParams.get('files') ?? '')
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean);
        const byFile: Record<
          string,
          Array<{ name: string; owner: string | null; kind: string; route: string | null; line: number; endLine: number }>
        > = {};
        for (const file of files) {
          byFile[file] = [...project.functions.values()]
            // Only the definitions a reader would recognise as "a part of this file":
            // not the whole-file pseudo-entry, and not a callback declared inside another function.
            .filter((fn) => fn.file === file && fn.parent === null && fn.name !== '(top level)')
            .sort((a, b) => a.line - b.line)
            .map((fn) => ({ name: fn.name, owner: fn.owner, kind: fn.kind, route: fn.route, line: fn.line, endLine: fn.endLine }));
        }
        sendJson(res, 200, byFile);
        return;
      }

      if (route.startsWith('/api/story/')) {
        const id = decodeURIComponent(route.slice('/api/story/'.length));
        const story = loadStory(root, id);
        if (!story) {
          sendJson(res, 404, { error: 'story not found' });
          return;
        }
        const parsed = parseUnifiedDiff(story.patch).map((file) => ({
          ...file,
          lines: collapseContext(file.lines),
        }));
        sendJson(res, 200, { meta: story.meta, diffs: parsed });
        return;
      }

      // ---- code map ----

      if (route === '/api/map') {
        const map = codeMap.get(url.searchParams.get('refresh') === '1');
        const stories = listStories(root);
        sendJson(res, 200, {
          builtAt: map.builtAt,
          fileCount: map.files.length,
          symbolCount: map.symbols.length,
          skipped: map.skipped,
          busiest: busiestFiles(map).map((entry) => ({
            ...entry,
            latestWhy: historyForFile(stories, entry.file).latestWhy,
          })),
        });
        return;
      }

      if (route === '/api/map/search') {
        // Functions understood by a flow reader are searched above. This adds
        // classes, types, file paths, and names from every other readable file.
        const results = searchSymbols(codeMap.get(), url.searchParams.get('q') ?? '').filter(
          (hit) =>
            !FLOW_EXTENSIONS.has(path.extname(hit.file).toLowerCase()) ||
            hit.kind === 'class' ||
            hit.kind === 'type' ||
            hit.kind === 'file'
        );
        sendJson(res, 200, { results });
        return;
      }

      if (route === '/api/map/symbol') {
        const name = url.searchParams.get('name') ?? '';
        const hit = findSymbol(codeMap.get(), name);
        if (!hit) {
          sendJson(res, 404, { error: `no symbol named "${name}" was found` });
          return;
        }
        const stories = listStories(root);
        sendJson(res, 200, {
          ...hit,
          // Every sentence here was written by an agent about this file.
          history: historyForFile(stories, hit.symbol.file),
          usedBy: hit.usedBy.map((file) => ({ file, latestWhy: historyForFile(stories, file).latestWhy })),
        });
        return;
      }

      if (route === '/api/seen' && req.method === 'POST') {
        writeLastSeen(root);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (route === '/api/project') {
        sendJson(res, 200, scanProject(root));
        return;
      }

      if (route === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        clients.add(res);
        const keepAlive = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            /* dropped below */
          }
        }, 25_000);
        req.on('close', () => {
          clearInterval(keepAlive);
          clients.delete(res);
        });
        return;
      }

      const asset = route === '/' ? 'index.html' : route.replace(/^\/+/, '');
      const filePath = path.join(PUBLIC_DIR, asset);
      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      sendFile(res, filePath);
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  });

  // Live updates: push as soon as a story lands, so the page reflects the agent
  // while it is still working instead of after it finishes.
  let debounce: NodeJS.Timeout | null = null;
  const onChange = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => broadcast('stories'), 250);
  };

  try {
    watch(paths.stories, { recursive: true }, onChange);
  } catch {
    // Recursive watching is not available on every platform; fall back to polling.
    let lastCount = -1;
    setInterval(() => {
      const count = listStories(root).length;
      if (count !== lastCount) {
        lastCount = count;
        onChange();
      }
    }, 2000);
  }

  // Claude normally records through its Stop hook. If Claude wrote the note but
  // that final hook was blocked by workspace trust, a shell difference, or an
  // extension problem, the open dashboard is a second safe path. It waits so
  // the normal hook gets the first chance, then records only while the note is
  // still present. After a successful hook, recordNow sees the same saved
  // snapshot and exits without creating another story.
  const noteFile = path.join(paths.local, 'note.json');
  let noteTimer: NodeJS.Timeout | null = null;
  let noteRecording = false;
  const scheduleNoteBackup = () => {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      noteTimer = null;
      if (noteRecording || !existsSync(noteFile)) return;
      noteRecording = true;
      try {
        const result = await recordNow(root, { agent: 'dashboard backup', source: 'record' });
        if (result.startsWith('Saved:')) {
          codeMap.invalidate();
          flows.get(true);
          broadcast('stories');
        }
      } finally {
        noteRecording = false;
      }
    }, 5000);
  };
  try {
    watch(paths.local, (_event, filename) => {
      if (String(filename ?? '').replace(/\\/g, '/') === 'note.json') scheduleNoteBackup();
    });
    if (existsSync(noteFile)) scheduleNoteBackup();
  } catch {
    // Hooks and `twomind record` still work when this optional watcher is not
    // available on a filesystem.
  }

  await new Promise<void>((resolve) => {
    server.listen(options.port, '127.0.0.1', resolve);
  });

  const address = `http://localhost:${options.port}`;
  console.log('');
  console.log(`  \u001b[1mtwomind\u001b[0m  ${address}`);
  console.log(`  \u001b[2m${root}\u001b[0m`);
  console.log(`  \u001b[2mleave this running in a second window, it updates itself\u001b[0m`);
  console.log('');

  if (options.open) {
    const { spawn } = await import('node:child_process');
    try {
      // No shell:true on Windows: Node 24 deprecates that combination, and
      // "start" needs an explicit empty title argument when run via cmd /c.
      if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', '""', address], { detached: true, stdio: 'ignore' }).unref();
      } else {
        const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
        spawn(opener, [address], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch {
      /* the URL is printed above either way */
    }
  }
}

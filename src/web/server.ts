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
  const fresh = since ? stories.filter((s) => s.meta.createdAt > since) : stories.slice(0, 10);

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
 * reused. It is only structure — nothing in it goes stale in a way that misleads
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
        const map = codeMap.get();
        sendJson(res, 200, { results: searchSymbols(map, url.searchParams.get('q') ?? '') });
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

  // No file watcher that guesses at changes: stories are written only by the
  // agent's own hooks (or `twomind record`), with the agent's own explanation.
  // This server just shows them, and pushes an update the moment one lands.

  await new Promise<void>((resolve) => {
    server.listen(options.port, '127.0.0.1', resolve);
  });

  const address = `http://localhost:${options.port}`;
  console.log('');
  console.log(`  \u001b[1mtwomind\u001b[0m  ${address}`);
  console.log(`  \u001b[2m${root}\u001b[0m`);
  console.log(`  \u001b[2mleave this running in a second window — it updates itself\u001b[0m`);
  console.log('');

  if (options.open) {
    const { spawn } = await import('node:child_process');
    try {
      // No shell:true on Windows — Node 24 deprecates that combination, and
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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The code map: what exists, and what uses it.
 *
 * Two honest halves, kept strictly apart:
 *
 *   structure  - read from the source text. Deterministic, free, and checkable.
 *                Who defines a name, and which files mention it.
 *   meaning    - never invented here. It comes from the stories the agent wrote
 *                (see attachStories), so every sentence in the map was written
 *                by an agent that actually made that change.
 *
 * The extraction is regex-based, not a full parse. That is a deliberate
 * trade-off: no native build step, works on any language we have a pattern for,
 * and good enough to answer "who calls this?". It can miss things, so the UI
 * says "read from the code" rather than claiming completeness.
 */

export interface SymbolDef {
  name: string;
  /** Repo-relative, forward slashes. */
  file: string;
  line: number;
  kind: 'function' | 'class' | 'component' | 'type' | 'const';
  exported: boolean;
}

export interface FileNode {
  file: string;
  defines: string[];
  /** Files this one imports, resolved to repo-relative paths where possible. */
  imports: string[];
  lines: number;
}

export interface CodeMap {
  builtAt: string;
  root: string;
  files: FileNode[];
  symbols: SymbolDef[];
  /** symbol name -> files that mention it (excluding where it is defined). */
  usedBy: Record<string, string[]>;
  skipped: number;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'target', '.twomind',
  'graphify-out', '.svelte-kit', '.turbo', 'bin', 'obj',
]);

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.php', '.java', '.cs', '.vue', '.svelte']);

const MAX_FILES = 4000;
const MAX_FILE_BYTES = 500_000;

interface Pattern {
  re: RegExp;
  kind: SymbolDef['kind'];
}

/**
 * One pass per pattern, with `d` so we get the index of the captured name and
 * can turn it into a line number. Order matters: the first pattern that claims
 * a name on a line wins.
 */
const DEFINITION_PATTERNS: Pattern[] = [
  { re: /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/gm, kind: 'function' },
  { re: /^[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, kind: 'class' },
  { re: /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=][^=\n]*?=>/gm, kind: 'function' },
  { re: /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/gm, kind: 'function' },
  { re: /^[ \t]*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm, kind: 'type' },
  { re: /^[ \t]*def\s+([A-Za-z_]\w*)\s*\(/gm, kind: 'function' },
  { re: /^[ \t]*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm, kind: 'function' },
];

const IMPORT_PATTERNS: RegExp[] = [
  /^[ \t]*import\s+[^'"]*from\s+['"]([^'"]+)['"]/gm,
  /^[ \t]*import\s+['"]([^'"]+)['"]/gm,
  /require\(\s*['"]([^'"]+)['"]\s*\)/gm,
  /^[ \t]*from\s+([\w.]+)\s+import\b/gm,
];

/** Names so common that "who uses this" would be pure noise. */
const NOISE = new Set([
  'main', 'init', 'setup', 'run', 'test', 'index', 'default', 'get', 'set', 'add',
  'remove', 'update', 'create', 'delete', 'render', 'handler', 'value', 'data',
  'props', 'state', 'result', 'error', 'config', 'options', 'params', 'item', 'items',
  'toString', 'constructor', 'map', 'filter', 'reduce', 'length', 'name', 'type', 'id',
]);

const isNoise = (name: string): boolean =>
  name.length < 4 || NOISE.has(name) || /^(handle|on)[A-Z]/.test(name);

const rel = (root: string, file: string): string => path.relative(root, file).replace(/\\/g, '/');

function listCodeFiles(root: string): { files: string[]; skipped: number } {
  const files: string[] = [];
  let skipped = 0;

  const walk = (dir: string, depth: number): void => {
    if (files.length >= MAX_FILES || depth > 10) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(full, depth + 1);
      } else if (CODE_EXT.has(path.extname(entry.name).toLowerCase())) {
        try {
          if (statSync(full).size > MAX_FILE_BYTES) {
            skipped += 1;
            continue;
          }
        } catch {
          continue;
        }
        files.push(full);
      }
    }
  };

  walk(root, 0);
  return { files, skipped };
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function definitionsIn(text: string, file: string): SymbolDef[] {
  const found = new Map<string, SymbolDef>();

  for (const { re, kind } of DEFINITION_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const name = match[1];
      if (!name || found.has(name)) continue;
      const isComponent = /^[A-Z]/.test(name) && /\.(jsx|tsx)$/.test(file);
      found.set(name, {
        name,
        file,
        line: lineOf(text, match.index),
        kind: isComponent ? 'component' : kind,
        exported: /^[ \t]*export\b/.test(match[0]),
      });
    }
  }

  return [...found.values()];
}

/** Turn `../services/auth` into a repo-relative path we can actually link to. */
function resolveImport(root: string, fromFile: string, spec: string, known: Set<string>): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'].map((ext) => base + ext),
    ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((name) => path.join(base, name)),
  ];
  for (const candidate of candidates) {
    const relative = rel(root, candidate);
    if (known.has(relative)) return relative;
  }
  return null;
}

export function buildCodeMap(root: string): CodeMap {
  const { files: absoluteFiles, skipped } = listCodeFiles(root);
  const knownPaths = new Set(absoluteFiles.map((f) => rel(root, f)));

  const contents = new Map<string, string>();
  const symbols: SymbolDef[] = [];
  const nodes: FileNode[] = [];

  for (const absolute of absoluteFiles) {
    let text: string;
    try {
      text = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    const file = rel(root, absolute);
    contents.set(file, text);

    const defined = definitionsIn(text, file);
    symbols.push(...defined);

    const imports = new Set<string>();
    for (const re of IMPORT_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const resolved = resolveImport(root, absolute, match[1], knownPaths);
        if (resolved && resolved !== file) imports.add(resolved);
      }
    }

    nodes.push({
      file,
      defines: defined.map((d) => d.name),
      imports: [...imports],
      lines: text.split('\n').length,
    });
  }

  // Who mentions each name. One scan per file against the names we know about,
  // using a word-boundary match so `pay` does not match `payment`.
  const usedBy: Record<string, string[]> = {};
  const interesting = symbols.filter((s) => !isNoise(s.name));

  for (const [file, text] of contents) {
    for (const symbol of interesting) {
      if (symbol.file === file) continue;
      if (!text.includes(symbol.name)) continue; // cheap reject before the regex
      const re = new RegExp(`\\b${symbol.name}\\b`);
      if (!re.test(text)) continue;
      (usedBy[symbol.name] ??= []).push(file);
    }
  }

  return {
    builtAt: new Date().toISOString(),
    root,
    files: nodes,
    symbols,
    usedBy,
    skipped,
  };
}

export interface SymbolHit {
  symbol: SymbolDef;
  usedBy: string[];
  /** Names defined elsewhere that this symbol's own file imports or mentions. */
  uses: string[];
}

export function findSymbol(map: CodeMap, name: string): SymbolHit | null {
  const symbol =
    map.symbols.find((s) => s.name === name) ??
    map.symbols.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!symbol) return null;

  const ownFile = map.files.find((f) => f.file === symbol.file);
  const uses = ownFile
    ? map.symbols
        .filter((other) => other.name !== symbol.name && ownFile.imports.includes(other.file))
        .map((other) => other.name)
    : [];

  return {
    symbol,
    usedBy: map.usedBy[symbol.name] ?? [],
    uses: [...new Set(uses)].slice(0, 40),
  };
}

export interface SearchResult {
  name: string;
  file: string;
  kind: SymbolDef['kind'];
  usedByCount: number;
}

export function searchSymbols(map: CodeMap, query: string, limit = 30): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored = map.symbols
    .map((symbol) => {
      const name = symbol.name.toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 70;
      else if (name.includes(q)) score = 40;
      else if (symbol.file.toLowerCase().includes(q)) score = 15;
      if (score === 0) return null;
      if (symbol.exported) score += 5;
      return { symbol, score, used: (map.usedBy[symbol.name] ?? []).length };
    })
    .filter((x): x is { symbol: SymbolDef; score: number; used: number } => x !== null);

  scored.sort((a, b) => b.score - a.score || b.used - a.used || a.symbol.name.localeCompare(b.symbol.name));

  return scored.slice(0, limit).map(({ symbol, used }) => ({
    name: symbol.name,
    file: symbol.file,
    kind: symbol.kind,
    usedByCount: used,
  }));
}

/** The busiest files, used for the map's opening view. */
export function busiestFiles(map: CodeMap, limit = 12): Array<{ file: string; defines: number; usedBy: number }> {
  const incoming = new Map<string, number>();
  for (const node of map.files) {
    for (const target of node.imports) incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }

  return map.files
    .map((node) => ({ file: node.file, defines: node.defines.length, usedBy: incoming.get(node.file) ?? 0 }))
    .sort((a, b) => b.usedBy - a.usedBy || b.defines - a.defines)
    .slice(0, limit);
}

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { estimateTokens, safeJsonParse } from './util.js';

/**
 * A cheap look at a project so the setup interview can propose answers instead
 * of asking you to type them. Nothing here is definitive: every finding is
 * shown to you as "is this right?", because confirming beats recalling.
 */

export interface ExistingContextFile {
  file: string;
  bytes: number;
  lines: number;
  estTokens: number;
}

export interface ScanResult {
  name: string;
  description: string;
  languages: string[];
  frameworks: string[];
  packageManager: string | null;
  testCommand: string | null;
  databases: string[];
  topFolders: string[];
  /** AI instruction files an agent has to read before it starts work. */
  contextFiles: ExistingContextFile[];
  contextTokens: number;
  hasGit: boolean;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  'vendor', '__pycache__', '.venv', 'venv', 'target', '.gradle', '.idea', '.vscode',
  'graphify-out', '.twomind',
]);

const CONTEXT_CANDIDATES = [
  'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules',
  '.github/copilot-instructions.md', '.windsurfrules',
];

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return safeJsonParse<T>(readFileSync(file, 'utf8'), fallback);
}

function collectDir(dir: string, out: string[], depth: number): void {
  if (depth <= 0) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    out.push(entry.name);
  }
}

function countExtensions(root: string, maxFiles = 4000): Map<string, number> {
  const counts = new Map<string, number>();
  let seen = 0;

  const walk = (dir: string, depth: number) => {
    if (seen >= maxFiles || depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen >= maxFiles) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!ext) continue;
        counts.set(ext, (counts.get(ext) ?? 0) + 1);
        seen += 1;
      }
    }
  };

  walk(root, 0);
  return counts;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python', '.go': 'Go', '.rs': 'Rust',
  '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin', '.scala': 'Scala', '.groovy': 'Groovy',
  '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.fs': 'F#', '.fsx': 'F#',
  '.swift': 'Swift', '.dart': 'Dart', '.c': 'C', '.h': 'C/C++', '.cc': 'C++',
  '.cpp': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.m': 'Objective-C', '.mm': 'Objective-C++',
  '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang', '.hrl': 'Erlang', '.lua': 'Lua',
  '.r': 'R', '.jl': 'Julia', '.pl': 'Perl', '.pm': 'Perl', '.sh': 'Shell', '.bash': 'Shell',
  '.zsh': 'Shell', '.ps1': 'PowerShell', '.sql': 'SQL', '.sol': 'Solidity', '.move': 'Move',
  '.zig': 'Zig', '.nim': 'Nim', '.clj': 'Clojure', '.cljs': 'ClojureScript', '.hs': 'Haskell',
  '.vue': 'Vue', '.svelte': 'Svelte',
};

export function scanProject(root: string): ScanResult {
  const pkg = readJson<Record<string, any>>(path.join(root, 'package.json'), {});
  const pomFile = path.join(root, 'pom.xml');
  const pom = existsSync(pomFile) ? readFileSync(pomFile, 'utf8') : '';
  const gradleFile = ['build.gradle', 'build.gradle.kts'].map((name) => path.join(root, name)).find(existsSync);
  const gradle = gradleFile ? readFileSync(gradleFile, 'utf8') : '';
  const deps: Record<string, string> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const depNames = Object.keys(deps);

  const extCounts = countExtensions(root);
  const languages = Array.from(extCounts.entries())
    .filter(([ext]) => LANGUAGE_BY_EXT[ext])
    .reduce<Map<string, number>>((acc, [ext, n]) => {
      const lang = LANGUAGE_BY_EXT[ext];
      acc.set(lang, (acc.get(lang) ?? 0) + n);
      return acc;
    }, new Map())
    .entries();

  const sortedLanguages = Array.from(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([lang]) => lang);

  const frameworks: string[] = [];
  const has = (name: string) => depNames.some((d) => d === name || d.startsWith(`${name}/`) || d.startsWith(`@${name}/`));
  if (has('react')) frameworks.push('React');
  if (has('next')) frameworks.push('Next.js');
  if (has('vue')) frameworks.push('Vue');
  if (has('svelte')) frameworks.push('Svelte');
  if (has('express')) frameworks.push('Express');
  if (has('fastify')) frameworks.push('Fastify');
  if (has('@nestjs')) frameworks.push('NestJS');
  if (has('vite')) frameworks.push('Vite');
  if (existsSync(path.join(root, 'manage.py'))) frameworks.push('Django');
  if (existsSync(path.join(root, 'Gemfile'))) frameworks.push('Rails');
  if (existsSync(path.join(root, 'artisan'))) frameworks.push('Laravel');
  if (/org\.springframework|spring-boot/i.test(`${pom}\n${gradle}`)) frameworks.push('Spring');

  const databases: string[] = [];
  if (has('mongoose') || has('mongodb')) databases.push('MongoDB');
  if (has('pg') || has('postgres') || has('@prisma')) databases.push('PostgreSQL');
  if (has('mysql') || has('mysql2')) databases.push('MySQL');
  if (has('sqlite3') || has('better-sqlite3')) databases.push('SQLite');
  if (has('redis') || has('ioredis')) databases.push('Redis');
  if (has('prisma') || has('@prisma/client')) databases.push('Prisma');
  if (/postgresql/i.test(`${pom}\n${gradle}`)) databases.push('PostgreSQL');
  if (/mysql/i.test(`${pom}\n${gradle}`)) databases.push('MySQL');
  if (/mongodb/i.test(`${pom}\n${gradle}`)) databases.push('MongoDB');
  if (/h2database/i.test(`${pom}\n${gradle}`)) databases.push('H2');

  let packageManager: string | null = null;
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (existsSync(path.join(root, 'yarn.lock'))) packageManager = 'yarn';
  else if (existsSync(path.join(root, 'package-lock.json'))) packageManager = 'npm';
  else if (existsSync(path.join(root, 'requirements.txt')) || existsSync(path.join(root, 'pyproject.toml'))) packageManager = 'pip';
  else if (existsSync(pomFile)) packageManager = 'Maven';
  else if (gradleFile) packageManager = 'Gradle';

  const scripts: Record<string, string> = pkg.scripts ?? {};
  let testCommand = scripts.test ? `${packageManager ?? 'npm'} test` : null;
  if (!testCommand && existsSync(pomFile)) {
    testCommand = existsSync(path.join(root, 'mvnw.cmd')) ? '.\\mvnw.cmd test' : 'mvn test';
  } else if (!testCommand && gradleFile) {
    testCommand = existsSync(path.join(root, 'gradlew.bat')) ? '.\\gradlew.bat test' : 'gradle test';
  }

  const topFolders: string[] = [];
  collectDir(root, topFolders, 1);

  const contextFiles: ExistingContextFile[] = [];
  const candidates = [...CONTEXT_CANDIDATES];
  // The .ai/ convention (one file per kind of fact) is common enough to check for.
  const aiDir = path.join(root, '.ai');
  if (existsSync(aiDir)) {
    try {
      for (const entry of readdirSync(aiDir)) {
        if (entry.endsWith('.md')) candidates.push(path.join('.ai', entry));
      }
    } catch {
      /* ignore */
    }
  }

  for (const rel of candidates) {
    const full = path.join(root, rel);
    if (!existsSync(full)) continue;
    try {
      const text = readFileSync(full, 'utf8');
      contextFiles.push({
        file: rel.replace(/\\/g, '/'),
        bytes: statSync(full).size,
        lines: text.split('\n').length,
        estTokens: estimateTokens(text.length),
      });
    } catch {
      /* ignore */
    }
  }

  return {
    name: pkg.name ?? path.basename(root),
    description: pkg.description ?? '',
    languages: sortedLanguages,
    frameworks,
    packageManager,
    testCommand,
    databases,
    topFolders: topFolders.slice(0, 12),
    contextFiles,
    contextTokens: contextFiles.reduce((n, f) => n + f.estTokens, 0),
    hasGit: existsSync(path.join(root, '.git')),
  };
}

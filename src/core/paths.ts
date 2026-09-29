import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { run } from './util.js';

export const DIR_NAME = '.twomind';

export interface ProjectPaths {
  /** Repository / project root. */
  root: string;
  /** <root>/.twomind */
  base: string;
  /** Committed, human-readable knowledge. */
  project: string;
  stories: string;
  map: string;
  inbox: string;
  /** Gitignored: raw prompts, snapshots, caches. */
  local: string;
  snapshots: string;
  configFile: string;
}

export function resolveProjectPaths(root: string): ProjectPaths {
  const base = path.join(root, DIR_NAME);
  return {
    root,
    base,
    project: path.join(base, 'project'),
    stories: path.join(base, 'stories'),
    map: path.join(base, 'map'),
    inbox: path.join(base, 'inbox'),
    local: path.join(base, '.local'),
    snapshots: path.join(base, '.local', 'snapshots'),
    configFile: path.join(base, 'config.json'),
  };
}

/**
 * Find the project root: the nearest ancestor holding a real project (a
 * .twomind/config.json), else the git top level, else where we started.
 *
 * Two things this must not do:
 *  - treat the per-user profile at ~/.twomind as a project, which would make
 *    every repository under the home directory resolve to the home directory
 *  - match a bare .twomind folder with no config, which is not a project yet
 */
export async function findProjectRoot(start = process.cwd()): Promise<string> {
  let dir = path.resolve(start);
  const { root: fsRoot } = path.parse(dir);
  const home = path.resolve(homedir());

  while (true) {
    if (dir !== home && existsSync(path.join(dir, DIR_NAME, 'config.json'))) return dir;
    if (dir === fsRoot) break;
    dir = path.dirname(dir);
  }

  const res = await run('git', ['rev-parse', '--show-toplevel'], { cwd: start, timeoutMs: 10_000 });
  if (res.code === 0) {
    const top = res.stdout.trim();
    if (top) return path.resolve(top);
  }
  return path.resolve(start);
}

export function ensureDirs(p: ProjectPaths): void {
  for (const dir of [p.base, p.project, path.join(p.project, 'rules'), path.join(p.project, 'decisions'), p.stories, p.map, p.inbox, p.local, p.snapshots]) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Per-user data that never belongs to one project. */
export function userHome(): string {
  return path.join(homedir(), DIR_NAME);
}

export function isInitialised(root: string): boolean {
  if (path.resolve(root) === path.resolve(homedir())) return false;
  return existsSync(path.join(root, DIR_NAME, 'config.json'));
}

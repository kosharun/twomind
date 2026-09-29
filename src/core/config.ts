import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveProjectPaths } from './paths.js';
import { safeJsonParse } from './util.js';

export interface TwomindConfig {
  version: 1;
  projectName: string;
  /** Short plain-English description, from the interview or the README. */
  summary: string;
  createdAt: string;
  capture: {
    /** Store the (redacted) prompt text inside the committed story. */
    includePrompt: boolean;
    /** Skip stories when the change is this small and touches nothing important. */
    minChangedLines: number;
    /** Hard cap so one huge refactor cannot write a 50 MB patch file. */
    maxPatchBytes: number;
    /** Paths never captured or shown, on top of .gitignore. */
    ignore: string[];
  };
  dashboard: {
    port: number;
  };
  agents: {
    claudeCode: boolean;
    codex: boolean;
  };
}

export function defaultConfig(projectName: string): TwomindConfig {
  return {
    version: 1,
    projectName,
    summary: '',
    createdAt: new Date().toISOString(),
    capture: {
      includePrompt: true,
      minChangedLines: 1,
      maxPatchBytes: 4 * 1024 * 1024,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**', '**/*.lock', '**/package-lock.json'],
    },
    dashboard: { port: 4317 },
    agents: { claudeCode: true, codex: true },
  };
}

export function loadConfig(root: string): TwomindConfig | null {
  const { configFile } = resolveProjectPaths(root);
  if (!existsSync(configFile)) return null;
  const raw = readFileSync(configFile, 'utf8');
  const parsed = safeJsonParse<Partial<TwomindConfig> | null>(raw, null);
  if (!parsed) return null;
  const base = defaultConfig(parsed.projectName ?? 'project');
  return {
    ...base,
    ...parsed,
    capture: { ...base.capture, ...(parsed.capture ?? {}) },
    dashboard: { ...base.dashboard, ...(parsed.dashboard ?? {}) },
    agents: { ...base.agents, ...(parsed.agents ?? {}) },
  } as TwomindConfig;
}

export function saveConfig(root: string, config: TwomindConfig): void {
  const { configFile } = resolveProjectPaths(root);
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

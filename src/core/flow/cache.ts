import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { listCodeFiles } from '../codemap.js';
import { FLOW_EXTENSIONS, readFlowFacts, type FileFacts } from './parse.js';
import { buildFlowProject, readPathAliases, type FlowProject } from './resolve.js';

/**
 * Keeps the parsed project in memory and parses again only the files that
 * changed on disk.
 *
 * The check runs at most every few seconds, so clicking around a flow does not
 * walk the whole folder on every request, but a change the agent just made
 * shows up the next time a flow opens.
 */
export function createFlowCache(root: string, recheckMs = 4000) {
  const parsed = new Map<string, { mtimeMs: number; size: number; facts: FileFacts }>();
  let project: FlowProject | null = null;
  let checkedAt = 0;

  return {
    get(force = false): FlowProject {
      if (project && !force && Date.now() - checkedAt < recheckMs) return project;
      checkedAt = Date.now();

      let changed = project === null;
      const seen = new Set<string>();
      for (const absolute of listCodeFiles(root, FLOW_EXTENSIONS).files) {
        // Declaration files and minified bundles have no flow worth reading.
        if (/\.d\.[mc]?ts$|\.min\.[mc]?js$/.test(absolute)) continue;
        const file = path.relative(root, absolute).replace(/\\/g, '/');
        seen.add(file);

        let stat;
        try {
          stat = statSync(absolute);
        } catch {
          continue;
        }
        const cached = parsed.get(file);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) continue;

        let text: string;
        try {
          text = readFileSync(absolute, 'utf8');
        } catch {
          continue;
        }
        parsed.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, facts: readFlowFacts(file, text) });
        changed = true;
      }

      for (const file of [...parsed.keys()]) {
        if (seen.has(file)) continue;
        parsed.delete(file);
        changed = true;
      }

      if (changed || !project) {
        project = buildFlowProject(
          root,
          [...parsed.values()].map((entry) => entry.facts),
          readPathAliases(root)
        );
      }
      return project;
    },
  };
}

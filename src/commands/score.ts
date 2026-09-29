import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { findProjectRoot } from '../core/paths.js';
import { scanProject } from '../core/scan.js';
import { recentCommits, isGitRepo } from '../core/snapshot.js';
import { estimateTokens } from '../core/util.js';

/**
 * `twomind score`: runs on any repository, with nothing installed.
 *
 * It answers one question in about ten seconds: how much of this codebase has
 * drifted away from anyone's understanding? Every number is measured, not
 * guessed, and every number links to something you can act on.
 */

const c = {
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  yellow: (s: string) => `\u001b[33m${s}\u001b[0m`,
  red: (s: string) => `\u001b[31m${s}\u001b[0m`,
  cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'target', '.twomind', 'graphify-out',
]);

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.php', '.java', '.cs']);

const FN_PATTERNS: RegExp[] = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[:=][^=\n]*=>/gm,
  /^\s*def\s+([A-Za-z_]\w*)\s*\(/gm,
  /^\s*func\s+([A-Za-z_]\w*)\s*\(/gm,
];

const COMMON_NAMES = new Set([
  'main', 'init', 'setup', 'render', 'handler', 'run', 'test', 'index', 'default',
  'get', 'set', 'add', 'remove', 'update', 'create', 'delete', 'toString', 'constructor',
]);

/**
 * Names that are *supposed* to repeat. A React component having its own
 * `handleSubmit` is not duplication, it is the convention, and flagging it would
 * bury the real findings under noise.
 */
const EXPECTED_REPEATS = /^(handle|on)[A-Z]/;

interface Finding {
  label: string;
  detail: string;
  penalty: number;
  action: string;
}

function walkFiles(root: string, maxFiles = 2500): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (files.length >= maxFiles || depth > 8) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (CODE_EXT.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root, 0);
  return files;
}

function findDuplicateFunctions(root: string): Array<{ name: string; files: string[] }> {
  const byName = new Map<string, Set<string>>();

  for (const file of walkFiles(root)) {
    let text: string;
    try {
      if (statSync(file).size > 400_000) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (/\.(test|spec)\./.test(rel) || /(^|\/)(tests?|__tests__)\//.test(rel)) continue;

    for (const pattern of FN_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        if (!name || name.length < 5 || COMMON_NAMES.has(name) || EXPECTED_REPEATS.test(name)) continue;
        const set = byName.get(name) ?? new Set<string>();
        set.add(rel);
        byName.set(name, set);
      }
    }
  }

  return Array.from(byName.entries())
    .filter(([, files]) => files.size > 1)
    .map(([name, files]) => ({ name, files: Array.from(files) }))
    .sort((a, b) => b.files.length - a.files.length);
}

function bar(value: number, max: number, width = 24): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '█'.repeat(filled) + c.dim('░'.repeat(width - filled));
}

export async function score(cwd = process.cwd()): Promise<void> {
  const root = await findProjectRoot(cwd);
  const scan = scanProject(root);
  const findings: Finding[] = [];

  console.log('');
  console.log(`  ${c.bold('twomind score')}  ${c.dim(root)}`);
  console.log('');

  // 1. How much instruction text every agent reads before it starts.
  const contextTokens = scan.contextTokens;
  const budget = 4000;
  if (contextTokens > budget) {
    const over = Math.round((contextTokens / budget) * 10) / 10;
    findings.push({
      label: 'Agent context is heavy',
      detail: `${contextTokens.toLocaleString('en-US')} tokens read before every task, across ${scan.contextFiles.length} files (${over}× the recommended budget)`,
      penalty: Math.min(25, Math.round((contextTokens - budget) / 1200)),
      action: 'Move area-specific rules out of the always-loaded files.',
    });
  }

  // 2. Functions defined under the same name in several places.
  const duplicates = findDuplicateFunctions(root);
  const heavyDuplicates = duplicates.filter((d) => d.files.length >= 2).slice(0, 40);
  if (heavyDuplicates.length > 0) {
    findings.push({
      label: 'Possible duplicate helpers',
      detail: `${heavyDuplicates.length} function name${heavyDuplicates.length === 1 ? '' : 's'} defined in more than one file`,
      penalty: Math.min(25, heavyDuplicates.length),
      action: 'Check whether the agent rebuilt something you already had.',
    });
  }

  // 3. Changes that were never explained beyond a one-line subject.
  let unexplained = 0;
  let commitCount = 0;
  if (await isGitRepo(root)) {
    const commits = await recentCommits(root, 50);
    commitCount = commits.length;
    unexplained = commits.filter((commit) => commit.body.trim().length < 20).length;
    if (commitCount > 0 && unexplained / commitCount > 0.6) {
      findings.push({
        label: 'Changes arrive without a "why"',
        detail: `${unexplained} of the last ${commitCount} commits carry no explanation beyond their subject line`,
        penalty: Math.min(20, Math.round((unexplained / commitCount) * 20)),
        action: 'Capture the reason at the moment the change is made. It cannot be recovered later.',
      });
    }
  }

  // 4. Rules spread across several competing files.
  const ruleFiles = scan.contextFiles.filter((f) => !f.file.startsWith('.ai/'));
  if (ruleFiles.length >= 3) {
    findings.push({
      label: 'Rules live in several places',
      detail: `${ruleFiles.length} instruction files: ${ruleFiles.map((f) => f.file).join(', ')}`,
      penalty: Math.min(10, (ruleFiles.length - 2) * 4),
      action: 'Keep one source and generate the rest, so they cannot drift apart.',
    });
  }

  const penalty = findings.reduce((n, f) => n + f.penalty, 0);
  const total = Math.max(0, 100 - penalty);
  const colour = total >= 80 ? c.green : total >= 55 ? c.yellow : c.red;

  console.log(`  ${colour(c.bold(String(total)))}${c.dim('/100')}   ${bar(total, 100)}`);
  console.log('');

  if (findings.length === 0) {
    console.log(`  ${c.green('Nothing flagged.')} Your rules are lean and your history explains itself.`);
  } else {
    for (const finding of findings) {
      console.log(`  ${c.yellow('•')} ${c.bold(finding.label)}`);
      console.log(`    ${finding.detail}`);
      console.log(`    ${c.dim(finding.action)}`);
      console.log('');
    }
  }

  if (heavyDuplicates.length) {
    console.log(`  ${c.dim('Duplicate names worth a look:')}`);
    for (const dup of heavyDuplicates.slice(0, 5)) {
      console.log(`    ${c.cyan(dup.name + '()')} ${c.dim('→ ' + dup.files.slice(0, 3).join(', '))}`);
    }
    console.log('');
  }

  console.log(`  ${c.dim('Run')} ${c.cyan('twomind init')} ${c.dim('to start keeping track of what changes and why.')}`);
  console.log('');
}

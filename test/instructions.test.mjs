import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  ensureClaudeImport,
  managedBlock,
  writeRecordingGuide,
  upsertManagedBlock,
} from '../dist/core/brain.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function temporaryProject(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'twomind-instructions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('adding the Twomind block preserves every existing AGENTS.md byte', (t) => {
  const root = temporaryProject(t);
  const file = path.join(root, 'AGENTS.md');
  const ownerRules = '# Our rules\r\n\r\n- Never deploy without asking.  \r\n';
  writeFileSync(file, ownerRules, 'utf8');

  assert.equal(upsertManagedBlock(file, managedBlock()), 'updated');

  const result = readFileSync(file, 'utf8');
  assert.ok(result.startsWith(ownerRules));
  assert.match(result, /project owner's instructions outside this block always win/);
  assert.match(result, /\.twomind\/project\/recording\.md/);
  assert.match(result, /\.twomind\/\.local\/note\.json/);
  assert.match(result, /Twomind saves the note automatically/);
  assert.doesNotMatch(result, /twomind record|node\.exe|dist\/cli\.js/);
  assert.equal(result.match(/<!-- twomind:start -->/g)?.length, 1);
  assert.equal(result.match(/<!-- twomind:end -->/g)?.length, 1);
  assert.equal(result.replace(/\r\n/g, '').includes('\n'), false);
});

test('refreshing Twomind changes only its marked AGENTS.md block', (t) => {
  const root = temporaryProject(t);
  const file = path.join(root, 'AGENTS.md');
  const before = '# Rules before\n\n- Keep this exactly.\n\n';
  const after = '\n\n## Rules after\n\n- Keep this too.\n';
  const oldBlock = '<!-- twomind:start -->\nOld Twomind instructions\n<!-- twomind:end -->';
  writeFileSync(file, `${before}${oldBlock}${after}`, 'utf8');

  assert.equal(upsertManagedBlock(file, managedBlock()), 'updated');
  assert.equal(readFileSync(file, 'utf8'), `${before}${managedBlock()}${after}`);
  assert.equal(upsertManagedBlock(file, managedBlock()), 'unchanged');
});

test('broken Twomind markers stop safely without changing AGENTS.md', (t) => {
  const root = temporaryProject(t);
  const file = path.join(root, 'AGENTS.md');
  const ownerRules = '# Owner rules\n\n<!-- twomind:start -->\n- This marker was left unfinished.\n';
  writeFileSync(file, ownerRules, 'utf8');

  assert.throws(
    () => upsertManagedBlock(file, managedBlock()),
    /left the file unchanged/
  );
  assert.equal(readFileSync(file, 'utf8'), ownerRules);
});

test('the managed block stays short and the full note guide is kept in Twomind', (t) => {
  const root = temporaryProject(t);
  const block = managedBlock();
  assert.ok(block.split('\n').length <= 10);

  const first = writeRecordingGuide(root);
  assert.equal(first.action, 'created');
  const file = path.join(root, '.twomind', 'project', 'recording.md');
  const guide = readFileSync(file, 'utf8');
  assert.match(guide, /\.twomind\/\.local\/note\.json/);
  assert.match(guide, /Codex's end-of-turn notification saves it automatically/);

  writeFileSync(file, 'old guide\n', 'utf8');
  assert.equal(writeRecordingGuide(root).action, 'updated');
  assert.equal(readFileSync(file, 'utf8'), guide);
  assert.equal(writeRecordingGuide(root).action, 'unchanged');
});

test('adding the AGENTS.md import preserves every existing CLAUDE.md byte', (t) => {
  const root = temporaryProject(t);
  const file = path.join(root, 'CLAUDE.md');
  const ownerRules = '# Claude rules\r\n\r\n- Use our release checklist.  \r\n';
  writeFileSync(file, ownerRules, 'utf8');

  assert.equal(ensureClaudeImport(root), 'added');
  const added = readFileSync(file, 'utf8');
  assert.equal(added, `${ownerRules}\r\n@AGENTS.md\r\n`);

  assert.equal(ensureClaudeImport(root), 'present');
  assert.equal(readFileSync(file, 'utf8'), added);
});

test('twomind init keeps rules from an existing AGENTS.md and CLAUDE.md', { timeout: 20_000 }, (t) => {
  const base = temporaryProject(t);
  const project = path.join(base, 'project');
  const home = path.join(base, 'home');
  mkdirSync(project);
  mkdirSync(home);

  const git = spawnSync('git', ['init', '--quiet'], { cwd: project, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);

  const agentsRules = '# Team rules\n\n- Never deploy without approval.\n';
  const claudeRules = '# Claude rules\n\n- Run the small test suite first.\n';
  writeFileSync(path.join(project, 'AGENTS.md'), agentsRules, 'utf8');
  writeFileSync(path.join(project, 'CLAUDE.md'), claudeRules, 'utf8');

  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'dist', 'cli.js'), 'init', '--yes'],
    {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const agentsAfter = readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
  const claudeAfter = readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
  assert.ok(agentsAfter.startsWith(agentsRules));
  assert.match(agentsAfter, /project owner's instructions outside this block always win/);
  assert.ok(readFileSync(path.join(project, '.twomind', 'project', 'recording.md'), 'utf8'));
  assert.ok(claudeAfter.startsWith(claudeRules));
  assert.match(claudeAfter, /^@AGENTS\.md$/m);
});

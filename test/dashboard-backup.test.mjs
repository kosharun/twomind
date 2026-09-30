import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { listStories } from '../dist/core/story.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'dist', 'cli.js');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('an open dashboard records a prepared note when the final agent hook is missed', { timeout: 20_000 }, async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'twomind-dashboard-backup-'));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  mkdirSync(root);
  mkdirSync(home);
  const source = path.join(root, 'Main.java');
  writeFileSync(source, 'public class Main { int value() { return 1; } }\n', 'utf8');
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
  const commit = spawnSync(
    'git',
    ['-c', 'user.name=Twomind Test', '-c', 'user.email=test@twomind.local', 'commit', '--quiet', '-m', 'base'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(commit.status, 0, commit.stderr);

  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex') };
  const init = spawnSync(process.execPath, [cli, 'init', '--yes'], { cwd: root, encoding: 'utf8', env });
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const server = spawn(process.execPath, [cli, 'serve', '--port', '0', '--no-open'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    server.kill();
    await Promise.race([once(server, 'exit'), wait(2000)]);
    rmSync(base, { recursive: true, force: true });
  });

  let output = '';
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => { output += chunk; });
  for (let i = 0; i < 40 && !output.includes('leave this running'); i += 1) await wait(100);
  assert.match(output, /leave this running/);

  writeFileSync(source, 'public class Main { int value() { return 2; } }\n', 'utf8');
  writeFileSync(
    path.join(root, '.twomind', '.local', 'note.json'),
    JSON.stringify({
      title: 'Change Java value',
      request: 'Change the Java value.',
      summary: 'Changed the value from one to two.',
      chapters: [],
      howToTest: ['Read Main.java.'],
      files: [{ path: 'Main.java', level: 'start', why: 'This contains the changed value.' }],
      decisions: [],
      notTested: [],
    }),
    'utf8'
  );

  for (let i = 0; i < 35 && listStories(root).length === 0; i += 1) await wait(250);
  assert.equal(listStories(root).length, 1);
  assert.equal(listStories(root)[0].meta.title, 'Change Java value');
  assert.equal(listStories(root)[0].meta.agent, 'dashboard backup');
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { listStories } from '../dist/core/story.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'dist', 'cli.js');

function runCli(root, home, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: path.join(home, '.codex'),
    },
  });
}

function project(t, prefix = 'twomind-codex-notify-') {
  const base = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  mkdirSync(root);
  mkdirSync(home);
  writeFileSync(path.join(root, 'app.js'), 'export const value = 1;\n', 'utf8');
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
  const commit = spawnSync(
    'git',
    ['-c', 'user.name=Twomind Test', '-c', 'user.email=test@twomind.local', 'commit', '--quiet', '-m', 'base'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(commit.status, 0, commit.stderr);
  return { root, home };
}

test('init connects Codex even when the project only had Claude files', { timeout: 20_000 }, (t) => {
  const { root, home } = project(t);
  writeFileSync(path.join(root, 'CLAUDE.md'), '# Claude project\n', 'utf8');
  const codexDir = path.join(home, '.codex');
  mkdirSync(codexDir);
  const configFile = path.join(codexDir, 'config.toml');
  writeFileSync(configFile, 'model = "gpt-test"\n\n[features]\nhooks = true\n', 'utf8');

  const result = runCli(root, home, ['init', '--yes']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const config = readFileSync(configFile, 'utf8');
  assert.match(config, /^model = "gpt-test"$/m);
  assert.match(config, /^notify = \[.*"notify", "codex"\]$/m);
  assert.ok(config.indexOf('notify =') < config.indexOf('[features]'));
  assert.equal(existsSync(path.join(root, '.codex', 'hooks.json')), false);
});

test('Codex end-of-turn notification saves the note as a story', { timeout: 20_000 }, (t) => {
  const { root, home } = project(t);
  const init = runCli(root, home, ['init', '--yes']);
  assert.equal(init.status, 0, init.stderr || init.stdout);

  writeFileSync(path.join(root, 'app.js'), 'export const value = 2;\n', 'utf8');
  const noteFile = path.join(root, '.twomind', '.local', 'note.json');
  writeFileSync(
    noteFile,
    JSON.stringify({
      title: 'Change the value',
      request: 'Change the value to two.',
      summary: 'Changed the exported value from one to two.',
      chapters: [],
      howToTest: ['Read app.js.'],
      files: [{ path: 'app.js', level: 'start', why: 'This is the requested change.' }],
      decisions: [],
      notTested: [],
    }),
    'utf8'
  );

  const payload = JSON.stringify({
    type: 'agent-turn-complete',
    cwd: root,
    'thread-id': 'extension-thread',
    'turn-id': 'extension-turn',
    'input-messages': ['Change the value to two.'],
    'last-assistant-message': 'Changed the value.',
  });
  const notify = runCli(root, home, ['notify', 'codex', payload]);
  assert.equal(notify.status, 0, notify.stderr || notify.stdout);
  assert.equal(notify.stdout, '');

  const stories = listStories(root);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].meta.title, 'Change the value');
  assert.equal(stories[0].meta.agent, 'codex');
  assert.equal(stories[0].meta.source, 'agent');
  assert.equal(stories[0].meta.prompt, 'Change the value to two.');
  assert.equal(existsSync(noteFile), false);
  assert.match(readFileSync(path.join(root, '.twomind', '.local', 'hook.log'), 'utf8'), /\[notify\] Saved/);
});

test('init keeps and runs another Codex end-of-turn command', { timeout: 20_000 }, (t) => {
  const { root, home } = project(t, 'twomind-codex-existing-notify-');
  const codexDir = path.join(home, '.codex');
  mkdirSync(codexDir);
  const configFile = path.join(codexDir, 'config.toml');
  const previousScript = path.join(home, 'previous-notify.cjs');
  const previousOutput = path.join(home, 'previous-event.json');
  writeFileSync(
    previousScript,
    'require("node:fs").writeFileSync(process.argv[2], process.argv[3], "utf8");\n',
    'utf8'
  );
  const previousCommand = [process.execPath, previousScript, previousOutput];
  const original = `notify = ${JSON.stringify(previousCommand)}\n\n[features]\nhooks = true\n`;
  writeFileSync(configFile, original, 'utf8');

  const result = runCli(root, home, ['init', '--yes']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const wrapped = readFileSync(configFile, 'utf8');
  const notifyLine = wrapped.match(/^notify = (\[.*\])$/m);
  assert.ok(notifyLine);
  const command = JSON.parse(notifyLine[1]);
  assert.deepEqual(command.slice(-previousCommand.length), previousCommand);
  assert.match(result.stdout, /kept your existing Codex end-of-turn command/);

  const payload = JSON.stringify({ type: 'agent-turn-complete', cwd: root });
  const notified = spawnSync(command[0], [...command.slice(1), payload], { encoding: 'utf8' });
  assert.equal(notified.status, 0, notified.stderr || notified.stdout);
  assert.equal(readFileSync(previousOutput, 'utf8'), payload);

  const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /\.twomind\/project\/recording\.md/);
  assert.doesNotMatch(agents, /twomind record|dist\/cli\.js/);

  const disconnected = runCli(root, home, ['disconnect-codex']);
  assert.equal(disconnected.status, 0, disconnected.stderr || disconnected.stdout);
  const restored = readFileSync(configFile, 'utf8');
  const restoredLine = restored.match(/^notify = (\[.*\])$/m);
  assert.ok(restoredLine);
  assert.deepEqual(JSON.parse(restoredLine[1]), previousCommand);
});

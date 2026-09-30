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

function runCli(root, home, args, input = '') {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

test('Codex prompt and stop hooks save a prepared note as a story', { timeout: 20_000 }, (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'twomind-codex-hook-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  mkdirSync(root);
  mkdirSync(home);

  writeFileSync(path.join(root, 'package.json'), '{"name":"hook-test"}\n', 'utf8');
  writeFileSync(path.join(root, 'app.js'), 'export const value = 1;\n', 'utf8');

  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
  const commit = spawnSync(
    'git',
    ['-c', 'user.name=Twomind Test', '-c', 'user.email=test@twomind.local', 'commit', '--quiet', '-m', 'base'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(commit.status, 0, commit.stderr);

  const init = runCli(root, home, ['init', '--yes']);
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const sessionId = 'codex-hook-test';
  const promptPayload = JSON.stringify({
    session_id: sessionId,
    cwd: root,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Change the value to two.',
  });
  const prompt = runCli(root, home, ['hook', 'prompt', '--agent', 'codex'], promptPayload);
  assert.equal(prompt.status, 0, prompt.stderr || prompt.stdout);

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

  const stopPayload = JSON.stringify({
    session_id: sessionId,
    cwd: root,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Changed the value.',
  });
  const stop = runCli(root, home, ['hook', 'stop', '--agent', 'codex'], stopPayload);
  assert.equal(stop.status, 0, stop.stderr || stop.stdout);

  const stories = listStories(root);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].meta.title, 'Change the value');
  assert.equal(stories[0].meta.agent, 'codex');
  assert.equal(stories[0].meta.source, 'agent');
  assert.equal(existsSync(noteFile), false);

  const log = readFileSync(path.join(root, '.twomind', '.local', 'hook.log'), 'utf8');
  assert.match(log, /\[prompt\] agent=codex/);
  assert.match(log, /\[stop\] story saved/);
});

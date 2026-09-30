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

function run(root, home, command, args, input = '') {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    input,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex') },
  });
}

test('the exact Claude hooks written by init record a Java change', { timeout: 25_000 }, (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'twomind-claude-installed-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  const sourceDir = path.join(root, 'src', 'main', 'java', 'example');
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(home);
  const source = path.join(sourceDir, 'Greeting.java');
  writeFileSync(source, 'package example;\npublic class Greeting { public String text() { return "hi"; } }\n', 'utf8');
  writeFileSync(path.join(root, 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion></project>\n', 'utf8');

  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
  const commit = spawnSync(
    'git',
    ['-c', 'user.name=Twomind Test', '-c', 'user.email=test@twomind.local', 'commit', '--quiet', '-m', 'base'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(commit.status, 0, commit.stderr);

  const init = run(root, home, process.execPath, [cli, 'init', '--yes']);
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const settings = JSON.parse(readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const promptHook = settings.hooks.UserPromptSubmit.at(-1).hooks[0];
  const stopHook = settings.hooks.Stop.at(-1).hooks[0];
  assert.equal(promptHook.command, process.execPath);
  assert.deepEqual(promptHook.args.slice(-4), ['hook', 'prompt', '--agent', 'claude']);
  assert.equal(stopHook.command, process.execPath);
  assert.deepEqual(stopHook.args.slice(-4), ['hook', 'stop', '--agent', 'claude']);

  const session = 'java-claude-session';
  const promptPayload = JSON.stringify({
    session_id: session,
    cwd: root,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Change the greeting.',
  });
  const prompted = run(root, home, promptHook.command, promptHook.args, promptPayload);
  assert.equal(prompted.status, 0, prompted.stderr || prompted.stdout);

  writeFileSync(source, 'package example;\npublic class Greeting { public String text() { return "hello"; } }\n', 'utf8');
  const stopPayload = JSON.stringify({
    session_id: session,
    cwd: root,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Changed the greeting.',
  });
  const firstStop = run(root, home, stopHook.command, stopHook.args, stopPayload);
  assert.equal(firstStop.status, 0, firstStop.stderr || firstStop.stdout);
  assert.match(firstStop.stdout, /additionalContext/);

  const noteFile = path.join(root, '.twomind', '.local', 'note.json');
  writeFileSync(
    noteFile,
    JSON.stringify({
      title: 'Change the greeting',
      request: 'Change the greeting.',
      summary: 'Changed the Java greeting from hi to hello.',
      chapters: [],
      howToTest: ['Read Greeting.java.'],
      files: [{ path: 'src/main/java/example/Greeting.java', level: 'start', why: 'This holds the greeting.' }],
      decisions: [],
      notTested: [],
    }),
    'utf8'
  );

  const secondStop = run(
    root,
    home,
    stopHook.command,
    stopHook.args,
    JSON.stringify({ ...JSON.parse(stopPayload), stop_hook_active: true })
  );
  assert.equal(secondStop.status, 0, secondStop.stderr || secondStop.stdout);
  assert.equal(listStories(root).length, 1);
  assert.equal(listStories(root)[0].meta.title, 'Change the greeting');
  assert.equal(existsSync(noteFile), false);
});

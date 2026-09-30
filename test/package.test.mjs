import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

test('the published package exposes a portable twomind command', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const cli = await readFile(path.join(root, 'dist', 'cli.js'), 'utf8');

  assert.equal(pkg.bin?.twomind, 'dist/cli.js');
  assert.equal(pkg.scripts?.['install-global'], 'node scripts/install-global.mjs');
  assert.equal(pkg.scripts?.prepack, 'npm run build');
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.ok(pkg.files?.includes('dist'));
  assert.match(cli, /^#!\/usr\/bin\/env node(?:\r?\n)/);
});

test('the command reports the version from the published package', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(root, 'dist', 'cli.js'),
    '--version',
  ]);

  assert.equal(stdout.trim(), pkg.version);
});

test('the clone installer creates a package before installing it globally', async () => {
  const installer = await readFile(path.join(root, 'scripts', 'install-global.mjs'), 'utf8');

  assert.match(installer, /\['pack', '--pack-destination'/);
  assert.match(installer, /\['install', '--global'/);
  assert.match(installer, /mkdtempSync/);
  assert.match(installer, /rmSync\(temporary, \{ recursive: true, force: true \}\)/);
});

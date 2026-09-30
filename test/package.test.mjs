import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

test('the clone installer creates a package before installing it globally', async () => {
  const installer = await readFile(path.join(root, 'scripts', 'install-global.mjs'), 'utf8');

  assert.match(installer, /\['pack', '--pack-destination'/);
  assert.match(installer, /\['install', '--global'/);
  assert.match(installer, /mkdtempSync/);
  assert.match(installer, /rmSync\(temporary, \{ recursive: true, force: true \}\)/);
});

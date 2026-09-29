import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the published package exposes a portable twomind command', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const cli = await readFile(path.join(root, 'dist', 'cli.js'), 'utf8');

  assert.equal(pkg.bin?.twomind, './dist/cli.js');
  assert.equal(pkg.scripts?.prepack, 'npm run build');
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.ok(pkg.files?.includes('dist'));
  assert.match(cli, /^#!\/usr\/bin\/env node(?:\r?\n)/);
});

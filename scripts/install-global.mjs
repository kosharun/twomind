import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'twomind-global-'));

function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli
    ? process.execPath
    : process.platform === 'win32'
      ? 'npm.cmd'
      : 'npm';
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  console.log('\nBuilding a separate Twomind package...\n');
  runNpm(['pack', '--pack-destination', temporary, '--silent']);

  const archive = readdirSync(temporary).find((file) => file.endsWith('.tgz'));
  if (!archive) throw new Error('Twomind could not create its install package.');

  console.log('\nInstalling the global twomind command...\n');
  runNpm(['install', '--global', path.join(temporary, archive)]);

  console.log('\nDone. The global command is a separate copy and does not depend on this cloned folder.\n');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

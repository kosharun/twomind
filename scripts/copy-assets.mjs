import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc only emits .ts output, so the dashboard's static files are copied here.
const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.join(here, '..', 'src', 'web', 'public');
const to = path.join(here, '..', 'dist', 'web', 'public');

mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`copied dashboard assets -> ${path.relative(path.join(here, '..'), to)}`);

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command and capture its output. Never throws on a non-zero exit —
 * callers decide what a failure means. `env` is merged over process.env.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; maxBuffer?: number; timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      windowsHide: true,
      shell: false,
    });

    const cap = opts.maxBuffer ?? 32 * 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill();
        }, opts.timeoutMs)
      : null;

    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < cap) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < cap) stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: killed ? -1 : code ?? 0, stdout, stderr });
    });
  });
}

export function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

export function shortId(input: string, len = 6): string {
  return sha1(input).slice(0, len);
}

/** Read all of stdin. Hooks receive their payload this way. */
export function readStdin(timeoutMs = 3000): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** "2026-09-28T14:32:05.000Z" -> { date: "2026/09", stamp: "28-1432" } */
export function timeParts(d = new Date()): { year: string; month: string; stamp: string; iso: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    year: String(d.getFullYear()),
    month: pad(d.getMonth() + 1),
    stamp: `${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`,
    iso: d.toISOString(),
  };
}

export function slugify(text: string, max = 48): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (s || 'change').slice(0, max).replace(/-+$/g, '');
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Rough token estimate. Good enough for budget warnings, not billing. */
export function estimateTokens(chars: number): number {
  return Math.round(chars / 3.7);
}

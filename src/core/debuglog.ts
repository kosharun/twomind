import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A visibility escape hatch for the hooks.
 *
 * hookPrompt/hookStop swallow every error on purpose: a broken hook must never
 * break the agent session. The cost is that a real failure looks identical to
 * "nothing happened". This writes one line per checkpoint to a local file so a
 * silent failure can still be read back, without ever throwing itself.
 *
 * The very first checkpoint of each hook run ("what did we actually receive?")
 * happens before we know the project root. If that lookup itself is wrong
 * (missing cwd, unexpected field names), logging only inside the project would
 * hide the one line that explains why, so a fixed fallback location always
 * gets a copy too.
 */
const FALLBACK_FILE = path.join(tmpdir(), 'twomind-hook-debug.log');

export function debugLog(root: string | null, line: string): void {
  const stamp = new Date().toISOString();
  const entry = `${stamp}  ${line}\n`;

  try {
    appendFileSync(FALLBACK_FILE, entry, 'utf8');
  } catch {
    /* logging must never be the thing that breaks a hook */
  }

  if (!root) return;
  try {
    const dir = path.join(root, '.twomind', '.local');
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'hook.log'), entry, 'utf8');
  } catch {
    /* same guarantee as above */
  }
}

export { FALLBACK_FILE };

export function shorten(text: string | undefined | null, max = 60): string {
  if (!text) return '(empty)';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

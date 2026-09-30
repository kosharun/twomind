import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { debugLog } from '../core/debuglog.js';
import { findProjectRoot, isInitialised } from '../core/paths.js';
import { safeJsonParse } from '../core/util.js';
import { recordNow } from './record.js';

interface CodexNotification {
  type?: string;
  cwd?: string;
  'thread-id'?: string;
  'turn-id'?: string;
  'input-messages'?: string[];
  'last-assistant-message'?: string;
}

/**
 * Codex calls this after a turn in both the CLI and the VS Code extension.
 * It is deliberately quiet because it runs behind the user's editor.
 */
export async function handleCodexNotification(raw: string, thenCommand: string[] = []): Promise<void> {
  let root: string | null = null;
  try {
    const payload = safeJsonParse<CodexNotification>(raw, {});
    if (payload.type !== 'agent-turn-complete') return;
    if (!payload.cwd || !existsSync(payload.cwd)) return;

    root = await findProjectRoot(payload.cwd);
    if (!isInitialised(root)) return;

    const prompt = Array.isArray(payload['input-messages'])
      ? payload['input-messages'].filter((message) => typeof message === 'string').join('\n')
      : '';

    const result = await recordNow(root, {
      agent: 'codex',
      prompt,
      fallbackSummary: payload['last-assistant-message'] ?? '',
      sessionId: payload['thread-id'] ?? payload['turn-id'] ?? 'codex-notify',
      source: 'agent',
    });
    debugLog(root, `[notify] ${result}`);
  } catch (err) {
    debugLog(root, `[notify] ERROR ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  } finally {
    if (thenCommand.length) {
      try {
        spawnSync(thenCommand[0], [...thenCommand.slice(1), raw], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 30_000,
        });
      } catch {
        // The previous notification is not ours to diagnose. It is kept here
        // only so adding Twomind never takes another tool's behavior away.
      }
    }
  }
}

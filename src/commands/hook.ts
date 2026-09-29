import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { debugLog, shorten } from '../core/debuglog.js';
import { askForNoteMessage, clearNote, readNote } from '../core/note.js';
import { findProjectRoot, isInitialised, resolveProjectPaths } from '../core/paths.js';
import { currentBranch, diffTrees, takeSnapshot } from '../core/snapshot.js';
import { buildStory, readLastRecorded, writeLastRecorded, writeStory } from '../core/story.js';
import { condenseSummary, readTranscript } from '../core/transcript.js';
import { readStdin, safeJsonParse, shortId } from '../core/util.js';

/**
 * The capture engine, wired into the agents as hooks.
 *
 *   UserPromptSubmit -> remember the prompt and snapshot the working tree
 *   Stop             -> diff against that snapshot; if files changed, make sure
 *                       the agent has explained them, then save the story
 *
 * The agent explains its own change. If it finished without writing its note,
 * the Stop hook asks it once to write one. It never asks twice for the same
 * change, so it cannot loop, and it never blocks a turn where nothing changed.
 *
 * Every unexpected problem ends quietly: a missed story is a small loss, a
 * broken agent session is not acceptable. debugLog() leaves a trail in
 * .twomind/.local/hook.log so a quiet failure can still be read back.
 */

interface HookPayload {
  session_id?: string;
  sessionId?: string;
  transcript_path?: string;
  transcriptPath?: string;
  cwd?: string;
  prompt?: string;
  hook_event_name?: string;
  /** Claude Code: true when this Stop is already a continuation caused by a Stop hook. */
  stop_hook_active?: boolean;
  /** Claude Code: the agent's final message of this turn. */
  last_assistant_message?: string;
}

interface PendingCapture {
  tree: string;
  prompt: string;
  startedAt: string;
  agent: string;
  /** Set once we have asked the agent for its note, so we never ask twice. */
  askedForNote?: boolean;
}

function pendingFile(root: string, sessionId: string): string {
  const { local } = resolveProjectPaths(root);
  return path.join(local, 'pending', `${shortId(sessionId, 16)}.json`);
}

function payloadSession(payload: HookPayload): string {
  return payload.session_id ?? payload.sessionId ?? 'default';
}

function payloadTranscript(payload: HookPayload): string | undefined {
  return payload.transcript_path ?? payload.transcriptPath;
}

async function resolveRoot(payload: HookPayload): Promise<string | null> {
  const cwd = payload.cwd && existsSync(payload.cwd) ? payload.cwd : process.cwd();
  const root = await findProjectRoot(cwd);
  return isInitialised(root) ? root : null;
}

/**
 * Ask the agent to keep going and write its note.
 *
 * Claude Code gets `additionalContext`, which its docs describe as the
 * non-error way for a Stop hook to give guidance ("run the tests before
 * finishing"): the owner sees "Stop hook feedback", not a red hook error.
 * Codex documents `decision: "block"` + `reason` for Stop, which it turns into
 * a continuation prompt. Either way stdout must hold ONLY this JSON.
 */
function continueWith(agent: string, message: string): void {
  const output =
    agent === 'claude'
      ? { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: message } }
      : { decision: 'block', reason: message };
  process.stdout.write(JSON.stringify(output));
}

export async function hookPrompt(agent: string): Promise<void> {
  let root: string | null = null;
  try {
    const raw = await readStdin();
    const payload = safeJsonParse<HookPayload>(raw, {});
    debugLog(
      payload.cwd ?? null,
      `[prompt] agent=${agent} cwd=${payload.cwd ?? '(none)'} session=${payloadSession(payload)} prompt="${shorten(payload.prompt)}"`
    );

    root = await resolveRoot(payload);
    if (!root) {
      debugLog(null, '[prompt] project is not set up for twomind, skipping');
      return;
    }

    const { snapshots } = resolveProjectPaths(root);
    const tree = await takeSnapshot(root, snapshots);
    if (!tree) {
      debugLog(root, '[prompt] could not snapshot (not a git repo, or a merge/rebase is in progress)');
      return;
    }

    const file = pendingFile(root, payloadSession(payload));
    mkdirSync(path.dirname(file), { recursive: true });
    const pending: PendingCapture = {
      tree,
      prompt: payload.prompt ?? '',
      startedAt: new Date().toISOString(),
      agent,
      askedForNote: false,
    };
    writeFileSync(file, JSON.stringify(pending, null, 2), 'utf8');
    debugLog(root, `[prompt] snapshot saved (${tree.slice(0, 10)})`);
  } catch (err) {
    debugLog(root, `[prompt] ERROR ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

export async function hookStop(agent: string): Promise<void> {
  let root: string | null = null;
  try {
    const raw = await readStdin();
    const payload = safeJsonParse<HookPayload>(raw, {});
    debugLog(
      payload.cwd ?? null,
      `[stop] agent=${agent} cwd=${payload.cwd ?? '(none)'} session=${payloadSession(payload)} continuation=${payload.stop_hook_active === true}`
    );

    root = await resolveRoot(payload);
    if (!root) return;

    const sessionId = payloadSession(payload);
    const file = pendingFile(root, sessionId);
    if (!existsSync(file)) {
      debugLog(root, '[stop] no snapshot from the prompt hook, nothing to compare');
      return;
    }

    const pending = safeJsonParse<PendingCapture | null>(readFileSync(file, 'utf8'), null);
    if (!pending?.tree) {
      rmSync(file, { force: true });
      return;
    }

    const config = loadConfig(root);
    if (!config) return;

    const { snapshots } = resolveProjectPaths(root);
    const after = await takeSnapshot(root, snapshots);
    if (!after) {
      debugLog(root, '[stop] could not snapshot, will try again at the next stop');
      return;
    }

    // If the agent already ran `twomind record` during this turn, start from
    // that point, so the same change is never saved twice.
    const last = readLastRecorded(root);
    const before = last && last.at > pending.startedAt ? last.tree : pending.tree;

    const diff =
      before === after ? null : await diffTrees(root, before, after, { maxPatchBytes: config.capture.maxPatchBytes });
    const changedLines = diff ? diff.totalAdded + diff.totalDeleted : 0;

    if (!diff || diff.files.length === 0 || changedLines < config.capture.minChangedLines) {
      debugLog(root, '[stop] no file changes in this turn');
      rmSync(file, { force: true });
      return;
    }

    const note = readNote(root, pending.startedAt);

    if (!note && !pending.askedForNote && payload.stop_hook_active !== true) {
      pending.askedForNote = true;
      writeFileSync(file, JSON.stringify(pending, null, 2), 'utf8');
      debugLog(root, `[stop] ${diff.files.length} file(s) changed and no note yet, asking the agent to explain`);
      continueWith(agent, askForNoteMessage(root, diff.files));
      return;
    }

    const lastMessage = payload.last_assistant_message ?? readTranscript(payloadTranscript(payload)).assistantSummary;

    const story = buildStory({
      root,
      diff,
      prompt: pending.prompt,
      note,
      fallbackSummary: condenseSummary(lastMessage),
      agent: pending.agent || agent,
      sessionId,
      branch: await currentBranch(root),
      includePrompt: config.capture.includePrompt,
      source: 'agent',
    });

    const dir = writeStory(root, story);
    writeLastRecorded(root, after);
    if (note) clearNote(root);
    rmSync(file, { force: true });
    debugLog(root, `[stop] story saved (${note ? 'explained by the agent' : 'no note from the agent'}) -> ${dir}`);
  } catch (err) {
    debugLog(root, `[stop] ERROR ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveProjectPaths, userHome } from './paths.js';
import { safeJsonParse } from './util.js';

/**
 * The agent's note: its own explanation of a change.
 *
 * Twomind never decides what matters in a change. The agent that made the change
 * writes this note — which files are the heart of it, which are small follow-ups,
 * and why each one changed — and Twomind attaches it to the real diff. A file the
 * agent leaves out is shown as "not explained", never guessed at.
 *
 * The note lives in .twomind/.local/, which is gitignored and excluded from every
 * snapshot, so writing it can never show up as a code change itself.
 */

export type NoteLevel = 'start' | 'important' | 'small';

export interface NoteFile {
  path: string;
  level: NoteLevel;
  why: string;
}

export interface AgentNote {
  title: string;
  request: string;
  summary: string;
  howToTest: string[];
  files: NoteFile[];
  decisions: Array<{ choice: string; why: string }>;
  notTested: string[];
}

export function notePath(root: string): string {
  return path.join(resolveProjectPaths(root).local, 'note.json');
}

/** Forward slashes are safe to hand to an agent or a shell on every OS. */
export function slashPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean);
  const single = asText(value);
  return single ? [single] : [];
}

function normaliseLevel(value: unknown): NoteLevel {
  const level = asText(value).toLowerCase();
  if (/^(start|first|core|heart|main)/.test(level)) return 'start';
  if (/^(small|skim|minor|low|follow|trivial)/.test(level)) return 'small';
  return 'important';
}

function normaliseNotePath(p: string): string {
  return slashPath(p).replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Read the agent's note, if one was written after `sinceIso`. An older note
 * belongs to an earlier task and must not be attached to this one.
 * Tolerant of small format slips — agents do not always follow a schema exactly.
 */
export function readNote(root: string, sinceIso?: string): AgentNote | null {
  const file = notePath(root);
  if (!existsSync(file)) return null;

  try {
    if (sinceIso && statSync(file).mtimeMs < new Date(sinceIso).getTime() - 2000) return null;

    const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
    const raw = safeJsonParse<Record<string, unknown> | null>(text, null);
    if (!raw || typeof raw !== 'object') return null;

    const files = Array.isArray(raw.files) ? (raw.files as Array<Record<string, unknown>>) : [];
    const decisions = Array.isArray(raw.decisions) ? (raw.decisions as Array<Record<string, unknown>>) : [];

    return {
      title: asText(raw.title),
      request: asText(raw.request),
      summary: asText(raw.summary),
      howToTest: asList(raw.howToTest),
      files: files
        .map((f) => ({ path: normaliseNotePath(asText(f?.path)), level: normaliseLevel(f?.level), why: asText(f?.why) }))
        .filter((f) => f.path.length > 0),
      decisions: decisions
        .map((d) => ({ choice: asText(d?.choice ?? d?.what), why: asText(d?.why) }))
        .filter((d) => d.choice.length > 0),
      notTested: asList(raw.notTested),
    };
  } catch {
    return null;
  }
}

export function clearNote(root: string): void {
  try {
    rmSync(notePath(root), { force: true });
  } catch {
    /* best effort */
  }
}

/** How the owner wants explanations written, from ~/.twomind/me.md. */
export function explanationStyle(): string {
  const fallback = 'Plain, simple English. Short sentences. Say what changed and how to test it.';
  try {
    const text = readFileSync(path.join(userHome(), 'me.md'), 'utf8');
    const match = text.match(/\*\*Explanations:\*\*\s*(.+)/);
    const style = match?.[1]?.trim() ?? '';
    return style && !style.includes('not answered') ? style : fallback;
  } catch {
    return fallback;
  }
}

export const NOTE_TEMPLATE = `{
  "title": "short title",
  "request": "what the owner asked, in one line",
  "summary": "2-4 short sentences: what changed and why",
  "howToTest": ["step 1", "step 2"],
  "files": [{ "path": "exact/path/from/the/list", "level": "start | important | small", "why": "one sentence" }],
  "decisions": [{ "choice": "what you chose", "why": "why" }],
  "notTested": ["anything you did not check"]
}`;

/** What the Stop hook says when the agent finished a change without explaining it. */
export function askForNoteMessage(
  root: string,
  changed: Array<{ path: string; added: number; deleted: number; status: string }>
): string {
  const max = 60;
  const lines = changed.slice(0, max).map((f) => `- ${f.path} (${f.status}, +${f.added} -${f.deleted})`);
  if (changed.length > max) lines.push(`- ...and ${changed.length - max} more. List them too (see git status).`);

  return [
    `Twomind: you changed ${changed.length} file(s) but did not explain them yet.`,
    `Before you finish, write this JSON file with your file-writing tool. Do not change any other file:`,
    slashPath(notePath(root)),
    NOTE_TEMPLATE,
    `Put EVERY changed file in "files". You decide the level:`,
    `"start" = the heart of the change, read first (1-3 files). "important" = worth reading. "small" = a minor follow-up change.`,
    `"why" = why that file changed, in one sentence.`,
    `Write it for the owner like this: ${explanationStyle()}`,
    `Changed files:`,
    ...lines,
    `When the file is written, finish with one short line. Do not repeat the explanation in the chat.`,
  ].join('\n');
}

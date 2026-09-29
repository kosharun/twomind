import { openSync, readSync, closeSync, statSync, existsSync } from 'node:fs';

/**
 * Reading what the agent already said.
 *
 * Every hook hands us a path to the session transcript. The agent's own closing
 * message is usually a decent summary of what it just did, so we take that for
 * free instead of spending tokens asking it to explain itself again.
 *
 * Claude Code and Codex write different JSONL shapes, and both change over time,
 * so this parser is deliberately tolerant: it walks whatever JSON it finds and
 * pulls out anything that looks like assistant or user text. If it finds nothing,
 * the story is still written from the diff alone.
 */

const TAIL_BYTES = 2 * 1024 * 1024;

function readTail(filePath: string, maxBytes = TAIL_BYTES): string {
  try {
    const stat = statSync(filePath);
    const size = stat.size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length <= 0) return '';

    const fd = openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, start);
      let text = buf.toString('utf8');
      // If we cut mid-file, drop the first (probably partial) line.
      if (start > 0) {
        const nl = text.indexOf('\n');
        if (nl >= 0) text = text.slice(nl + 1);
      }
      return text;
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

/** Pull readable text out of a content value of unknown shape. */
function extractText(content: unknown, depth = 0): string {
  if (depth > 6) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => extractText(part, depth + 1))
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? obj.type : '';
    // Skip tool traffic and thinking: we want the message meant for the human.
    if (type === 'tool_use' || type === 'tool_result' || type === 'thinking' || type === 'redacted_thinking') {
      return '';
    }
    if (typeof obj.text === 'string') return obj.text;
    if (obj.content !== undefined) return extractText(obj.content, depth + 1);
  }
  return '';
}

function roleOf(entry: Record<string, unknown>): string {
  const direct = typeof entry.role === 'string' ? entry.role : '';
  if (direct) return direct;
  const message = entry.message as Record<string, unknown> | undefined;
  if (message && typeof message.role === 'string') return message.role;
  const payload = entry.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload.role === 'string') return payload.role;
  const type = typeof entry.type === 'string' ? entry.type : '';
  if (type === 'assistant' || type === 'user') return type;
  return '';
}

function bodyOf(entry: Record<string, unknown>): unknown {
  if (entry.message !== undefined) return entry.message;
  if (entry.payload !== undefined) return entry.payload;
  if (entry.content !== undefined) return entry.content;
  return entry;
}

export interface TranscriptRead {
  /** The agent's last message aimed at the human. */
  assistantSummary: string;
  /** The last thing the human typed. */
  lastUserPrompt: string;
  /** How many assistant turns we saw in the tail we read. */
  assistantTurns: number;
}

export function readTranscript(filePath: string | undefined | null): TranscriptRead {
  const empty: TranscriptRead = { assistantSummary: '', lastUserPrompt: '', assistantTurns: 0 };
  if (!filePath || !existsSync(filePath)) return empty;

  const text = readTail(filePath);
  if (!text) return empty;

  let assistantSummary = '';
  let lastUserPrompt = '';
  let assistantTurns = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const role = roleOf(entry);
    if (role !== 'assistant' && role !== 'user') continue;

    const value = extractText(bodyOf(entry)).trim();
    if (!value) continue;

    if (role === 'assistant') {
      assistantTurns += 1;
      assistantSummary = value;
    } else {
      // Skip tool results and system-injected reminders that arrive as "user".
      if (value.startsWith('<') || value.includes('<system-reminder>')) continue;
      lastUserPrompt = value;
    }
  }

  return { assistantSummary, lastUserPrompt, assistantTurns };
}

/**
 * Trim an agent's closing message down to something worth putting in a story:
 * drop leading pleasantries and keep the first few informative lines.
 */
export function condenseSummary(raw: string, maxChars = 900): string {
  if (!raw) return '';
  const lines = raw
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  const cleaned: string[] = [];
  for (const line of lines) {
    // Drop code fences and their contents markers; keep prose and bullets.
    if (line.trim().startsWith('```')) continue;
    cleaned.push(line);
    if (cleaned.join('\n').length > maxChars) break;
  }

  const out = cleaned.join('\n').trim();
  return out.length > maxChars ? out.slice(0, maxChars - 1).trimEnd() + '…' : out;
}

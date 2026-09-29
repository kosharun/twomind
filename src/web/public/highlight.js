import { esc } from './ui.js';

/* A small, dependency-free colourer for the code we show: JS, TS, JSX, and
   close enough to right for JSON, CSS and shell that it never looks wrong.

   It reads one line at a time. A real lexer would carry state across lines
   (so a block comment or a template string could span several of them); this
   trades a little accuracy for a file with no build step and one file you
   can read start to finish. Twomind never runs or checks the code it shows,
   only colours the letters, so a slightly-wrong comment span is cosmetic,
   never something a reader would trust as a fact. */

const KEYWORDS = new Set(
  ('const let var function return if else for while do switch case break continue class extends ' +
    'implements interface type new this super import export from default async await try catch ' +
    'finally throw typeof instanceof in of void null undefined true false static private public ' +
    'protected readonly get set yield as enum namespace declare abstract package satisfies')
    .split(' ')
);

// Built from plain strings (not a template literal) so a literal backtick,
// needed to match a template string, is never confused with JS's own syntax.
const SQ = "'(?:\\\\.|[^'\\\\])*'";
const DQ = '"(?:\\\\.|[^"\\\\])*"';
const BT = "`(?:\\\\.|[^`\\\\])*`";

const TOKEN_RE = new RegExp(
  [
    '(?<comment>//.*$|/\\*.*?\\*/)',
    '(?<string>' + SQ + '|' + DQ + '|' + BT + ')',
    '(?<number>\\b0x[\\da-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?\\b)',
    '(?<word>[A-Za-z_$][\\w$]*)',
  ].join('|'),
  'g'
);

/** One line of code -> safe HTML, with comments, strings, numbers and keywords coloured. */
export function highlight(text) {
  const line = text ?? '';
  if (!line) return '';

  let out = '';
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(line))) {
    out += esc(line.slice(last, match.index));
    const { comment, string, number, word } = match.groups;
    if (comment !== undefined) out += `<span class="tk-com">${esc(comment)}</span>`;
    else if (string !== undefined) out += `<span class="tk-str">${esc(string)}</span>`;
    else if (number !== undefined) out += `<span class="tk-num">${esc(number)}</span>`;
    else if (KEYWORDS.has(word)) out += `<span class="tk-kw">${esc(word)}</span>`;
    else if (line[TOKEN_RE.lastIndex] === '(') out += `<span class="tk-fn">${esc(word)}</span>`;
    else out += esc(word);
    last = TOKEN_RE.lastIndex;
  }
  out += esc(line.slice(last));
  return out;
}

/**
 * A block of source lines as numbered `<pre>` rows, coloured and marked up.
 *   startAt   the line number of lines[0]
 *   changed   line numbers to mark with a small "+" in the gutter
 *   dim       line numbers to show faded (kept for context, not the point)
 *   nowLine   one line number to underline as "you are here"
 */
export function renderLines(lines, options = {}) {
  const { startAt = 1, changed = new Set(), dim = null, nowLine = null } = options;
  const rows = lines.map((text, i) => {
    const n = startAt + i;
    const classes = ['cl', dim && !dim.has(n) ? 'dim' : '', n === nowLine ? 'now' : ''].filter(Boolean).join(' ');
    const mark = changed.has(n) ? '+' : '';
    return `<span class="${classes}"><span class="n">${n}</span><span class="g">${mark}</span>${highlight(text) || ' '}</span>`;
  });
  return `<pre class="code">${rows.join('')}</pre>`;
}

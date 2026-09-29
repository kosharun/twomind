import { highlight } from './highlight.js';

/* Rendering a diff. Deliberately quiet: a diff is a record, not a traffic light,
   so the colours are muted and the line numbers sit back.

   Long diffs are cut short. A new file can be 400 lines, and dropping all of
   them on the page is the thing that made this screen unreadable. You see the
   opening, and you ask for the rest if you want it. */

const DEFAULT_CAP = 22;

export function renderDiff(fileDiff, cap = DEFAULT_CAP) {
  if (!fileDiff?.lines || fileDiff.empty) {
    return '<div class="no-diff">Nothing to show here. The file is binary, only renamed, or the patch was too big.</div>';
  }

  const rows = fileDiff.lines.filter((line) => line.type !== 'meta');
  // Cutting off three lines helps nobody, so only cut when there is a real tail.
  const capped = rows.length > cap + 6;
  const html = (list) => list.map(row).join('');

  if (!capped) return `<div class="diff">${html(rows)}</div>`;

  return `<div class="diff">
    ${html(rows.slice(0, cap))}
    <div class="diff-rest">${html(rows.slice(cap))}</div>
    <button class="diff-more" data-diff-more>Show the other ${rows.length - cap} lines</button>
  </div>`;
}

function row(line) {
  const sign = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
  const number = line.type === 'hunk' ? '' : (line.type === 'del' ? line.oldNo : line.newNo) ?? '';
  return `<div class="diff-line ${line.type}"><span class="no">${number}</span><span class="sign">${sign}</span><span class="src">${
    highlight(line.text) || ' '
  }</span></div>`;
}

// One listener for every diff on the page, now and later.
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-diff-more]');
  if (button) button.closest('.diff').classList.add('open');
});

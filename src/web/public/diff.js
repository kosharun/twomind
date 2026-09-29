import { esc } from './ui.js';

/* Rendering a diff. Deliberately quiet: a diff is a record, not a traffic light,
   so the colours are muted and the line numbers sit back. */

export function renderDiff(fileDiff) {
  if (!fileDiff?.lines || fileDiff.empty) {
    return '<div class="no-diff">No text changes to show — binary, renamed, or the patch was too large.</div>';
  }

  const rows = fileDiff.lines
    .filter((line) => line.type !== 'meta')
    .map((line) => {
      const sign = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
      const number = line.type === 'hunk' ? '' : (line.type === 'del' ? line.oldNo : line.newNo) ?? '';
      return `<div class="diff-line ${line.type}"><span class="no">${number}</span><span class="sign">${sign}</span><span class="code">${esc(
        line.text
      )}</span></div>`;
    })
    .join('');

  return `<div class="diff">${rows}</div>`;
}

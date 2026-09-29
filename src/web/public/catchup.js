import { ago, esc, plural, setScreen } from './ui.js';

/* "What happened while I was away."

   Three things only: how much moved, the few changes worth opening, and where
   the work was. Everything else is one click away in Changes. */

export function showCatchUp(state, onOpenStory) {
  const { catchUp: cu, stories } = state;

  if (!stories.length) {
    setScreen(`<div class="empty">
      <h2>Nothing here yet</h2>
      <p>Leave this open and work normally. When your AI finishes a job that changed
      files, it writes down what it did and why, and the change shows up here.</p>
      <p class="mono" style="margin-top:18px">stuck? run <strong>twomind doctor</strong></p>
    </div>`);
    return;
  }

  const since = cu.upToDate
    ? 'you have seen everything, so here is the recent work'
    : cu.since
      ? `since you last looked, ${ago(cu.since)}`
      : 'your most recent changes';

  const highlights = cu.highlights.length
    ? cu.highlights
        .map(
          (h) => `<button class="card" data-id="${esc(h.id)}">
            <div class="t">${esc(h.title)}</div>
            <div class="w">${esc(h.why)}</div>
          </button>`
        )
        .join('')
    : '<p class="fp-none">Nothing new.</p>';

  const widest = Math.max(1, ...cu.blindSpots.map((s) => s.changes));
  const spots = cu.blindSpots
    .map(
      (spot) => `<div class="spot">
        <span class="bar" style="width:${Math.round((spot.changes / widest) * 90) + 16}px"></span>
        <span class="path">${esc(spot.path)}</span>
        <span class="c">${plural(spot.changes, 'file')}</span>
      </div>`
    )
    .join('');

  setScreen(`<div class="page wide">
    <div class="head">
      <h1 class="title">Catch up</h1>
      <div class="head-meta"><span>${esc(since)}</span></div>
    </div>

    <div class="tally in">
      <div><span class="n">${cu.storyCount}</span><span class="k">changes</span></div>
      <div><span class="n">${cu.fileCount}</span><span class="k">files touched</span></div>
      <div><span class="n plus">+${cu.added}</span><span class="k">lines added</span></div>
      <div><span class="n minus">&minus;${cu.deleted}</span><span class="k">lines removed</span></div>
    </div>

    <div class="two-col">
      <div class="in">
        <div class="label" style="margin-bottom:10px">${cu.upToDate ? 'Recently' : 'Worth opening'}</div>
        ${highlights}
      </div>
      <div class="in">
        ${spots ? `<div class="block"><div class="label">Where the work was</div>${spots}</div>` : ''}
        ${
          cu.newSymbols.length
            ? `<div class="block"><div class="label">New names in the code</div>
                <div class="chips">${cu.newSymbols.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</div>
              </div>`
            : ''
        }
      </div>
    </div>

    <div class="footnote">
      Opening a change marks it as seen. Every sentence here was written by the AI that made the change.
    </div>
  </div>`);

  for (const button of document.querySelectorAll('.card')) {
    button.addEventListener('click', () => onOpenStory(button.dataset.id));
  }
}

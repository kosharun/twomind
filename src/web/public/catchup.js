import { ago, esc, plural, setScreen } from './ui.js';

/* "What happened while I was away."

   Only three things belong here: how much moved, the handful of changes worth
   reading, and where the movement was concentrated. Everything else is a click
   away in Changes. */

export function showCatchUp(state, onOpenStory) {
  const { catchUp: cu, stories } = state;

  if (!stories.length) {
    setScreen(`<div class="empty">
      <h2>Nothing recorded yet</h2>
      <p>Leave this open and work normally. When your agent finishes a task that
      changed files, it writes down what it did and why — and the entry appears here.</p>
      <p class="mono" style="margin-top:20px">stuck? run <strong>twomind doctor</strong></p>
    </div>`);
    return;
  }

  const since = cu.since ? `since you last looked, ${ago(cu.since)}` : 'your most recent changes';

  const highlights = cu.highlights.length
    ? cu.highlights
        .map(
          (h) => `<button class="card" data-id="${esc(h.id)}">
            <div class="t">${esc(h.title)}</div>
            <div class="w">${esc(h.why)}</div>
          </button>`
        )
        .join('')
    : '<p class="mono" style="color:var(--chalk-3)">Nothing new.</p>';

  const widest = Math.max(1, ...cu.blindSpots.map((s) => s.changes));
  const spots = cu.blindSpots
    .map(
      (spot) => `<div class="spot">
        <span class="bar" style="width:${Math.round((spot.changes / widest) * 120) + 20}px"></span>
        <span class="path">${esc(spot.path)}</span>
        <span class="c">${plural(spot.changes, 'file change')}</span>
      </div>`
    )
    .join('');

  setScreen(`<div class="page">
    <div class="head">
      <h1 class="title">Catch up</h1>
      <div class="head-meta"><span>${esc(since)}</span></div>
    </div>

    <div class="tally in">
      <div><span class="n">${cu.storyCount}</span><span class="k">changes</span></div>
      <div><span class="n">${cu.fileCount}</span><span class="k">files touched</span></div>
      <div><span class="n plus">+${cu.added}</span><span class="k">lines added</span></div>
      <div><span class="n minus">−${cu.deleted}</span><span class="k">lines removed</span></div>
    </div>

    <div class="block in">
      <div class="label">Worth reading</div>
      ${highlights}
    </div>

    ${spots ? `<div class="block in"><div class="label">Where the work was</div>${spots}</div>` : ''}

    <div class="footnote">
      Opening a change marks it as seen. Every sentence here was written by the agent that made the change.
    </div>
  </div>`);

  for (const button of document.querySelectorAll('.card')) {
    button.addEventListener('click', () => onOpenStory(button.dataset.id));
  }
}

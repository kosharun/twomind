import { esc, getJson, plural, setScreen, wireDisclosures } from './ui.js';
import { renderDiff } from './diff.js';

/* One change, told as a ledger entry.

   The order of the page is the order the agent asked for: what you wanted,
   what it says it did, how to check it, then the files — the ones it called
   the heart of the change first, everything else folded away behind them. */

const GROUP_NOTE = {
  start: 'the agent says: read these first',
  important: 'the agent says these matter too',
  small: 'minor changes, a quick look is enough',
  unexplained: 'the agent never said why these changed',
};

function voiceBlocks(meta) {
  const out = [];

  if (meta.prompt) {
    out.push(`<div class="block in">
      <div class="label">You asked</div>
      <div class="voice-you">${esc(meta.prompt)}</div>
    </div>`);
  }

  if (meta.explainedBy === 'agent-note') {
    out.push(`<div class="block in">
      <div class="label">The agent's explanation</div>
      <div class="voice-agent">${esc(meta.agentSummary || 'It listed the files but wrote no summary.')}</div>
    </div>`);
  } else if (meta.explainedBy === 'agent-message') {
    out.push(`<div class="block in">
      <div class="label">What the agent said at the end</div>
      <div class="voice-alert">It never wrote its note, so this is only its last chat message.</div>
      <div class="voice-agent" style="margin-top:8px">${esc(meta.agentSummary)}</div>
    </div>`);
  } else {
    out.push(`<div class="block in">
      <div class="voice-alert">The agent did not explain this change.</div>
    </div>`);
  }

  if (meta.howToTest?.length) {
    out.push(`<div class="block in">
      <div class="label">How to test</div>
      <ol class="steps">${meta.howToTest.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
    </div>`);
  }

  return out.join('');
}

/** One file = one station on the route line. */
function station(file, diffs, level) {
  const why = file.why
    ? `<div class="station-why">${esc(file.why)}</div>`
    : `<div class="station-why none">no explanation for this file</div>`;
  const tag = file.status !== 'modified' ? `<span class="tag ${file.status}">${file.status}</span>` : '';

  return `<div class="station ${level === 'start' ? 'key' : ''}${file.why ? '' : ' unexplained'}" data-box>
    <button class="station-head" data-toggle aria-expanded="false">
      <span class="path">${esc(file.path)}${tag}</span>
      ${why}
      <span class="station-stat"><span class="plus">+${file.added}</span> <span class="minus">−${file.deleted}</span></span>
    </button>
    <div class="station-body">${renderDiff(diffs[file.path])}</div>
  </div>`;
}

function tailBlocks(meta) {
  const out = [];

  if (meta.decisions?.length) {
    out.push(`<div class="block in">
      <div class="label">Decisions the agent made</div>
      <ul class="plain-list">${meta.decisions
        .map((d) => `<li><strong>${esc(d.choice)}</strong>${d.why ? ` — ${esc(d.why)}` : ''}</li>`)
        .join('')}</ul>
    </div>`);
  }

  if (meta.notTested?.length) {
    out.push(`<div class="block in">
      <div class="label">Not tested</div>
      <ul class="plain-list">${meta.notTested.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
    </div>`);
  }

  return out.join('');
}

export async function showStory(id, number) {
  setScreen('<div class="empty">Reading the change…</div>');

  const { meta, diffs } = await getJson(`/api/story/${encodeURIComponent(id)}`);
  const byPath = Object.fromEntries(meta.files.map((f) => [f.path, f]));
  const diffsByPath = Object.fromEntries(diffs.map((d) => [d.path, d]));

  const startFiles = meta.startHere.map((p) => byPath[p]).filter(Boolean);
  const startHere = startFiles.length
    ? `<div class="section">
        <div class="label" style="margin-bottom:12px">Start here</div>
        <div class="route you">${startFiles.map((f) => station(f, diffsByPath, 'start')).join('')}</div>
      </div>`
    : '';

  const startPaths = new Set(meta.startHere);
  const groups = meta.groups
    .map((group) => {
      const files = group.files.map((p) => byPath[p]).filter((f) => f && !startPaths.has(f.path));
      if (!files.length) return '';
      const open = group.category === 'important' || group.category === 'unexplained';
      return `<div class="group${open ? ' open' : ''}${
        group.category === 'unexplained' ? ' unexplained' : ''
      }" data-box>
        <button class="group-head" data-toggle aria-expanded="${open}">
          <span class="caret">▶</span>
          <span class="group-name">${esc(group.label)}</span>
          <span class="group-note">${plural(files.length, 'file')} · ${GROUP_NOTE[group.category] ?? ''}</span>
        </button>
        <div class="group-body"><div class="route">${files
          .map((f) => station(f, diffsByPath, group.category))
          .join('')}</div></div>
      </div>`;
    })
    .join('');

  setScreen(`<div class="page">
    <div class="head">
      <div class="head-badge">${String(number ?? '').padStart(2, '0')}</div>
      <h1 class="title">${esc(meta.title)}</h1>
      <div class="head-meta">
        <span>${new Date(meta.createdAt).toLocaleString()}</span>
        <span>${esc(meta.agent || 'agent')}</span>
        ${meta.branch ? `<span>${esc(meta.branch)}</span>` : ''}
        <span>${plural(meta.stats.files, 'file')}</span>
        <span class="plus">+${meta.stats.added}</span>
        <span class="minus">−${meta.stats.deleted}</span>
      </div>
    </div>

    ${voiceBlocks(meta)}
    ${startHere}
    ${groups ? `<div class="section"><div class="label" style="margin-bottom:12px">The rest of the change</div>${groups}</div>` : ''}
    ${tailBlocks(meta)}

    <div class="footnote">
      The order and every explanation here were written by the agent that made this change.
      Twomind only added the real diff.
    </div>
  </div>`);

  wireDisclosures();
  fetch('/api/seen', { method: 'POST' }).catch(() => {});
}

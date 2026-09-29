import { esc, getJson, plural, setScreen } from './ui.js';
import { renderDiff } from './diff.js';
import { openFlowOverlay } from './flow.js';

/* One change, read like a short story.

   The screen is split: the story on the left, the code on the right. You read
   a part, and its code is already beside it. Nothing is a wall of text: the
   left side is only sentences, and the right side only shows the piece you
   picked.

   When the AI wrote chapters, the left side is those chapters. When it did not
   (an older change, or it skipped them), the left side is the files it changed,
   in the order it ranked them. */

const GROUP_LABEL = {
  start: 'Read these first',
  important: 'Worth reading',
  small: 'Small stuff',
  unexplained: 'The AI did not explain these',
};

const fnLabel = (fn) => fn.label;

/** Only the lines a chapter talks about, with a little room around them. */
function excerpt(fileDiff, ranges) {
  if (!fileDiff?.lines || !ranges?.length) return fileDiff;
  let next = 1;
  const kept = [];
  let gap = false;
  for (const line of fileDiff.lines) {
    if (line.type === 'meta') continue;
    if (line.type === 'hunk') {
      if (line.newNo) next = line.newNo;
      gap = true;
      continue;
    }
    const at = line.newNo ?? next;
    if (line.newNo) next = line.newNo + 1;
    if (!ranges.some(([from, to]) => at >= from - 2 && at <= to + 2)) {
      gap = true;
      continue;
    }
    if (gap && kept.length) kept.push({ type: 'hunk', text: '…', oldNo: null, newNo: null });
    gap = false;
    kept.push(line);
  }
  return { ...fileDiff, lines: kept, empty: !kept.some((l) => l.type === 'add' || l.type === 'del') };
}

/* ---------- the reading column ---------- */

function say(kind, label, text, clip = false) {
  if (!text) return '';
  return `<div class="say ${kind}">
    ${label ? `<span class="label">${label}</span>` : ''}
    <div class="say-body${clip ? ' clip' : ''}">${esc(text)}</div>
    ${clip ? '<button class="more" data-unclip>Show all of it</button>' : ''}
  </div>`;
}

function voice(meta) {
  const out = [say('you', 'You asked', meta.prompt, meta.prompt.length > 260)];

  if (meta.explainedBy === 'agent-note') {
    out.push(say('ai', 'What the AI says it did', meta.agentSummary || 'It listed the files but wrote no summary.'));
  } else if (meta.explainedBy === 'agent-message') {
    out.push(say('warn', '', 'The AI never wrote its note, so this is only its last chat message.'));
    out.push(say('ai', '', meta.agentSummary));
  } else {
    out.push(say('warn', '', 'The AI did not explain this change.'));
  }

  if (meta.howToTest?.length) {
    out.push(`<div class="say">
      <span class="label">How to check it</span>
      <ol class="steps">${meta.howToTest.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
    </div>`);
  }
  return out.join('');
}

function chapterRow(chapter, index, ctx) {
  const on = ctx.sel.kind === 'chapter' && ctx.sel.index === index;
  const names = chapter.files.map((f) => f.split('/').pop());
  return `<button class="part${on ? ' on' : ''}" data-part="${index}">
    <span class="no">${index + 1}</span>
    <h3>${esc(chapter.title || `Part ${index + 1}`)}</h3>
    ${chapter.what ? `<p>${esc(chapter.what)}</p>` : ''}
    ${names.length ? `<span class="chips">${names.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</span>` : ''}
  </button>`;
}

function fileRow(file, ctx) {
  const on = ctx.sel.kind === 'file' && ctx.sel.path === file.path;
  const tag = file.status !== 'modified' ? `<span class="tag ${file.status}">${file.status}</span>` : '';
  const why = file.why
    ? `<span class="why">${esc(file.why)}</span>`
    : '<span class="why none">the AI did not say why</span>';
  return `<button class="frow${on ? ' on' : ''}" data-file="${esc(file.path)}">
    <span><span class="path">${esc(file.path)}${tag}</span>${why}</span>
    <span class="n"><span class="plus">+${file.added}</span> <span class="minus">&minus;${file.deleted}</span></span>
  </button>`;
}

function fileGroups(ctx) {
  return ctx.meta.groups
    .map((group) => {
      const files = group.files.map((p) => ctx.byPath[p]).filter(Boolean);
      if (!files.length) return '';
      return `<div class="block">
        <div class="label">${GROUP_LABEL[group.category] ?? group.label} (${files.length})</div>
        ${files.map((f) => fileRow(f, ctx)).join('')}
      </div>`;
    })
    .join('');
}

function tail(meta) {
  const out = [];
  if (meta.decisions?.length) {
    out.push(`<div class="block">
      <div class="label">What it decided</div>
      <ul class="plain-list">${meta.decisions
        .map((d) => `<li><strong>${esc(d.choice)}</strong>${d.why ? `: ${esc(d.why)}` : ''}</li>`)
        .join('')}</ul>
    </div>`);
  }
  if (meta.notTested?.length) {
    out.push(`<div class="block">
      <div class="label">It did not check</div>
      <ul class="plain-list">${meta.notTested.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
    </div>`);
  }
  return out.join('');
}

function readColumn(ctx) {
  const { meta } = ctx;
  const chapters = meta.chapters ?? [];
  const inChapters = new Set(chapters.flatMap((c) => c.files));
  const loose = meta.files.filter((f) => !inChapters.has(f.path));

  const parts = chapters.length
    ? `<div class="section">
        <div class="label section-label">The story, in ${plural(chapters.length, 'part')}</div>
        <div class="parts">${chapters.map((c, i) => chapterRow(c, i, ctx)).join('')}</div>
      </div>
      ${
        loose.length
          ? `<div class="block">
              <div class="label">Also changed, not in any part (${loose.length})</div>
              ${loose.map((f) => fileRow(f, ctx)).join('')}
            </div>`
          : ''
      }`
    : fileGroups(ctx);

  return `<div class="story-head">
      <div class="badge">${String(ctx.number ?? '').padStart(2, '0')}</div>
      <h1>${esc(meta.title)}</h1>
      <div class="head-meta">
        <span>${new Date(meta.createdAt).toLocaleString()}</span>
        <span>${esc(meta.agent || 'AI')}</span>
        <span>${plural(meta.stats.files, 'file')}</span>
        <span class="plus">+${meta.stats.added}</span>
        <span class="minus">&minus;${meta.stats.deleted}</span>
      </div>
    </div>
    ${voice(meta)}
    ${parts}
    ${chapters.length ? `<div class="section">${fileGroups(ctx)}</div>` : ''}
    ${tail(meta)}`;
}

/* ---------- the code column ---------- */

/** What is picked right now: which files, which lines, and can it be simulated. */
function selection(ctx) {
  if (ctx.sel.kind === 'chapter') {
    const chapter = ctx.meta.chapters[ctx.sel.index];
    return {
      title: chapter.title || `Part ${ctx.sel.index + 1}`,
      sub: `part ${ctx.sel.index + 1} of ${ctx.meta.chapters.length}`,
      files: chapter.files.map((p) => ctx.byPath[p]).filter(Boolean),
      lines: chapter.lines ?? {},
      flow: ctx.flows?.chapters?.[ctx.sel.index] ?? null,
      flowLabel: 'Simulate this part',
    };
  }
  const file = ctx.byPath[ctx.sel.path];
  return {
    title: file ? file.path.split('/').pop() : 'Nothing picked',
    sub: file ? file.path : '',
    files: file ? [file] : [],
    lines: {},
    flow: ctx.meta.chapters?.length ? null : ctx.flows?.whole ?? null,
    flowLabel: 'Simulate the change',
  };
}

function codeColumn(ctx) {
  const sel = selection(ctx);
  if (!sel.files.length) {
    return `<div class="code-head"><div class="code-what"><div class="t">Nothing picked</div></div></div>
      <div class="code-scroll"><p class="code-empty">Pick a part or a file on the left, and its code shows up here.</p></div>`;
  }

  const trimmable = sel.files.some((f) => sel.lines[f.path]?.length);
  const whole = ctx.scope === 'file' || !trimmable;

  const flowButton = sel.flow?.starts?.length
    ? `<button class="btn primary" data-simulate>${sel.flowLabel}</button>`
    : '';

  const scopeToggle = trimmable
    ? `<div class="seg">
        <button data-scope="part" class="${whole ? '' : 'on'}">Just this part</button>
        <button data-scope="file" class="${whole ? 'on' : ''}">Whole file</button>
      </div>`
    : '';

  const body = sel.files
    .map((file) => {
      const full = ctx.diffsByPath[file.path];
      const shown = whole ? full : excerpt(full, sel.lines[file.path]);
      return `<div class="code-file">
        <div class="code-file-head">
          <span class="path">${esc(file.path)}</span>
          ${file.why ? `<span class="why">${esc(file.why)}</span>` : ''}
        </div>
        ${renderDiff(shown)}
      </div>`;
    })
    .join('');

  return `<div class="code-head">
      <div class="code-what">
        <div class="t">${esc(sel.title)}</div>
        <div class="s">${esc(sel.sub)}${sel.files.length > 1 ? `, ${plural(sel.files.length, 'file')}` : ''}</div>
      </div>
      <div class="code-tools">${scopeToggle}${flowButton}</div>
    </div>
    <div class="code-scroll">${body}</div>`;
}

/* ---------- wiring ---------- */

function paint(ctx) {
  const read = document.querySelector('.story-read');
  const code = document.querySelector('.story-code');
  if (!read || !code) return;

  for (const button of read.querySelectorAll('[data-part]')) {
    button.classList.toggle('on', ctx.sel.kind === 'chapter' && Number(button.dataset.part) === ctx.sel.index);
  }
  for (const button of read.querySelectorAll('[data-file]')) {
    button.classList.toggle('on', ctx.sel.kind === 'file' && button.dataset.file === ctx.sel.path);
  }

  code.innerHTML = codeColumn(ctx);
  code.querySelector('.code-scroll').scrollTop = 0;
}

function draw(ctx) {
  setScreen(`<div class="story" data-story="${esc(ctx.meta.id)}">
    <div class="story-read">${readColumn(ctx)}</div>
    <div class="story-code">${codeColumn(ctx)}</div>
  </div>`);

  document.querySelector('.story').addEventListener('click', (event) => {
    const target = event.target.closest('[data-part], [data-file], [data-scope], [data-simulate], [data-unclip]');
    if (!target) return;

    if (target.dataset.part !== undefined) {
      ctx.sel = { kind: 'chapter', index: Number(target.dataset.part) };
      ctx.scope = 'part';
      paint(ctx);
    } else if (target.dataset.file !== undefined) {
      ctx.sel = { kind: 'file', path: target.dataset.file };
      ctx.scope = 'part';
      paint(ctx);
    } else if (target.dataset.scope) {
      ctx.scope = target.dataset.scope;
      paint(ctx);
    } else if (target.dataset.simulate !== undefined) {
      const sel = selection(ctx);
      openFlowOverlay({
        kicker: ctx.sel.kind === 'chapter' ? `Part ${ctx.sel.index + 1}` : 'The change',
        title: ctx.sel.kind === 'chapter' ? sel.title : ctx.meta.title,
        starts: sel.flow.starts.map((s) => ({ id: s.id, name: fnLabel(s) })),
        storyId: ctx.meta.id,
      });
    } else {
      target.previousElementSibling.classList.remove('clip');
      target.remove();
    }
  });
}

/** Where to start reading: the first part, or the first file the AI put first. */
function firstSelection(meta) {
  if (meta.chapters?.length) return { kind: 'chapter', index: 0 };
  const first = meta.files.find((f) => f.startHere) ?? meta.files[0];
  return { kind: 'file', path: first?.path ?? '' };
}

export async function showStory(id, number) {
  setScreen('<div class="empty">Reading the change…</div>');

  const { meta, diffs } = await getJson(`/api/story/${encodeURIComponent(id)}`);
  const ctx = {
    meta,
    number,
    byPath: Object.fromEntries(meta.files.map((f) => [f.path, f])),
    diffsByPath: Object.fromEntries(diffs.map((d) => [d.path, d])),
    flows: null,
    scope: 'part',
    sel: firstSelection(meta),
  };

  draw(ctx);
  fetch('/api/seen', { method: 'POST' }).catch(() => {});

  // Flows need the code parsed, which takes a moment on a big project. The
  // story shows first, and the Simulate button appears when it is ready.
  getJson(`/api/story/${encodeURIComponent(id)}/flows`)
    .then((flows) => {
      ctx.flows = flows;
      if (document.querySelector(`.story[data-story="${CSS.escape(meta.id)}"]`)) paint(ctx);
    })
    .catch(() => {});
}

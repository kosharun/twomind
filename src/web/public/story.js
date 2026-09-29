import { esc, getJson, plural, setScreen, wireDisclosures } from './ui.js';
import { renderDiff } from './diff.js';

/* One change, read like a short story.

   The screen is split: the story on the left, the code on the right. Pick a
   part and its code shows up beside it, already open.

   When an AI wrote "steps" for a part, the right side is a guided walk
   through the code: one plain sentence, then just the few lines it is
   about, then the next sentence. That is the point of this whole screen:
   you are meant to be led through it, not handed a file and left alone.

   When there are no steps (an older change, or the AI skipped them), the
   right side shows the file split into its functions, each one collapsed to
   a name until you open it. Twomind never writes a sentence about what a
   function does; splitting by function is a fact read with a parser, not a
   claim about meaning. */

const GROUP_LABEL = {
  start: 'Read these first',
  important: 'Worth reading',
  small: 'Small stuff',
  unexplained: 'The AI did not explain these',
};

const KIND_LABEL = { function: 'Function', method: 'Method', route: 'Route' };

/** Only the lines a beat talks about, with a little room around them. */
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

function lastLineOf(fileDiff) {
  let max = 0;
  for (const line of fileDiff?.lines ?? []) if (line.newNo) max = Math.max(max, line.newNo);
  return max;
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

function chapterCard(chapter, index, ctx) {
  const on = ctx.sel.kind === 'chapter' && ctx.sel.index === index;
  const names = chapter.files.map((f) => f.split('/').pop());
  return `<button class="part${on ? ' on' : ''}" data-part="${index}">
    <div class="part-top"><span class="no">${index + 1}</span><h3>${esc(chapter.title || `Part ${index + 1}`)}</h3></div>
    ${chapter.what ? `<p>${esc(chapter.what)}</p>` : ''}
    ${names.length ? `<span class="chips">${names.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</span>` : ''}
  </button>`;
}

function fileCard(file, ctx) {
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
        ${files.map((f) => fileCard(f, ctx)).join('')}
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
        <div class="parts">${chapters.map((c, i) => chapterCard(c, i, ctx)).join('')}</div>
      </div>
      ${
        loose.length
          ? `<div class="block">
              <div class="label">Also changed, not in any part (${loose.length})</div>
              ${loose.map((f) => fileCard(f, ctx)).join('')}
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

/* ---------- the code column: a file, split by function ---------- */

/** One function of a file, collapsed to its name until opened. Only shown when it really changed. */
function chunk(title, kind, fileDiff, open) {
  return `<div class="chunk${open ? ' open' : ''}" data-box>
    <button class="chunk-head" data-toggle aria-expanded="${open}">
      <span class="caret">▶</span>
      <span class="chunk-name">${esc(title)}</span>
      ${kind ? `<span class="chunk-kind">${esc(kind)}</span>` : ''}
    </button>
    <div class="chunk-body">${renderDiff(fileDiff)}</div>
  </div>`;
}

/**
 * A file's diff, split at its function boundaries (a fact from the parser),
 * with only the functions that really changed shown, each collapsed until
 * opened. Falls back to the plain diff when the file has no outline yet, or
 * the outline has fewer than two definitions worth splitting on.
 */
function fileCodeHtml(file, ctx) {
  const full = ctx.diffsByPath[file.path];
  if (!full) return renderDiff(full);
  if (ctx.forceFull?.has(file.path)) return renderDiff(full);

  const fns = (ctx.outline?.[file.path] ?? []).slice().sort((a, b) => a.line - b.line);
  if (fns.length < 1) return renderDiff(full);

  const spans = [];
  let cursor = 1;
  let leadingCount = 0;
  for (const fn of fns) {
    if (fn.line > cursor) {
      leadingCount += 1;
      spans.push({
        title: leadingCount === 1 ? 'Before the first function' : 'Between two functions',
        kind: null,
        from: cursor,
        to: fn.line - 1,
      });
    }
    spans.push({
      title: fn.route ?? (fn.owner ? `${fn.owner}.${fn.name}()` : `${fn.name}()`),
      kind: KIND_LABEL[fn.kind] ?? null,
      from: fn.line,
      to: fn.endLine,
    });
    cursor = fn.endLine + 1;
  }
  const end = lastLineOf(full);
  if (cursor <= end) spans.push({ title: leadingCount ? 'The rest of the file' : 'The whole file', kind: null, from: cursor, to: end });

  const chunks = spans.map((s) => ({ ...s, diff: excerpt(full, [[s.from, s.to]]) })).filter((c) => !c.diff.empty);
  if (chunks.length < 1) return renderDiff(full);

  const open = chunks.length === 1;
  return (
    chunks.map((c) => chunk(c.title, c.kind, c.diff, open)).join('') +
    `<button class="chunk-all" data-show-full="${esc(file.path)}">Show the whole file instead</button>`
  );
}

function fileBlock(file, innerHtml) {
  return `<div class="code-file">
    <div class="code-file-head">
      <span class="path">${esc(file.path)}</span>
      ${file.why ? `<span class="why">${esc(file.why)}</span>` : ''}
    </div>
    ${innerHtml}
  </div>`;
}

/* ---------- the code column: a guided walkthrough ---------- */

function walkthroughHtml(chapter, ctx) {
  let shownFile = null;
  const beats = chapter.steps
    .map((step) => {
      const fileDiff = step.file ? ctx.diffsByPath[step.file] : null;
      const hasCode = fileDiff && step.lines?.length;
      const showFileLabel = hasCode && step.file !== shownFile;
      if (hasCode) shownFile = step.file;
      return `<div class="beat">
        <div class="say ai"><div class="say-body small">${esc(step.say)}</div></div>
        ${
          hasCode
            ? `<div class="beat-code">
                ${showFileLabel ? `<div class="beat-file">${esc(step.file)}</div>` : ''}
                ${renderDiff(excerpt(fileDiff, step.lines))}
              </div>`
            : ''
        }
      </div>`;
    })
    .join('');
  return `<div class="walk">${beats}</div>`;
}

function chapterCodeHtml(chapter, ctx) {
  if (chapter.steps?.length) {
    const touched = new Set(chapter.steps.map((s) => s.file).filter(Boolean));
    const rest = chapter.files.filter((f) => !touched.has(f));
    const restHtml = rest
      .map((f) => {
        const file = ctx.byPath[f];
        return file ? fileBlock(file, fileCodeHtml(file, ctx)) : '';
      })
      .join('');
    return (
      walkthroughHtml(chapter, ctx) +
      (rest.length ? `<div class="also-in-part"><div class="label">Also in this part</div>${restHtml}</div>` : '')
    );
  }

  return chapter.files
    .map((f) => {
      const file = ctx.byPath[f];
      if (!file) return '';
      const explicit = chapter.lines?.[f];
      const inner = explicit?.length ? renderDiff(excerpt(ctx.diffsByPath[f], explicit)) : fileCodeHtml(file, ctx);
      return fileBlock(file, inner);
    })
    .join('');
}

/* ---------- the code column ---------- */

function selectionMeta(ctx) {
  if (ctx.sel.kind === 'chapter') {
    const chapter = ctx.meta.chapters[ctx.sel.index];
    return { title: chapter.title || `Part ${ctx.sel.index + 1}`, sub: `part ${ctx.sel.index + 1} of ${ctx.meta.chapters.length}` };
  }
  const file = ctx.byPath[ctx.sel.path];
  return { title: file ? file.path.split('/').pop() : 'Nothing picked', sub: file ? file.path : '' };
}

function codeColumn(ctx) {
  const head = selectionMeta(ctx);

  let body;
  if (ctx.sel.kind === 'chapter') {
    body = chapterCodeHtml(ctx.meta.chapters[ctx.sel.index], ctx);
  } else {
    const file = ctx.byPath[ctx.sel.path];
    body = file ? fileCodeHtml(file, ctx) : '<p class="code-empty">Pick a part or a file on the left, and its code shows up here.</p>';
  }

  return `<div class="code-head">
      <div class="code-what">
        <div class="t">${esc(head.title)}</div>
        <div class="s">${esc(head.sub)}</div>
      </div>
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
  wireDisclosures(code);
}

function draw(ctx) {
  setScreen(`<div class="story" data-story="${esc(ctx.meta.id)}">
    <div class="story-read">${readColumn(ctx)}</div>
    <div class="story-code">${codeColumn(ctx)}</div>
  </div>`);
  wireDisclosures(document.querySelector('.story-code'));

  document.querySelector('.story').addEventListener('click', (event) => {
    const target = event.target.closest('[data-part], [data-file], [data-unclip], [data-show-full]');
    if (!target) return;

    if (target.dataset.part !== undefined) {
      ctx.sel = { kind: 'chapter', index: Number(target.dataset.part) };
      paint(ctx);
    } else if (target.dataset.file !== undefined) {
      ctx.sel = { kind: 'file', path: target.dataset.file };
      paint(ctx);
    } else if (target.dataset.showFull !== undefined) {
      ctx.forceFull.add(target.dataset.showFull);
      paint(ctx);
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
    outline: null,
    forceFull: new Set(),
    sel: firstSelection(meta),
  };

  draw(ctx);
  fetch('/api/seen', { method: 'POST' }).catch(() => {});

  // Splitting a file by function needs it parsed, which takes a moment on a
  // big project. The story shows first with the plain diff; it upgrades to
  // the split view the moment the outline is ready.
  const files = meta.files.map((f) => f.path).join(',');
  if (files) {
    getJson(`/api/flow/outline?files=${encodeURIComponent(files)}`)
      .then((outline) => {
        ctx.outline = outline;
        if (document.querySelector(`.story[data-story="${CSS.escape(meta.id)}"]`)) paint(ctx);
      })
      .catch(() => {});
  }
}

import { esc } from './ui.js';
import { renderLines } from './highlight.js';

/* The flow: one function, and what it calls, drawn as boxes and arrows.
   This is the "Explore" view. There is no other mode.

   Click a box to read about it on the right: what it calls, what an AI said
   about its file, and its code. Drag a box if two arrows overlap. Scroll to
   zoom. Every box and every line is read from the code with a parser; the
   only sentences are the ones an AI wrote in a story. */

const BOX = { w: 210, h: 76 };
const GAP = { x: 132, y: 28 };

const KIND_LABEL = {
  function: 'Function',
  method: 'Method',
  route: 'Route',
  external: 'Outside the project',
  error: 'Error',
};

let mounts = 0;

/* ---------- placing the boxes ---------- */

/** A box sits one column right of its furthest caller, so arrows point right. */
function columnsOf(graph) {
  const out = new Map();
  for (const edge of graph.edges) {
    if (!out.has(edge.from)) out.set(edge.from, []);
    out.get(edge.from).push(edge.to);
  }

  const state = new Map();
  const back = new Set();
  const order = [];
  const visit = (id) => {
    state.set(id, 'open');
    for (const to of out.get(id) ?? []) {
      if (state.get(to) === 'open') back.add(`${id}>${to}`);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 'done');
    order.unshift(id);
  };
  visit(graph.entry);

  const column = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const id of order) {
    for (const to of out.get(id) ?? []) {
      if (!back.has(`${id}>${to}`)) column.set(to, Math.max(column.get(to), column.get(id) + 1));
    }
  }
  return column;
}

function layout(graph) {
  const columnOf = columnsOf(graph);
  const columns = new Map();
  for (const node of graph.nodes) {
    const depth = columnOf.get(node.id);
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth).push(node);
  }

  const incoming = new Map();
  for (const edge of graph.edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
  }

  const row = new Map();
  const depths = [...columns.keys()].sort((a, b) => a - b);
  for (const depth of depths) {
    const column = columns.get(depth);
    const weight = (node) => {
      const keys = (incoming.get(node.id) ?? [])
        .filter((edge) => row.has(edge.from))
        .map((edge) => row.get(edge.from) * 1000 + edge.order);
      return keys.length ? Math.min(...keys) : Number.MAX_SAFE_INTEGER;
    };
    if (depth > 0) column.sort((a, b) => weight(a) - weight(b));
    column.forEach((node, i) => row.set(node.id, i));
  }

  const tallest = Math.max(...depths.map((d) => columns.get(d).length));
  const pos = new Map();
  for (const depth of depths) {
    const column = columns.get(depth);
    const offset = ((tallest - column.length) * (BOX.h + GAP.y)) / 2;
    column.forEach((node, i) => {
      pos.set(node.id, { x: depth * (BOX.w + GAP.x), y: offset + i * (BOX.h + GAP.y) });
    });
  }

  return {
    pos,
    width: depths.length * (BOX.w + GAP.x) - GAP.x,
    height: tallest * (BOX.h + GAP.y) - GAP.y,
  };
}

/**
 * Where an arrow leaves and arrives. Several arrows from one box are spread
 * down its side instead of all starting at the same point, which is what made
 * them pile on top of each other.
 */
function anchors(graph) {
  const out = new Map();
  const into = new Map();
  graph.edges.forEach((edge, i) => {
    if (!out.has(edge.from)) out.set(edge.from, []);
    out.get(edge.from).push(i);
    if (!into.has(edge.to)) into.set(edge.to, []);
    into.get(edge.to).push(i);
  });
  for (const list of out.values()) list.sort((a, b) => graph.edges[a].order - graph.edges[b].order);

  const spread = (list, index) => (BOX.h * (list.indexOf(index) + 1)) / (list.length + 1);
  return {
    from: (i) => spread(out.get(graph.edges[i].from), i),
    to: (i) => spread(into.get(graph.edges[i].to), i),
  };
}

/** A point along a cubic curve. */
function at(t, p0, p1, p2, p3) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: w[0] * p0.x + w[1] * p1.x + w[2] * p2.x + w[3] * p3.x,
    y: w[0] * p0.y + w[1] * p1.y + w[2] * p2.y + w[3] * p3.y,
  };
}

/**
 * The curve, and where its label goes. The label sits near the start, not in
 * the middle: arrows leaving one box fan out there, so their labels land on
 * separate lines instead of in one pile where the arrows converge again.
 */
function curve(a, b) {
  if (b.x > a.x) {
    const dx = Math.max(40, (b.x - a.x) / 2);
    const c1 = { x: a.x + dx, y: a.y };
    const c2 = { x: b.x - dx, y: b.y };
    return { d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`, mid: at(0.36, a, c1, c2, b) };
  }
  // A call back to an earlier column loops underneath.
  const low = Math.max(a.y, b.y) + BOX.h;
  return {
    d: `M${a.x},${a.y} C${a.x + 70},${a.y} ${a.x + 70},${low} ${(a.x + b.x) / 2},${low} S${b.x - 70},${b.y} ${b.x},${b.y}`,
    mid: { x: (a.x + b.x) / 2, y: low },
  };
}

/* ---------- pieces of markup ---------- */

function nodeInner(node) {
  return `<span class="fnode-kind">${KIND_LABEL[node.kind] ?? node.kind}${node.changed ? '<i>changed</i>' : ''}</span>
    <span class="fnode-name" title="${esc(node.name)}">${esc(node.name)}</span>
    <span class="fnode-sub" title="${esc(node.sub)}">${esc(node.sub)}</span>`;
}

function codeBlock(fn) {
  return renderLines(fn.code, { startAt: fn.line, changed: new Set(fn.changedLines) });
}

/** The same code, in a big centred window, for when the small panel is too cramped to read. */
function openCodeModal(graph, id) {
  const node = graph.nodeById.get(id);
  const fn = graph.functions[id];
  if (!node || !fn) return;

  const modal = document.createElement('div');
  modal.className = 'code-modal-backdrop';
  modal.innerHTML = `<div class="code-modal">
    <div class="code-modal-head">
      <div>
        <div class="fp-name" style="margin:0">${esc(node.name)}</div>
        <div class="fp-where">${esc(node.sub)}${node.line ? `, line ${node.line}` : ''}</div>
      </div>
      <button class="btn" data-close-code>Close</button>
    </div>
    <div class="code-modal-body">${codeBlock(fn)}</div>
  </div>`;
  document.body.append(modal);
  document.body.classList.add('overlay-open');

  const close = () => {
    modal.remove();
    document.body.classList.remove('overlay-open');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-close-code]')) close();
  });
}

function kindLine(node) {
  return `<div class="fp-kind">${KIND_LABEL[node.kind] ?? node.kind}${
    node.changed ? ' <span class="fp-changed">changed here</span>' : ''
  }</div>`;
}

/** A call or a throw, as a small clickable pill instead of a sentence. */
function pill(label, cond, dataAttr, extraClass = '') {
  return `<button class="pill ${extraClass}" ${dataAttr}>${esc(label)}${
    cond ? `<span class="pill-cond">${esc(cond)}</span>` : ''
  }</button>`;
}

/* ---------- the detail panel ---------- */

function detailPanel(graph, selectedId) {
  const node = graph.nodeById.get(selectedId);
  const head = `${kindLine(node)}<h3 class="fp-name">${esc(node.name)}</h3>
    <div class="fp-where">${esc(node.sub)}${node.line ? `, line ${node.line}` : ''}</div>`;

  if (node.kind === 'external') {
    const callers = graph.edges.filter((e) => e.to === node.id).map((e) => graph.nodeById.get(e.from));
    return `${head}
      <p class="fp-text">This call leaves your project and goes into <strong>${esc(node.sub)}</strong>.
      Twomind does not read inside it.</p>
      <div class="fp-section"><div class="label">Called from</div>
        <div class="pill-list">${callers.map((c) => pill(c.name, '', `data-goto="${esc(c.id)}"`)).join('')}</div>
      </div>`;
  }

  if (node.kind === 'error') {
    const edge = graph.edges.find((e) => e.to === node.id);
    const from = edge ? graph.nodeById.get(edge.from) : null;
    return `${head}
      <p class="fp-text alert"><strong>${esc(from?.name ?? 'The code')}</strong> throws this error${
        edge?.labels[0] ? ` <span class="cond">${esc(edge.labels[0])}</span>` : ''
      }. Everything after it stops, unless a caller catches it.</p>`;
  }

  const fn = graph.functions[node.id];
  const why = graph.why?.[fn.file];
  const seen = new Set();
  const calls = fn.events.filter((e) => {
    const key = `${e.target}|${e.label}`;
    if (!e.target || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return `${head}
    ${
      node.id !== graph.entry
        ? `<div class="fp-actions"><button class="btn" data-open="${esc(node.id)}">Open this function on its own</button></div>`
        : ''
    }
    <div class="fp-section">
      <div class="label">What an AI said about this file</div>
      ${why ? `<div class="say ai"><div class="say-body small">${esc(why)}</div></div>` : '<div class="fp-none">Nothing yet.</div>'}
    </div>
    ${
      calls.length
        ? `<div class="fp-section"><div class="label">It calls</div><div class="pill-list">${calls
            .map((e) => pill(graph.nodeById.get(e.target).name, e.label, `data-goto="${esc(e.target)}"`, e.type === 'throw' ? 'throw' : ''))
            .join('')}</div></div>`
        : ''
    }
    ${
      fn.calledBy.length
        ? `<div class="fp-section"><div class="label">Called from</div><div class="pill-list">${fn.calledBy
            .map((c) => pill(c.name, '', `data-open="${esc(c.id)}"`))
            .join('')}</div></div>`
        : ''
    }
    <div class="fp-section">
      <div class="fp-section-head">
        <div class="label">The code</div>
        <button class="btn small" data-open-code="${esc(fn.id)}">Open full screen</button>
      </div>
      ${codeBlock(fn)}
    </div>`;
}

/* ---------- mounting ---------- */

/**
 * Draw a flow's boxes into `canvasEl` and its detail panel into `panelEl`.
 * options.onOpen(id) is called when the reader asks to re-root the flow at a
 * different function (the caller decides what that means: usually loading a
 * new graph and mounting again).
 */
export function mountFlow(canvasEl, panelEl, graph, options = {}) {
  mounts += 1;
  const uid = mounts;
  graph.nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const placed = layout(graph);
  const anchor = anchors(graph);
  const view = { selected: graph.entry, pos: placed.pos, t: { x: 0, y: 0, k: 1 } };

  canvasEl.classList.add('flow-canvas');
  canvasEl.innerHTML = `<div class="flow-world"></div>
    <div class="flow-zoom">
      <button data-zoom="out" aria-label="Zoom out">&minus;</button>
      <button data-zoom="fit">Fit</button>
      <button data-zoom="in" aria-label="Zoom in">+</button>
    </div>
    ${graph.truncated ? '<div class="flow-note">A big flow: some calls are not drawn. Open a box on its own to see more.</div>' : ''}
    <div class="flow-hint">drag a box to move it</div>`;
  const world = canvasEl.querySelector('.flow-world');

  world.innerHTML = `<svg class="flow-edges" width="${placed.width + BOX.w}" height="${placed.height + BOX.h * 2}">
      <defs>
        <marker id="a-${uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path class="arrow" d="M0,0 L10,5 L0,10 z"></path>
        </marker>
        <marker id="al-${uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path class="arrow lit" d="M0,0 L10,5 L0,10 z"></path>
        </marker>
      </defs>
      ${graph.edges.map((_, i) => `<path class="fedge" data-edge="${i}" marker-end="url(#a-${uid})"></path>`).join('')}
    </svg>
    ${graph.edges
      .map((edge, i) => {
        const label = edge.labels[0] ?? '';
        const extra = edge.labels.length > 1 ? ` +${edge.labels.length - 1}` : '';
        const short = label.length > 17 ? `${label.slice(0, 16)}…` : label;
        const numbered = edge.order > 1 || graph.edges.filter((e) => e.from === edge.from).length > 1;
        const text = [numbered ? edge.order : '', short + extra].filter(Boolean).join(' · ');
        return text
          ? `<span class="flabel" data-edge="${i}" title="${esc(edge.labels.join(' / '))}">${esc(text)}</span>`
          : '';
      })
      .join('')}
    ${graph.nodes
      .map(
        (node) => `<button class="fnode k-${node.kind}${node.id === graph.entry ? ' entry' : ''}"
          data-id="${esc(node.id)}" style="width:${BOX.w}px;height:${BOX.h}px">
          ${nodeInner(node)}
          ${node.more ? '<span class="fnode-more" title="It calls more. Open it on its own to see.">+</span>' : ''}
        </button>`
      )
      .join('')}`;

  const placeAll = () => {
    for (const el of world.querySelectorAll('.fnode')) {
      const p = view.pos.get(el.dataset.id);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    }
  };

  const drawEdges = () => {
    const lit = new Set();
    graph.edges.forEach((edge, i) => {
      if (edge.from === view.selected || edge.to === view.selected) lit.add(i);
    });
    for (const path of world.querySelectorAll('path.fedge')) {
      const i = Number(path.dataset.edge);
      const edge = graph.edges[i];
      const from = view.pos.get(edge.from);
      const to = view.pos.get(edge.to);
      const a = { x: from.x + BOX.w, y: from.y + anchor.from(i) };
      const b = { x: to.x, y: to.y + anchor.to(i) };
      const { d, mid } = curve(a, b);
      path.setAttribute('d', d);
      path.classList.toggle('lit', lit.has(i));
      path.setAttribute('marker-end', `url(#${lit.has(i) ? 'al' : 'a'}-${uid})`);
      const label = world.querySelector(`.flabel[data-edge="${i}"]`);
      if (label) {
        label.style.left = `${mid.x}px`;
        label.style.top = `${mid.y}px`;
        label.classList.toggle('lit', lit.has(i));
      }
    }
    for (const el of world.querySelectorAll('.fnode')) {
      el.classList.toggle('current', el.dataset.id === view.selected);
    }
  };

  const apply = () => {
    world.style.transform = `translate(${view.t.x}px, ${view.t.y}px) scale(${view.t.k})`;
  };

  const fit = () => {
    const rect = canvasEl.getBoundingClientRect();
    const pad = 40;
    const k = Math.min(1.05, Math.max(0.7, Math.min((rect.width - pad * 2) / placed.width, (rect.height - pad * 2) / placed.height)));
    const wide = placed.width * k > rect.width - pad * 2;
    const tall = placed.height * k > rect.height - pad * 2;
    const start = view.pos.get(graph.entry);
    view.t = {
      k,
      x: wide ? pad : (rect.width - placed.width * k) / 2,
      y: tall ? rect.height / 2 - (start.y + BOX.h / 2) * k : (rect.height - placed.height * k) / 2,
    };
    apply();
  };

  /** Pan just enough to bring a box into view, without recentring one already visible. */
  const reveal = (id) => {
    const p = view.pos.get(id);
    if (!p) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = p.x * view.t.k + view.t.x;
    const y = p.y * view.t.k + view.t.y;
    const w = BOX.w * view.t.k;
    const h = BOX.h * view.t.k;
    const pad = 16;
    if (x >= pad && y >= pad && x + w <= rect.width - pad && y + h <= rect.height - pad) return;
    view.t.x = rect.width / 2 - (p.x + BOX.w / 2) * view.t.k;
    view.t.y = rect.height / 2 - (p.y + BOX.h / 2) * view.t.k;
    apply();
  };

  const select = (id) => {
    view.selected = id;
    panelEl.innerHTML = detailPanel(graph, id);
    panelEl.scrollTop = 0;
    drawEdges();
  };

  /* ---- events ---- */

  const onClick = (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const { dataset } = target;

    if (dataset.zoom) {
      const rect = canvasEl.getBoundingClientRect();
      if (dataset.zoom === 'fit') fit();
      else zoomAt(rect.width / 2, rect.height / 2, dataset.zoom === 'in' ? 1.2 : 1 / 1.2);
    } else if (dataset.id !== undefined) {
      if (!dragged) select(dataset.id);
    } else if (dataset.goto) {
      select(dataset.goto);
      reveal(dataset.goto);
    } else if (dataset.open) {
      options.onOpen?.(dataset.open);
    } else if (dataset.openCode) {
      openCodeModal(graph, dataset.openCode);
    }
  };
  canvasEl.addEventListener('click', onClick);
  panelEl.addEventListener('click', onClick);

  /* ---- drag a box, or pan the canvas ---- */

  let drag = null;
  let dragged = false;

  const zoomAt = (px, py, factor) => {
    const k = Math.min(1.8, Math.max(0.3, view.t.k * factor));
    view.t.x = px - (px - view.t.x) * (k / view.t.k);
    view.t.y = py - (py - view.t.y) * (k / view.t.k);
    view.t.k = k;
    apply();
  };

  // Two separate bugs lived here, and both had to go before a plain click
  // worked again:
  //
  // 1. A mouse click always drifts a pixel or two between button-down and
  //    button-up. Moving a box on every one of those pixels meant the drift
  //    alone counted as a drag. Fixed by waiting for a real move (past
  //    DRAG_THRESHOLD) before anything is treated as a drag at all.
  //
  // 2. The bigger one: capturing the pointer on every mousedown, even a
  //    plain click, tells the browser "all of this pointer's events, and the
  //    click built from them, belong to the canvas now", not to the box you
  //    pressed. So the click handler's `event.target` was the canvas, never
  //    the box, and `select()` never ran for a real mouse (only the
  //    keyboard's own Space-to-click on the focused button still worked,
  //    since that never goes through pointer capture). Fixed by only taking
  //    capture once a drag has actually started.
  const DRAG_THRESHOLD = 6;

  canvasEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.flow-zoom')) return;
    const node = event.target.closest('.fnode');
    dragged = false;
    drag = node
      ? { node, id: node.dataset.id, x: event.clientX, y: event.clientY, start: { ...view.pos.get(node.dataset.id) }, pointerId: event.pointerId }
      : { x: event.clientX, y: event.clientY, tx: view.t.x, ty: view.t.y, pointerId: event.pointerId };
  });

  canvasEl.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;

    if (!dragged) {
      if (Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD) return;
      dragged = true;
      try {
        canvasEl.setPointerCapture(drag.pointerId);
      } catch {
        /* the pointer can be gone by the time this runs; the drag still works without capturing it */
      }
      if (drag.node) drag.node.classList.add('dragging-node');
      else canvasEl.classList.add('dragging');
    }

    if (drag.node) {
      view.pos.set(drag.id, { x: drag.start.x + dx / view.t.k, y: drag.start.y + dy / view.t.k });
      const p = view.pos.get(drag.id);
      drag.node.style.left = `${p.x}px`;
      drag.node.style.top = `${p.y}px`;
      drawEdges();
    } else {
      view.t.x = drag.tx + dx;
      view.t.y = drag.ty + dy;
      apply();
    }
  });

  const endDrag = () => {
    drag?.node?.classList.remove('dragging-node');
    drag = null;
    canvasEl.classList.remove('dragging');
    // Let the click that follows a real drag pass, then allow clicks again.
    setTimeout(() => {
      dragged = false;
    }, 0);
  };
  canvasEl.addEventListener('pointerup', endDrag);
  canvasEl.addEventListener('pointercancel', endDrag);

  canvasEl.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false }
  );

  placeAll();
  drawEdges();
  select(graph.entry);
  requestAnimationFrame(fit);

  return {
    destroy() {
      canvasEl.innerHTML = '';
      panelEl.innerHTML = '';
    },
  };
}

export function flowUrl(id, { story, depth } = {}) {
  const params = new URLSearchParams({ id });
  if (story) params.set('story', story);
  if (depth) params.set('depth', String(depth));
  return `/api/flow/graph?${params}`;
}

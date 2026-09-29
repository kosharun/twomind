import { esc, getJson } from './ui.js';

/* The flow view: one function, what it calls, and when.

     Explore    the whole picture. Boxes can be dragged, so you can pull apart
                anything that overlaps. Click a box to read its code.
     Simulate   one path, drawn as a single line from left to right. You pick
                the branches; the line is what really runs.

   Simulate is a line, not the same picture dimmed, because a dimmed picture is
   still a picture with twenty boxes in it. A line has one direction and you can
   follow it with your finger.

   Every box and every line is read from the code. The only sentences are the
   ones agents wrote in their stories. */

const BOX = { w: 210, h: 76 };
const GAP = { x: 132, y: 28 };

const KIND = {
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

/* ---------- the simulation ---------- */

const choiceKey = (fnId, branch) => `${fnId}#${branch}`;

function choiceOf(view, fnId, branchIndex) {
  const key = choiceKey(fnId, branchIndex);
  if (!view.choices.has(key)) view.choices.set(key, defaultArm(view.graph.functions[fnId], branchIndex));
  return view.choices.get(key);
}

function isActive(view, fnId, path) {
  return path.every(([branch, arm]) => choiceOf(view, fnId, branch) === arm);
}

/**
 * Which way a branch goes before you touch it: the arm that leads to the most
 * calls, so the first run shows the main road rather than an early exit.
 */
function defaultArm(fn, branchIndex) {
  const branch = fn.branches[branchIndex];
  if (branch.kind === 'try') return 0;
  const calls = fn.events.filter((e) => e.target && e.type === 'call');
  const inside = (arm) => calls.filter((e) => e.path.some(([b, a]) => b === branchIndex && a === arm)).length;
  const after = calls.filter((e) => e.at > branch.end && !e.path.some(([b]) => b === branchIndex)).length;

  let best = 0;
  let bestScore = -1;
  branch.arms.forEach((arm, i) => {
    const score = (inside(i) + (arm.exits ? 0 : after)) * 2 + (arm.exits ? 0 : 1);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** Walk the path the current choices make: every box it visits, in order. */
function simulate(view) {
  const { graph } = view;
  const steps = [];
  const onStack = new Set();
  let stopped = false;

  const visit = (id, via) => {
    if (stopped || steps.length >= 60) return;
    const node = graph.nodeById.get(id);
    const fn = graph.functions[id];
    const step = { id, via, events: [], stoppedEarly: false };
    steps.push(step);

    if (node.kind === 'error') {
      stopped = true;
      return;
    }
    if (!fn || node.more) return;
    onStack.add(id);

    const marks = [
      ...fn.branches.map((branch, index) => ({ at: branch.at, branch, index })),
      ...fn.events.map((event, index) => ({ at: event.at, event, index })),
    ].sort((a, b) => a.at - b.at);

    let exitAt = Infinity;
    for (const mark of marks) {
      if (stopped) break;
      if (mark.at > exitAt) {
        step.stoppedEarly = marks.some((m) => m.event?.target && m.at > exitAt && isActive(view, id, m.event.path));
        break;
      }
      if (mark.branch) {
        if (!isActive(view, id, mark.branch.path)) continue;
        const arm = mark.branch.arms[choiceOf(view, id, mark.index)];
        if (arm?.exits) exitAt = Math.min(exitAt, mark.branch.end);
        continue;
      }
      const { event, index } = mark;
      if (!isActive(view, id, event.path)) continue;
      step.events.push(index);
      if (!event.target) continue;
      if (event.type === 'throw') {
        visit(event.target, { from: id, event: index });
        stopped = true;
        break;
      }
      if (!onStack.has(event.target)) visit(event.target, { from: id, event: index });
    }
    onStack.delete(id);
  };

  visit(graph.entry, null);
  return steps;
}

/** Line numbers to light up or grey out, for the branches this path passes. */
function armMarks(view, fnId) {
  const fn = view.graph.functions[fnId];
  const marks = new Map();
  fn.branches.forEach((branch, b) => {
    if (!isActive(view, fnId, branch.path)) return;
    const chosen = choiceOf(view, fnId, b);
    branch.arms.forEach((arm, a) => {
      if (!arm.line) return;
      for (let n = arm.line; n <= arm.endLine; n += 1) marks.set(n, a === chosen ? 'on' : 'off');
    });
  });
  return marks;
}

/* ---------- pieces of markup ---------- */

function nodeInner(node) {
  return `<span class="fnode-kind">${KIND[node.kind] ?? node.kind}${node.changed ? '<i>changed</i>' : ''}</span>
    <span class="fnode-name" title="${esc(node.name)}">${esc(node.name)}</span>
    <span class="fnode-sub" title="${esc(node.sub)}">${esc(node.sub)}</span>`;
}

function codeBlock(fn, marks, nowLine) {
  const changed = new Set(fn.changedLines);
  const rows = fn.code.map((text, i) => {
    const n = fn.line + i;
    const classes = ['cl', marks?.get(n), n === nowLine ? 'now' : '', changed.has(n) ? 'changed' : '']
      .filter(Boolean)
      .join(' ');
    return `<span class="${classes}"><span class="n">${n}</span><span class="g">${changed.has(n) ? '+' : ''}</span>${
      esc(text) || ' '
    }</span>`;
  });
  return `<pre class="code">${rows.join('')}</pre>`;
}

function question(branch) {
  switch (branch.kind) {
    case 'switch':
      return `What is <code>${esc(branch.subject)}</code>?`;
    case 'if-chain':
      return 'Which one is true?';
    case 'try':
      return 'Does it fail?';
    default:
      return `Is <code>${esc(branch.subject)}</code> true?`;
  }
}

function kindLine(node) {
  return `<div class="fp-kind">${KIND[node.kind] ?? node.kind}${
    node.changed ? ' <span class="fp-changed">changed here</span>' : ''
  }</div>`;
}

/* ---------- the explore panel ---------- */

function explorePanel(view) {
  const { graph } = view;
  const node = graph.nodeById.get(view.selected);
  const head = `${kindLine(node)}<h3 class="fp-name">${esc(node.name)}</h3>
    <div class="fp-where">${esc(node.sub)}${node.line ? `, line ${node.line}` : ''}</div>`;

  if (node.kind === 'external') {
    const callers = graph.edges.filter((e) => e.to === node.id).map((e) => graph.nodeById.get(e.from));
    return `${head}
      <p class="fp-text">This call leaves your project and goes into <strong>${esc(node.sub)}</strong>.
      Twomind does not read inside it.</p>
      <div class="fp-section"><div class="label">Called from</div>
        <ul class="fp-list">${callers
          .map((c) => `<li><button class="linkish" data-goto="${esc(c.id)}">${esc(c.name)}</button></li>`)
          .join('')}</ul>
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
    <div class="fp-actions">
      <button class="btn primary" data-simulate="${esc(node.id)}">Simulate from here</button>
      ${node.id !== graph.entry ? `<button class="btn" data-open="${esc(node.id)}">Open its own flow</button>` : ''}
    </div>
    <div class="fp-section">
      <div class="label">What an AI said about this file</div>
      ${why ? `<div class="say ai"><div class="say-body small">${esc(why)}</div></div>` : '<div class="fp-none">Nothing yet.</div>'}
    </div>
    ${
      calls.length
        ? `<div class="fp-section"><div class="label">It calls, in order</div><ol class="fp-list">${calls
            .map(
              (e) => `<li><span class="verb">${e.type === 'throw' ? 'throws' : 'calls'}</span>
                <button class="linkish" data-goto="${esc(e.target)}">${esc(graph.nodeById.get(e.target).name)}</button>
                ${e.label ? `<span class="cond">${esc(e.label)}</span>` : ''}</li>`
            )
            .join('')}</ol></div>`
        : ''
    }
    ${
      fn.calledBy.length
        ? `<div class="fp-section"><div class="label">Called from</div><ul class="fp-list">${fn.calledBy
            .map((c) => `<li><button class="linkish" data-open="${esc(c.id)}">${esc(c.name)}</button></li>`)
            .join('')}</ul></div>`
        : ''
    }
    <div class="fp-section"><div class="label">The code</div>${codeBlock(fn, null, null)}</div>`;
}

/* ---------- the simulate panel ---------- */

function choices(view, fnId) {
  const fn = view.graph.functions[fnId];
  const groups = fn.branches
    .map((branch, index) => ({ branch, index }))
    .filter(({ branch }) => branch.shown && isActive(view, fnId, branch.path));
  if (!groups.length) return '';

  return `<div class="fp-section"><div class="label">You choose</div>${groups
    .map(({ branch, index }) => {
      const chosen = choiceOf(view, fnId, index);
      return `<div class="choice">
        <div class="choice-q">${question(branch)} <span class="muted">line ${branch.line}</span></div>
        <div class="seg wrap">${branch.arms
          .map(
            (arm, a) => `<button class="${a === chosen ? 'on' : ''}" data-choice="${index}:${a}">${esc(
              branch.kind === 'switch' ? arm.label.replace(/case /g, '') : arm.label
            )}</button>`
          )
          .join('')}</div>
      </div>`;
    })
    .join('')}</div>`;
}

function inputs(view, fnId) {
  const fn = view.graph.functions[fnId];
  const known = new Map();
  fn.branches.forEach((branch, b) => {
    if (branch.kind !== 'switch' || !isActive(view, fnId, branch.path)) return;
    const arm = branch.arms[choiceOf(view, fnId, b)];
    if (arm?.value !== undefined) known.set(branch.subject, arm.value);
  });
  if (!fn.params.length && !known.size) return '';

  const rows = fn.params.map(
    (p) => `<dt>${esc(p)}</dt><dd>${known.has(p) ? esc(known.get(p)) : '<span class="muted">any value</span>'}</dd>`
  );
  for (const [subject, value] of known) {
    if (!fn.params.includes(subject)) rows.push(`<dt>${esc(subject)}</dt><dd>${esc(value)}</dd>`);
  }
  return `<div class="fp-section"><div class="label">Inputs</div><dl class="inputs">${rows.join('')}</dl></div>`;
}

function happens(view, step, next) {
  const { graph } = view;
  const fn = graph.functions[step.id];
  const items = step.events
    .map((i) => ({ event: fn.events[i], index: i }))
    .filter(({ event }) => event.target)
    .map(({ event, index }) => {
      const leads = next?.via?.from === step.id && next.via.event === index;
      return `<li class="${leads ? 'now' : ''}"><span class="verb">${event.type === 'throw' ? 'throws' : 'calls'}</span>
        ${esc(graph.nodeById.get(event.target).name)}
        ${event.label ? `<span class="cond">${esc(event.label)}</span>` : ''}</li>`;
    });
  if (step.stoppedEarly) {
    items.push(`<li class="stop">it returns here, so the rest of this function does not run</li>`);
  }
  if (!items.length) return '';
  return `<div class="fp-section"><div class="label">What happens here</div><ol class="fp-list">${items.join('')}</ol></div>`;
}

function simPanel(view) {
  const { graph, steps } = view;
  const step = steps[view.stepIndex];
  const node = graph.nodeById.get(step.id);
  const fn = graph.functions[step.id];
  const next = steps[view.stepIndex + 1];

  const head = `<div class="sim-top">
      <span class="label">Step ${view.stepIndex + 1} of ${steps.length}</span>
      <span class="label step-of">${esc(KIND[node.kind] ?? node.kind)}</span>
    </div>
    <h3 class="fp-name">${esc(node.name)}</h3>
    <div class="fp-where">${esc(node.sub)}${node.changed ? ' · changed here' : ''}</div>
    <div class="sim-nav">
      <button class="btn" data-sim="prev" ${view.stepIndex === 0 ? 'disabled' : ''}>Back</button>
      <button class="btn primary" data-sim="next" ${next ? '' : 'disabled'}>Next</button>
      <span class="sim-next">${next ? `then <strong>${esc(graph.nodeById.get(next.id).name)}</strong>` : 'this is the end'}</span>
    </div>`;

  if (node.kind === 'error') {
    return `${head}<p class="fp-text alert">The flow stops here with an error. Nothing after it runs, unless a caller catches it.</p>`;
  }
  if (node.kind === 'external') {
    return `${head}<p class="fp-text">The code calls <strong>${esc(node.sub)}</strong>, outside your project.
      When that is done it comes back and carries on.</p>`;
  }
  if (node.more) {
    return `${head}<p class="fp-text">This one calls more code than this flow shows.</p>
      <div class="fp-actions"><button class="btn" data-simulate="${esc(node.id)}">Simulate from here</button></div>
      <div class="fp-section"><div class="label">The code</div>${codeBlock(fn, null, null)}</div>`;
  }

  const nowLine = next?.via?.from === step.id ? fn.events[next.via.event]?.line : null;
  return `${head}
    ${choices(view, step.id)}
    ${inputs(view, step.id)}
    ${happens(view, step, next)}
    <div class="fp-section"><div class="label">The code</div>${codeBlock(fn, armMarks(view, step.id), nowLine)}</div>
    <p class="fp-none" style="margin-top:14px">This follows the code as written. Nothing is run.</p>`;
}

/* ---------- mounting ---------- */

/**
 * Draw a flow into `host`. Options:
 *   mode     'explore' (default) or 'simulate'
 *   kicker   small label before the title, like "Flow" or "Part 2"
 *   title    big title; the first box's name when missing
 *   starts   [{ id, name }] other places this flow can start (shows a picker)
 *   onOpen   (id, mode) start the flow at another function
 *   onBack / onClose  show that button
 */
export function mountFlow(host, graph, options = {}) {
  mounts += 1;
  const uid = mounts;
  graph.nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeByEvent = new Map();
  graph.edges.forEach((edge, i) => edge.events.forEach((event) => edgeByEvent.set(`${edge.from}#${event}`, i)));

  const placed = layout(graph);
  const anchor = anchors(graph);
  const view = {
    graph,
    mode: options.mode === 'simulate' ? 'simulate' : 'explore',
    selected: graph.entry,
    choices: new Map(),
    steps: [],
    stepIndex: 0,
    pos: placed.pos,
    t: { x: 0, y: 0, k: 1 },
  };

  const entry = graph.nodeById.get(graph.entry);
  const starts = options.starts ?? [];
  host.innerHTML = `<div class="flow">
    <div class="flow-bar">
      <div class="flow-title">
        ${options.onBack ? '<button class="btn" data-back>Back</button>' : ''}
        <span class="label">${esc(options.kicker ?? 'Flow')}</span>
        <span class="flow-name">${esc(options.title ?? entry.name)}</span>
        ${
          starts.length > 1
            ? `<label class="flow-start"><span class="label">starts at</span><select data-start>${starts
                .map((s) => `<option value="${esc(s.id)}" ${s.id === graph.entry ? 'selected' : ''}>${esc(s.name)}</option>`)
                .join('')}</select></label>`
            : options.title
              ? `<span class="flow-entry">${esc(entry.name)}</span>`
              : ''
        }
      </div>
      <div class="flow-tools">
        <div class="seg">
          <button data-mode="explore">Explore</button>
          <button data-mode="simulate">Simulate</button>
        </div>
        <div class="seg zoomers">
          <button data-zoom="out" aria-label="Zoom out">&minus;</button>
          <button data-zoom="fit">Fit</button>
          <button data-zoom="in" aria-label="Zoom in">+</button>
        </div>
        ${options.onClose ? '<button class="btn" data-close>Close</button>' : ''}
      </div>
    </div>
    <div class="flow-body">
      <div class="flow-canvas"></div>
      <aside class="flow-panel"></aside>
    </div>
  </div>`;

  const root = host.querySelector('.flow');
  const canvas = root.querySelector('.flow-canvas');
  const panel = root.querySelector('.flow-panel');

  /* ---- explore drawing ---- */

  const worldHtml = () => `<svg class="flow-edges" width="${placed.width + BOX.w}" height="${placed.height + BOX.h * 2}">
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
        const text = [edge.order > 1 || graph.edges.filter((e) => e.from === edge.from).length > 1 ? edge.order : '', short + extra]
          .filter(Boolean)
          .join(' · ');
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
          ${node.more ? '<span class="fnode-more" title="It calls more. Open its own flow to see.">+</span>' : ''}
        </button>`
      )
      .join('')}`;

  const placeAll = () => {
    for (const el of canvas.querySelectorAll('.fnode')) {
      const p = view.pos.get(el.dataset.id);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    }
    drawEdges();
  };

  const drawEdges = () => {
    const lit = new Set();
    for (const edge of graph.edges) {
      if (edge.from === view.selected || edge.to === view.selected) lit.add(graph.edges.indexOf(edge));
    }
    for (const path of canvas.querySelectorAll('path.fedge')) {
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
      const label = canvas.querySelector(`.flabel[data-edge="${i}"]`);
      if (label) {
        label.style.left = `${mid.x}px`;
        label.style.top = `${mid.y}px`;
        label.classList.toggle('lit', lit.has(i));
      }
    }
    for (const el of canvas.querySelectorAll('.fnode')) {
      el.classList.toggle('current', el.dataset.id === view.selected);
    }
  };

  const apply = () => {
    const world = canvas.querySelector('.flow-world');
    if (world) world.style.transform = `translate(${view.t.x}px, ${view.t.y}px) scale(${view.t.k})`;
  };

  const fit = () => {
    const rect = canvas.getBoundingClientRect();
    const pad = 44;
    // Never shrink past the point where the boxes stop being readable: a flow
    // too wide for the window scrolls instead.
    const k = Math.min(1.05, Math.max(0.78, Math.min((rect.width - pad * 2) / placed.width, (rect.height - pad * 2) / placed.height)));
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

  /* ---- simulate drawing ---- */

  const stripHtml = () => {
    const parts = view.steps.map((step, i) => {
      const node = graph.nodeById.get(step.id);
      const box = `<button class="fnode k-${node.kind}${i === view.stepIndex ? ' current' : ''}${
        i < view.stepIndex ? ' past' : ''
      }" data-step="${i}">
        <span class="no">${i + 1}</span>
        ${nodeInner(node)}
      </button>`;
      const next = view.steps[i + 1];
      if (!next) return box;
      const fn = graph.functions[next.via.from];
      const label = fn?.events[next.via.event]?.label ?? '';
      return `${box}<span class="strip-link">
        <span class="cap">${esc(label)}</span>
        <span class="line"></span>
      </span>`;
    });

    const last = graph.nodeById.get(view.steps[view.steps.length - 1].id);
    const end = last.kind === 'error' ? 'it stops with an error' : 'nothing more to follow';
    return `<div class="strip"><div class="strip-inner">${parts.join('')}<span class="strip-end">${end}</span></div></div>`;
  };

  /* ---- render ---- */

  const render = () => {
    root.classList.toggle('sim', view.mode === 'simulate');
    for (const button of root.querySelectorAll('[data-mode]')) {
      button.classList.toggle('on', button.dataset.mode === view.mode);
    }

    if (view.mode === 'simulate') {
      view.steps = simulate(view);
      view.stepIndex = Math.min(view.stepIndex, view.steps.length - 1);
      canvas.className = 'flow-canvas';
      canvas.innerHTML = stripHtml();
      panel.innerHTML = simPanel(view);
      const current = canvas.querySelector('.fnode.current');
      current?.scrollIntoView({ block: 'nearest', inline: 'center' });
    } else {
      canvas.className = 'flow-canvas pan';
      canvas.innerHTML = `<div class="flow-world">${worldHtml()}</div>
        ${graph.truncated ? '<div class="flow-note">A big flow: some calls are not drawn. Open a box\'s own flow to see more.</div>' : ''}
        <div class="flow-hint">drag a box to move it</div>`;
      placeAll();
      panel.innerHTML = explorePanel(view);
      apply();
    }

    const now = panel.querySelector('.cl.now') ?? panel.querySelector('.cl.on');
    const code = now?.closest('.code');
    if (now && code) code.scrollTop = Math.max(0, now.offsetTop - code.offsetTop - 60);
  };

  const goToStep = (index) => {
    view.stepIndex = Math.max(0, Math.min(index, view.steps.length - 1));
    render();
    panel.scrollTop = 0;
  };

  /* ---- events ---- */

  root.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const { dataset } = target;

    if (dataset.mode) {
      view.mode = dataset.mode;
      if (dataset.mode === 'explore') requestAnimationFrame(fit);
      render();
    } else if (dataset.zoom) {
      const rect = canvas.getBoundingClientRect();
      if (dataset.zoom === 'fit') fit();
      else zoomAt(rect.width / 2, rect.height / 2, dataset.zoom === 'in' ? 1.2 : 1 / 1.2);
    } else if ('close' in dataset) {
      options.onClose?.();
    } else if ('back' in dataset) {
      options.onBack?.();
    } else if (dataset.step !== undefined) {
      goToStep(Number(dataset.step));
    } else if (dataset.id !== undefined) {
      if (dragged) return;
      view.selected = dataset.id;
      panel.innerHTML = explorePanel(view);
      panel.scrollTop = 0;
      drawEdges();
    } else if (dataset.goto) {
      view.selected = dataset.goto;
      view.mode = 'explore';
      render();
      panel.scrollTop = 0;
    } else if (dataset.open) {
      options.onOpen?.(dataset.open, 'explore');
    } else if (dataset.simulate) {
      if (dataset.simulate === graph.entry) {
        view.mode = 'simulate';
        view.stepIndex = 0;
        render();
      } else {
        options.onOpen?.(dataset.simulate, 'simulate');
      }
    } else if (dataset.choice) {
      const [branch, arm] = dataset.choice.split(':').map(Number);
      view.choices.set(choiceKey(view.steps[view.stepIndex].id, branch), arm);
      render();
    } else if (dataset.sim) {
      goToStep(view.stepIndex + (dataset.sim === 'next' ? 1 : -1));
    }
  });

  root.querySelector('[data-start]')?.addEventListener('change', (event) => {
    options.onOpen?.(event.target.value, view.mode);
  });

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

  canvas.addEventListener('pointerdown', (event) => {
    if (view.mode !== 'explore' || event.button !== 0) return;
    const node = event.target.closest('.fnode');
    dragged = false;
    drag = node
      ? { node, id: node.dataset.id, x: event.clientX, y: event.clientY, start: { ...view.pos.get(node.dataset.id) } }
      : { x: event.clientX, y: event.clientY, tx: view.t.x, ty: view.t.y };
    canvas.setPointerCapture(event.pointerId);
    if (!node) canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;

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
    drag = null;
    canvas.classList.remove('dragging');
    // Let the click that follows a real drag pass, then allow clicks again.
    setTimeout(() => {
      dragged = false;
    }, 0);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (event) => {
      if (view.mode !== 'explore') return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false }
  );

  const onKey = (event) => {
    if (view.mode !== 'simulate' || event.target.closest?.('input, select, textarea')) return;
    if (event.key === 'ArrowRight') goToStep(view.stepIndex + 1);
    if (event.key === 'ArrowLeft') goToStep(view.stepIndex - 1);
  };
  document.addEventListener('keydown', onKey);

  render();
  if (view.mode === 'explore') requestAnimationFrame(fit);

  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
      host.innerHTML = '';
    },
  };
}

/* ---------- opening a flow ---------- */

export function flowUrl(id, { story, depth } = {}) {
  const params = new URLSearchParams({ id });
  if (story) params.set('story', story);
  if (depth) params.set('depth', String(depth));
  return `/api/flow/graph?${params}`;
}

/** A flow over the whole page, for one part of a change. Esc or Close ends it. */
export function openFlowOverlay({ kicker, title, starts, storyId, mode = 'simulate' }) {
  const layer = document.createElement('div');
  layer.className = 'flow-overlay';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', title ?? 'Flow');
  document.body.append(layer);
  document.body.classList.add('overlay-open');

  let mounted = null;
  const close = () => {
    mounted?.destroy();
    layer.remove();
    document.body.classList.remove('overlay-open');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  const open = async (id, openMode) => {
    mounted?.destroy();
    mounted = null;
    layer.innerHTML = '<div class="empty">Reading the code…</div>';
    try {
      const graph = await getJson(flowUrl(id, { story: storyId }));
      mounted = mountFlow(layer, graph, { mode: openMode, kicker, title, starts, onOpen: open, onClose: close });
    } catch (error) {
      layer.innerHTML = `<div class="empty">
        <h2>That flow did not load</h2>
        <p class="mono">${esc(error.message || error)}</p>
        <button class="btn" data-close>Close</button>
      </div>`;
      layer.querySelector('[data-close]').addEventListener('click', close);
    }
  };

  open(starts[0].id, mode);
  return { close };
}

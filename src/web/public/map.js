import { ago, esc, getJson, onLeave, plural, setScreen } from './ui.js';
import { flowUrl, mountFlow } from './flow.js';

/* The code map.

   Two things on this screen, and they come from different places:

     structure  what calls what, and under which condition. Read from the
                code with a parser, so it is a fact. It can miss calls that
                are only decided when the program runs; it never invents one.
     meaning    the sentences. Every one was written by an AI in a story
                about that exact file. If no AI ever explained a file, the
                screen says so instead of guessing.

   The home screen is small clickable tiles, not long rows of text. Pick one
   to see its flow: boxes for what it calls, and a panel with its code. */

let searchTimer = null;

const fnLabel = (fn) => fn.label;

/** The last two path parts, so a tile shows enough to place it without the whole path. */
function shortPath(file) {
  const parts = file.split('/');
  return parts.length <= 2 ? file : `…/${parts.slice(-2).join('/')}`;
}

function tile(fn) {
  const kind = fn.route ? 'Route' : fn.kind === 'method' ? 'Method' : 'Function';
  return `<button class="tile" data-flow="${esc(fn.id)}" title="${esc(fn.file)}:${fn.line}">
    <span class="tile-kind">${esc(kind)}</span>
    <span class="tile-name">${esc(fnLabel(fn))}</span>
    <span class="tile-file">${esc(shortPath(fn.file))}</span>
  </button>`;
}

function nameTile(hit) {
  return `<button class="tile" data-name="${esc(hit.name)}" title="${esc(hit.file)}">
    <span class="tile-kind">${esc(hit.kind)}</span>
    <span class="tile-name">${esc(hit.name)}</span>
    <span class="tile-file">${esc(shortPath(hit.file))}</span>
  </button>`;
}

/** A long grid is a wall too. Show the first row or two and keep the rest one click away. */
function cappedGrid(tiles, cap, what) {
  if (!tiles.length) return '';
  if (tiles.length <= cap + 4) return `<div class="tile-grid">${tiles.join('')}</div>`;
  return `<div class="tile-grid">${tiles.slice(0, cap).join('')}</div>
    <div class="tile-grid rows-rest">${tiles.slice(cap).join('')}</div>
    <button class="rows-more" data-rows-more>Show the other ${tiles.length - cap} ${what}</button>`;
}

export async function showMap(onOpenStory) {
  setScreen('<div class="empty">Reading the code…</div>');

  const [flow, map] = await Promise.all([getJson('/api/flow'), getJson('/api/map')]);

  const recent = flow.recent.length
    ? `<div class="block">
        <div class="label">Changed recently</div>
        ${flow.recent
          .map(
            (story) => `<div class="recent">
              <button class="recent-story" data-story="${esc(story.storyId)}">${esc(story.title)}</button>
              <span class="when">${ago(story.at)}</span>
              <div class="tile-grid small">${story.functions.map(tile).join('')}</div>
            </div>`
          )
          .join('')}
      </div>`
    : '';

  const routes = flow.routes.length
    ? `<div class="block"><div class="label">Routes (${flow.routes.length})</div>${cappedGrid(
        flow.routes.map(tile),
        12,
        'routes'
      )}</div>`
    : '';

  const others = flow.others.length
    ? `<div class="block"><div class="label">Where the code starts</div>
        <p class="block-hint">Nothing else in the project calls these, but they lead somewhere.</p>
        ${cappedGrid(flow.others.map(tile), 8, 'more')}</div>`
    : '';

  const noFlows = !flow.functionCount
    ? `<div class="block"><p class="fp-none">Twomind mapped the project files and names, but it did not find a function body it could safely draw as a flow.</p></div>`
    : '';

  const busiest = map.busiest.length
    ? `<div class="block">
        <div class="label">Files that most others use</div>
        ${map.busiest
          .map(
            (entry) => `<div class="file-row">
              <span class="path mono">${esc(shortPath(entry.file))}</span>
              ${entry.latestWhy ? `<span class="why">${esc(entry.latestWhy)}</span>` : '<span class="why none">no AI has explained this file yet</span>'}
              <span class="c">${plural(entry.usedBy, 'file')} import it</span>
            </div>`
          )
          .join('')}
      </div>`
    : '';

  setScreen(`<div class="page wide">
    <div class="head">
      <h1 class="title">Code map</h1>
      <div class="head-meta">
        <span>${plural(map.fileCount, 'source file')}</span>
        <span>${plural(flow.functionCount, 'function')}</span>
        <span>read ${ago(flow.builtAt)}</span>
        ${flow.unreadable.length ? `<span title="${esc(flow.unreadable.join('\n'))}">${plural(flow.unreadable.length, 'file')} could not be read</span>` : ''}
      </div>
    </div>

    <div class="search">
      <input id="map-q" type="search" placeholder="search a function, route, class or file" autocomplete="off" spellcheck="false" />
      <span class="hint" id="map-hint">type to search</span>
    </div>

    <div id="map-results"></div>

    <div id="map-home">
      ${noFlows}
      ${recent}
      ${routes}
      ${others}
      ${busiest}
    </div>

    <div class="footnote">
      Flows are read from your code with a parser. A call that is only decided while the program runs is
      left out, never guessed. The sentences come from the stories your AI wrote.
    </div>
  </div>`);

  const input = document.querySelector('#map-q');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value, onOpenStory), 160);
  });
  wireHits(document.querySelector('#screen'), onOpenStory);
  input.focus();
}

function wireHits(scope, onOpenStory) {
  for (const button of scope.querySelectorAll('[data-rows-more]')) {
    button.addEventListener('click', () => {
      button.previousElementSibling.classList.remove('rows-rest');
      button.remove();
    });
  }
  for (const button of scope.querySelectorAll('[data-flow]')) {
    button.addEventListener('click', () => showFunction(button.dataset.flow, onOpenStory));
  }
  for (const button of scope.querySelectorAll('[data-story]')) {
    button.addEventListener('click', () => onOpenStory(button.dataset.story));
  }
  for (const button of scope.querySelectorAll('[data-name]')) {
    button.addEventListener('click', () => showSymbol(button.dataset.name, onOpenStory));
  }
}

async function runSearch(query, onOpenStory) {
  const results = document.querySelector('#map-results');
  const home = document.querySelector('#map-home');
  const hint = document.querySelector('#map-hint');
  if (!results) return;

  if (!query.trim()) {
    results.innerHTML = '';
    home.style.display = '';
    hint.textContent = 'type to search';
    return;
  }

  home.style.display = 'none';
  const q = encodeURIComponent(query);
  const [flows, names] = await Promise.all([getJson(`/api/flow/search?q=${q}`), getJson(`/api/map/search?q=${q}`)]);
  const total = flows.results.length + names.results.length;
  hint.textContent = total ? plural(total, 'match') : 'nothing found';

  results.innerHTML = `<div class="tile-grid">${flows.results.map(tile).join('') + names.results.map(nameTile).join('')}</div>`;
  wireHits(results, onOpenStory);
}

/** One function's flow, embedded in the page: boxes on the left, a detail panel on the right. */
export async function showFunction(id, onOpenStory) {
  setScreen('<div class="empty">Reading the code…</div>');

  let graph;
  try {
    graph = await getJson(flowUrl(id));
  } catch (error) {
    setScreen(`<div class="empty">
      <h2>That did not load</h2>
      <p>This function may have moved or been removed since the map was last read.</p>
      <p class="mono muted" style="margin-top:10px">${esc(error.message || error)}</p>
      <button class="btn" id="map-back" style="margin-top:16px">Back to the map</button>
    </div>`);
    document.querySelector('#map-back').addEventListener('click', () => showMap(onOpenStory));
    return;
  }

  const entry = graph.nodes.find((n) => n.id === graph.entry);
  // This screen gets the full window width, not the usual reading width: a
  // graph needs the room a column of text does not.
  setScreen(`<div class="page flow">
    <div class="head">
      <button class="btn" id="map-back">Back to the map</button>
      <div class="sym-name">${esc(entry.name)}</div>
      <div class="sym-where">${esc(entry.sub)}</div>
    </div>

    <div class="flowbox">
      <div class="flowbox-canvas"></div>
      <div class="flowbox-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the code panel" tabindex="0"></div>
      <aside class="flowbox-panel"></aside>
    </div>

    <div class="footnote">
      Boxes are what this calls, read with a parser. A dashed box leaves your project. Click a box to
      open its code here, on the right; drag a box if two arrows overlap.
    </div>
  </div>`);

  document.querySelector('#map-back').addEventListener('click', () => showMap(onOpenStory));
  const stopResize = setupPanelResize(document.querySelector('.flowbox'));
  const flow = mountFlow(document.querySelector('.flowbox-canvas'), document.querySelector('.flowbox-panel'), graph, {
    onOpen: (nextId) => showFunction(nextId, onOpenStory),
  });
  onLeave(() => {
    flow.destroy();
    stopResize();
  });
}

const PANEL_WIDTH_KEY = 'twomind-flow-panel-width';
const PANEL_MIN = 320;
const PANEL_DEFAULT = 800; // double the old fixed 400px, at the owner's request

/**
 * The drag handle between the flow's picture and its code. The width is
 * remembered per browser (not per function), so it starts at double the old
 * default and then stays wherever you last left it.
 */
function setupPanelResize(box) {
  const canvas = box.querySelector('.flowbox-canvas');
  const resizer = box.querySelector('.flowbox-resizer');
  const panel = box.querySelector('.flowbox-panel');
  let width = Number(localStorage.getItem(PANEL_WIDTH_KEY)) || PANEL_DEFAULT;

  const apply = () => {
    // Below the mobile breakpoint the panel stacks under the canvas, full width;
    // a leftover inline width would fight that layout, so this leaves it alone.
    if (window.innerWidth <= 1000) {
      panel.style.flexBasis = '';
      return;
    }
    // The canvas keeps at least this much room: at 360px, most of the picture
    // was falling off the edge, which is a second, quieter way for a box to
    // become "unclickable" (you are really clicking empty page next to it).
    const max = Math.max(PANEL_MIN, box.getBoundingClientRect().width - 480);
    width = Math.min(Math.max(width, PANEL_MIN), max);
    panel.style.flexBasis = `${width}px`;
  };
  apply();

  const nudge = (delta) => {
    width += delta;
    apply();
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    } catch {
      /* private mode: the width still works for this session */
    }
  };

  let dragging = false;
  const onMove = (event) => {
    if (!dragging) return;
    width = box.getBoundingClientRect().right - event.clientX;
    apply();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('active');
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    } catch {
      /* private mode: the width still works for this session */
    }
  };

  resizer.addEventListener('pointerdown', (event) => {
    dragging = true;
    resizer.classList.add('active');
    try {
      resizer.setPointerCapture(event.pointerId);
    } catch {
      /* the drag still works without capturing the pointer */
    }
    event.preventDefault();
  });
  resizer.addEventListener('pointermove', onMove);
  resizer.addEventListener('pointerup', onUp);
  resizer.addEventListener('pointercancel', onUp);
  resizer.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') nudge(24);
    else if (event.key === 'ArrowRight') nudge(-24);
    else return;
    event.preventDefault();
  });
  window.addEventListener('resize', apply);

  return () => window.removeEventListener('resize', apply);
}

/** A name with no flow of its own (a class, a type, or code in another language). */
export async function showSymbol(name, onOpenStory) {
  setScreen('<div class="empty">Looking it up…</div>');

  let data;
  try {
    data = await getJson(`/api/map/symbol?name=${encodeURIComponent(name)}`);
  } catch {
    setScreen(`<div class="empty"><h2>Not found</h2><p>No name like "${esc(name)}" is defined in this project.</p></div>`);
    return;
  }

  const { symbol, usedBy, uses, history } = data;

  const usedByBlock = usedBy.length
    ? usedBy
        .map(
          (entry) => `<div class="file-row">
            <span class="path mono">${esc(shortPath(entry.file))}</span>
            ${entry.latestWhy ? `<span class="why">${esc(entry.latestWhy)}</span>` : '<span class="why none">no AI has explained this file yet</span>'}
          </div>`
        )
        .join('')
    : '<p class="fp-none">Nothing else in the project mentions it.</p>';

  const historyBlock = history.entries.length
    ? history.entries
        .map(
          (entry) => `<button class="card" data-id="${esc(entry.storyId)}">
            <div class="t">${esc(entry.title)}</div>
            ${entry.why ? `<div class="w">${esc(entry.why)}</div>` : ''}
            <div class="when">${ago(entry.at)}, the AI called it "${esc(entry.level)}"</div>
          </button>`
        )
        .join('')
    : '<p class="fp-none">No recorded change has touched this file yet.</p>';

  setScreen(`<div class="page wide">
    <div class="head">
      <button class="btn" id="map-back">Back to the map</button>
      <div class="sym-name">${esc(symbol.name)}</div>
      <div class="sym-where">${esc(symbol.kind)} in ${esc(symbol.file)}, line ${symbol.line}${symbol.exported ? ', exported' : ''}</div>
    </div>

    <div class="block">
      <div class="label">What the AIs said about this file</div>
      ${historyBlock}
    </div>

    <div class="block">
      <div class="label">Named in ${plural(usedBy.length, 'other file')}</div>
      ${usedByBlock}
    </div>

    ${
      uses.length
        ? `<div class="block">
            <div class="label">Names this file can reach</div>
            <p class="mono muted">${uses.map(esc).join(', ')}</p>
          </div>`
        : ''
    }

    <div class="footnote">
      "Named in" is a text match on the name, read from the source. It is a strong hint, not a compiler.
    </div>
  </div>`);

  document.querySelector('#map-back').addEventListener('click', () => showMap(onOpenStory));
  for (const row of document.querySelectorAll('.card[data-id]')) {
    row.addEventListener('click', () => onOpenStory(row.dataset.id));
  }
}

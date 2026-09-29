import { ago, esc, getJson, onLeave, plural, setScreen } from './ui.js';
import { flowUrl, mountFlow } from './flow.js';

/* The code map.

   Two things on this screen, and they come from different places:

     structure  what calls what, and under which condition. Read from the
                code with a parser, so it is a fact. It can miss calls that
                are only decided when the program runs; it never invents one.
     meaning    the sentences. Every one was written by an agent in a story
                about that exact file. If no agent ever explained a file, the
                screen says so instead of guessing.

   Pick a function to open its flow: boxes for what it calls, lines labelled
   with the condition, and a simulation that walks one path step by step. */

let searchTimer = null;

function whyLine(why) {
  return why
    ? `<div class="why">${esc(why)}</div>`
    : `<div class="why none">no agent has explained this file yet</div>`;
}

const fnLabel = (fn) => fn.label;

/** A long list is a wall. Show the first few and keep the rest one click away. */
function capped(rows, cap = 10, what = 'more') {
  if (rows.length <= cap + 3) return rows.join('');
  return `${rows.slice(0, cap).join('')}
    <div class="rows-rest">${rows.slice(cap).join('')}</div>
    <button class="rows-more" data-rows-more>Show the other ${rows.length - cap} ${what}</button>`;
}

function fnRow(fn) {
  return `<button class="hit" data-flow="${esc(fn.id)}">
    <span><span class="name">${esc(fnLabel(fn))}</span> <span class="where">${esc(fn.file)}:${fn.line}</span></span>
    <span class="count">${fn.calledBy ? `called from ${plural(fn.calledBy, 'place')}` : `makes ${plural(fn.calls, 'call')}`}</span>
  </button>`;
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
              <div class="chips">${story.functions
                .map((fn) => `<button class="chip" data-flow="${esc(fn.id)}">${esc(fnLabel(fn))}</button>`)
                .join('')}</div>
            </div>`
          )
          .join('')}
      </div>`
    : '';

  const routes = flow.routes.length
    ? `<div class="block rows"><div class="label">Routes (${flow.routes.length})</div>${capped(
        flow.routes.map(fnRow),
        10,
        'routes'
      )}</div>`
    : '';

  const others = flow.others.length
    ? `<div class="block rows"><div class="label">Where the code starts</div>
        <p class="block-hint">Functions that nothing else in the project calls, but that lead somewhere.</p>
        ${capped(flow.others.map(fnRow), 8, 'places')}</div>`
    : '';

  const noFlows = !flow.functionCount
    ? `<div class="block"><p class="fp-none">Flows work for JavaScript and TypeScript. This project has none of those files,
        so only the name search below works here.</p></div>`
    : '';

  setScreen(`<div class="page wide">
    <div class="head">
      <h1 class="title">Code map</h1>
      <div class="head-meta">
        <span>${plural(flow.fileCount, 'JS/TS file')}</span>
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
      <div class="block">
        <div class="label">Files that most others use</div>
        ${map.busiest
          .map(
            (entry) => `<div class="file-row">
              <span class="path">${esc(entry.file)}</span>
              ${whyLine(entry.latestWhy)}
              <span class="c">${plural(entry.usedBy, 'file')} import it, ${plural(entry.defines, 'name')} defined</span>
            </div>`
          )
          .join('')}
      </div>
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
    button.addEventListener('click', () => button.closest('.rows').classList.add('open'));
  }
  for (const button of scope.querySelectorAll('[data-flow]')) {
    button.addEventListener('click', () => showFlow(button.dataset.flow, 'explore', onOpenStory));
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

  results.innerHTML =
    flows.results.map(fnRow).join('') +
    names.results
      .map(
        (hit) => `<button class="hit" data-name="${esc(hit.name)}">
          <span><span class="name">${esc(hit.name)}</span> <span class="where">${esc(hit.kind)} in ${esc(hit.file)}</span></span>
          <span class="count">${hit.usedByCount ? `named in ${plural(hit.usedByCount, 'file')}` : 'not named elsewhere'}</span>
        </button>`
      )
      .join('');
  wireHits(results, onOpenStory);
}

/** One function's flow, filling the whole screen. */
export async function showFlow(id, mode, onOpenStory) {
  setScreen('<div class="empty">Reading the code…</div>');
  const graph = await getJson(flowUrl(id));

  // A flow needs the width, so the list of changes steps aside while it is open.
  const screen = document.querySelector('#screen');
  const layout = document.querySelector('.layout');
  screen.classList.add('full');
  layout.classList.add('wide');
  const flow = mountFlow(screen, graph, {
    mode,
    kicker: 'Flow',
    onBack: () => showMap(onOpenStory),
    onOpen: (next, nextMode) => showFlow(next, nextMode, onOpenStory),
  });
  onLeave(() => {
    flow.destroy();
    layout.classList.remove('wide');
  });
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

  // Files an agent has explained earn a full row. The rest would just repeat
  // "no explanation" down the page, so they collapse into one quiet line.
  const explained = usedBy.filter((entry) => entry.latestWhy);
  const silent = usedBy.filter((entry) => !entry.latestWhy);

  const usedByBlock = usedBy.length
    ? explained
        .map(
          (entry) => `<div class="file-row">
            <span class="path">${esc(entry.file)}</span>
            ${whyLine(entry.latestWhy)}
          </div>`
        )
        .join('') +
      (silent.length
        ? `<div class="file-row">
            <span class="why none">${plural(silent.length, 'file')} no agent has explained yet</span>
            <span class="path muted">${silent.map((e) => esc(e.file)).join(', ')}</span>
          </div>`
        : '')
    : '<p class="fp-none">Nothing else in the project mentions it.</p>';

  const historyBlock = history.entries.length
    ? history.entries
        .map(
          (entry) => `<button class="card" data-id="${esc(entry.storyId)}">
            <div class="t">${esc(entry.title)}</div>
            ${entry.why ? `<div class="w">${esc(entry.why)}</div>` : ''}
            <div class="when">${ago(entry.at)}, the agent called it "${esc(entry.level)}"</div>
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
      <div class="label">What the agents said about this file</div>
      ${historyBlock}
    </div>

    <div class="block">
      <div class="label">Named in ${plural(usedBy.length, 'other file')}</div>
      <div class="file-list">${usedByBlock}</div>
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
  for (const row of document.querySelectorAll('.card')) {
    row.addEventListener('click', () => onOpenStory(row.dataset.id));
  }
}

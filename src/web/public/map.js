import { ago, esc, getJson, plural, setScreen } from './ui.js';

/* The code map.

   Two things on this screen, and they come from different places:

     structure - who defines a name, and who uses it. Read from the source, so
                 it is a fact. It can miss things; it never invents them.
     meaning   - the sentences. Every one was written by an agent in a story
                 about that exact file. If no agent ever explained a file, this
                 screen says so instead of guessing. */

let searchTimer = null;

function whyLine(why) {
  return why
    ? `<div class="why">${esc(why)}</div>`
    : `<div class="why none">no agent has explained this file yet</div>`;
}

export async function showMap(onOpenStory) {
  setScreen('<div class="empty">Reading the code…</div>');

  const map = await getJson('/api/map');

  setScreen(`<div class="page wide">
    <div class="head">
      <h1 class="title">Code map</h1>
      <div class="head-meta">
        <span>${plural(map.fileCount, 'file')}</span>
        <span>${plural(map.symbolCount, 'name')}</span>
        <span>read ${ago(map.builtAt)}</span>
      </div>
    </div>

    <div class="search">
      <input id="map-q" type="search" placeholder="search a function, class or file…" autocomplete="off" spellcheck="false" />
      <span class="hint" id="map-hint">type to search</span>
    </div>

    <div id="map-results"></div>

    <div id="map-home" class="block">
      <div class="label">Most depended on</div>
      ${map.busiest
        .map(
          (entry) => `<div class="file-row">
            <span class="path">${esc(entry.file)}</span>
            ${whyLine(entry.latestWhy)}
            <span class="c mono" style="color:var(--chalk-3)">${plural(entry.usedBy, 'file')} import it · ${plural(
              entry.defines,
              'name'
            )} defined</span>
          </div>`
        )
        .join('')}
    </div>

    <div class="footnote">
      Who-uses-what is read from the code and can miss things — check the file when it matters.
      The sentences come from stories your agents wrote; nothing here is generated.
    </div>
  </div>`);

  const input = document.querySelector('#map-q');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value, onOpenStory), 160);
  });
  input.focus();
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
  const { results: hits } = await getJson(`/api/map/search?q=${encodeURIComponent(query)}`);
  hint.textContent = hits.length ? plural(hits.length, 'match') : 'nothing found';

  results.innerHTML = hits
    .map(
      (hit) => `<button class="hit" data-name="${esc(hit.name)}">
        <span><span class="name">${esc(hit.name)}</span> <span class="where">${esc(hit.file)}</span></span>
        <span class="count">${hit.usedByCount ? `used in ${plural(hit.usedByCount, 'file')}` : 'not used elsewhere'}</span>
      </button>`
    )
    .join('');

  for (const button of results.querySelectorAll('.hit')) {
    button.addEventListener('click', () => showSymbol(button.dataset.name, onOpenStory));
  }
}

export async function showSymbol(name, onOpenStory) {
  setScreen('<div class="empty">Looking it up…</div>');

  let data;
  try {
    data = await getJson(`/api/map/symbol?name=${encodeURIComponent(name)}`);
  } catch {
    setScreen(`<div class="empty"><h2>Not found</h2><p>No name like “${esc(name)}” is defined in this project.</p></div>`);
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
            <span class="path" style="color:var(--chalk-3)">${silent.map((e) => esc(e.file)).join('  ·  ')}</span>
          </div>`
        : '')
    : '<p class="mono" style="color:var(--chalk-3)">Nothing else in the project mentions it.</p>';

  const historyBlock = history.entries.length
    ? history.entries
        .map(
          (entry) => `<button class="card" data-id="${esc(entry.storyId)}" >
            <div class="t">${esc(entry.title)}</div>
            ${entry.why ? `<div class="w">${esc(entry.why)}</div>` : ''}
            <div class="when">${ago(entry.at)} · the agent called it "${esc(entry.level)}"</div>
          </button>`
        )
        .join('')
    : '<p class="mono" style="color:var(--chalk-3)">No recorded change has touched this file yet.</p>';

  setScreen(`<div class="page wide">
    <div class="head">
      <div>
        <div class="sym-name">${esc(symbol.name)}</div>
        <div class="sym-where">${esc(symbol.kind)} · ${esc(symbol.file)}:${symbol.line}${
          symbol.exported ? ' · exported' : ''
        }</div>
      </div>
      <button class="btn" id="map-back">← back to search</button>
    </div>

    <div class="block">
      <div class="label">What the agents said about this file</div>
      ${historyBlock}
    </div>

    <div class="block">
      <div class="label">Used in ${plural(usedBy.length, 'other file')}</div>
      <div class="file-list">${usedByBlock}</div>
    </div>

    ${
      uses.length
        ? `<div class="block">
            <div class="label">Names this file can reach</div>
            <p class="mono" style="color:var(--chalk-2)">${uses.map(esc).join(', ')}</p>
          </div>`
        : ''
    }

    <div class="footnote">
      "Used in" is a text match on the name, read from the source. It is a strong hint, not a compiler.
    </div>
  </div>`);

  document.querySelector('#map-back').addEventListener('click', () => showMap(onOpenStory));
  for (const row of document.querySelectorAll('.card')) {
    row.addEventListener('click', () => onOpenStory(row.dataset.id));
  }
}

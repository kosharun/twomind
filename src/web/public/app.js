import { $, ago, esc, getJson, guard, plural } from './ui.js';
import { showCatchUp } from './catchup.js';
import { showStory } from './story.js';
import { showMap } from './map.js';

/* The shell: load state, draw the ledger index down the left, switch screens.
   Each screen lives in its own module and owns its own markup. */

const state = { stories: [], project: null, catchUp: null, selectedId: null, screen: 'catchup' };

/** Entries are numbered oldest-first, like a real ledger, so a number never changes. */
const numberOf = (id) => state.stories.length - state.stories.findIndex((s) => s.id === id);

async function load() {
  const data = await getJson('/api/state');
  Object.assign(state, data);

  $('#project-name').textContent = data.project.name;
  $('#story-count').textContent = data.stories.length || '';
  drawIndex();
  return data;
}

function drawIndex() {
  const list = $('#story-list');

  if (!state.stories.length) {
    list.innerHTML = '<div style="padding:18px 20px;color:var(--chalk-3)" class="mono">No entries yet.</div>';
    return;
  }

  list.innerHTML = state.stories
    .map((story, index) => {
      const number = state.stories.length - index;
      const on = story.id === state.selectedId && state.screen === 'story';
      const unexplained = story.headline === 'not explained by the agent';
      return `<button class="entry${on ? ' on' : ''}${unexplained ? ' unexplained' : ''}" data-id="${esc(story.id)}">
        <span class="badge">${String(number).padStart(2, '0')}</span>
        <div>
          <div class="entry-title">${esc(story.title)}</div>
          <div class="entry-meta">
            ${story.isNew ? '<span class="new">new</span>' : ''}
            <span>${ago(story.createdAt)}</span>
            <span>${plural(story.files, 'file')}</span>
            ${unexplained ? '<span class="warn">unexplained</span>' : ''}
          </div>
        </div>
      </button>`;
    })
    .join('');

  for (const entry of list.querySelectorAll('.entry')) {
    entry.addEventListener('click', () => openStory(entry.dataset.id));
  }
}

function markNav(screen) {
  for (const button of document.querySelectorAll('#nav button')) {
    button.classList.toggle('on', button.dataset.screen === screen);
  }
}

async function openStory(id) {
  state.selectedId = id;
  state.screen = 'story';
  markNav('story');
  drawIndex();
  await guard(() => showStory(id, numberOf(id)));
}

async function go(screen) {
  state.screen = screen;
  markNav(screen);

  if (screen === 'catchup') {
    state.selectedId = null;
    drawIndex();
    showCatchUp(state, openStory);
  } else if (screen === 'map') {
    state.selectedId = null;
    drawIndex();
    await guard(() => showMap(openStory));
  } else if (state.stories.length) {
    await openStory(state.selectedId ?? state.stories[0].id);
  } else {
    showCatchUp(state, openStory);
  }
}

function liveUpdates() {
  const source = new EventSource('/api/events');
  const live = $('#live');
  source.addEventListener('open', () => live.classList.remove('offline'));
  source.addEventListener('error', () => live.classList.add('offline'));
  source.addEventListener('stories', async () => {
    await load();
    if (state.screen === 'catchup') showCatchUp(state, openStory);
  });
}

function theme() {
  const button = $('#theme-btn');
  const saved = localStorage.getItem('twomind-theme');
  if (saved) document.documentElement.dataset.theme = saved;

  const sync = () => {
    button.textContent = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  };

  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('twomind-theme', next);
    } catch {
      /* private mode: the toggle still works for this session */
    }
    sync();
  });

  sync();
}

for (const button of document.querySelectorAll('#nav button')) {
  button.addEventListener('click', () => go(button.dataset.screen));
}

theme();
guard(load).then(() => {
  showCatchUp(state, openStory);
  liveUpdates();
});

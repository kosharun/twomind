/* Shared helpers. Everything here is used by more than one screen.
   If only one screen needs it, it belongs in that screen's module. */

export const $ = (selector) => document.querySelector(selector);

export function esc(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}

export function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

/**
 * Run a screen and never leave the user staring at "loading…".
 *
 * This exists because a stale dashboard (started before an endpoint existed)
 * made the code map hang forever with no message. A screen that cannot load
 * now says what broke and offers a way out.
 */
export async function guard(render) {
  try {
    await render();
  } catch (error) {
    const stale = String(error.message || '').startsWith('404');
    setScreen(`<div class="empty">
      <h2>${stale ? 'This dashboard is out of date' : 'That did not load'}</h2>
      <p>${
        stale
          ? 'It was started before this screen existed. Stop it in your terminal (Ctrl+C) and run <span class="mono">twomind serve</span> again.'
          : 'Something went wrong reading the project.'
      }</p>
      <p class="mono" style="margin-top:14px;color:var(--chalk-3)">${esc(error.message || error)}</p>
      <button class="btn" onclick="location.reload()">Reload</button>
    </div>`);
  }
}

/** A collapsible section: the header is a real button, so it works on a keyboard. */
export function wireDisclosures(scope = document) {
  for (const head of scope.querySelectorAll('[data-toggle]')) {
    head.addEventListener('click', () => {
      const box = head.closest('[data-box]');
      const open = box.classList.toggle('open');
      head.setAttribute('aria-expanded', String(open));
      // A station you have opened stays marked on the route line.
      box.classList.add('read');
    });
  }
}

let leaving = null;

/** Run `cleanup` the next time the screen changes, e.g. to stop listening for keys. */
export function onLeave(cleanup) {
  leaving = cleanup;
}

export function setScreen(html) {
  const screen = $('#screen');
  leaving?.();
  leaving = null;
  screen.innerHTML = html;
  screen.scrollTop = 0;
}

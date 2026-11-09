import { fill, h } from '../content/dom.js';
import { ext } from '../lib/browser.js';
import { ALL_SITES, originPattern } from '../lib/url.js';

const view = document.getElementById('view');
const el = (tag, props, ...kids) => h(document, tag, props, ...kids);
const tabId = Number(new URLSearchParams(location.search).get('tab'));
const MAX = 10;

function item(key, label, onclick, note) {
  return [
    el('button', { type: 'button', 'data-key': key, onclick }, el('kbd', { text: key.toUpperCase() }), label),
    note ? el('small', { text: note }) : null,
  ];
}

async function recheckAndClose() {
  await ext.tabs.sendMessage(tabId, { type: 'recheck' }).catch(() => {});
  window.close();
}

function allowListed(origins) {
  ext.permissions
    .request({ origins: origins.slice(0, MAX).map(originPattern) })
    .then((ok) => (ok ? recheckAndClose() : null));
}

function allowAll() {
  ext.permissions.request({ origins: ALL_SITES }).then(async (ok) => {
    if (!ok) return;
    await ext.runtime.sendMessage({ type: 'broad-granted' });
    recheckAndClose();
  });
}

async function notNow() {
  await ext.runtime.sendMessage({ type: 'perm-not-now' });
  window.close();
}

async function init() {
  const state = Number.isInteger(tabId) ? await ext.tabs.sendMessage(tabId, { type: 'getState' }).catch(() => null) : null;
  const origins = state?.pendingOrigins ?? [];
  if (!origins.length) {
    fill(view, el('h1', { text: 'Nothing waiting' }), el('p', { class: 'dim', text: 'No sites need permission right now.' }));
    return;
  }
  fill(view,
    el('h1', { text: origins.length === 1 ? '1 site needs your OK' : `${origins.length} sites need your OK` }),
    el('p', { text: 'Linked from team profiles. Only the linked page is read, once.' }),
    el('ul', {}, origins.slice(0, MAX).map((o) => el('li', { text: o.replace(/^https:\/\//, '') }))),
    origins.length > MAX ? el('p', { class: 'dim', text: `and ${origins.length - MAX} more` }) : null,
    el('hr', { class: 'rule' }),
    el('div', { class: 'menu' },
      item('a', origins.length > MAX ? `Allow these ${MAX}` : 'Allow these', () => allowListed(origins)),
      item('e', 'Allow every site until the browser closes', allowAll,
        'Only pages linked from Devpost profiles are read. Taken back when the browser restarts.'),
      item('n', 'Not now', notNow, 'Won\'t pop up again this session.'),
    ),
  );
}

document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === 'Escape') return notNow();
  document.querySelector(`button[data-key="${CSS.escape(ev.key.toLowerCase())}"]`)?.click();
});

init();

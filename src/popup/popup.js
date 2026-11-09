import { ext } from '../lib/browser.js';
import { ALL_SITES, DONATE_URL, DEVPOST_ORIGINS, SUPPORTED_PAGES, classifyPage, originPattern } from '../lib/url.js';
import { fill, h } from '../content/dom.js';

const view = document.getElementById('view');
const el = (tag, props, ...kids) => h(document, tag, props, ...kids);
const MAX_ORIGINS_PER_REQUEST = 10;

let tab = null;
let page = null;
let pollTimer = null;
let lastError = '';
let shownKey = '';
let broad = false;

async function send(type) {
  try {
    return await ext.tabs.sendMessage(tab.id, { type });
  } catch {
    return null;
  }
}

function show(key, ...nodes) {
  if (key === shownKey) return;
  shownKey = key;
  fill(view, nodes);
}

function item(key, label, onclick, note) {
  return [
    el('button', { type: 'button', 'data-key': key, onclick }, el('kbd', { text: key.toUpperCase() }), label),
    note ? el('small', { text: note }) : null,
  ];
}

function renderUnsupported(reason) {
  show(
    `unsupported:${reason}`,
    el('h1', { text: 'Nothing to check here' }),
    el('p', { class: 'dim', text: reason }),
    el('p', { text: 'Works on:' }),
    el('ul', {}, SUPPORTED_PAGES.map((t) => el('li', { text: t }))),
  );
}

function broadLine() {
  return broad
    ? el('div', { class: 'menu' },
        item('x', 'Take back "allow every site"', revokeBroad, 'Personal sites are currently allowed without asking until the browser closes.'))
    : null;
}

function revokeBroad() {
  ext.runtime.sendMessage({ type: 'revoke-broad' }).finally(() => {
    shownKey = '';
    refresh();
  });
}

function renderOff(viewOnly = false) {
  const keep = el('input', { type: 'checkbox', id: 'keep' });
  const auto = el('input', { type: 'checkbox', id: 'auto' });
  const gallery = page.kind === 'gallery';
  const go = (mode) => enable(mode, auto.checked);
  show(
    `off:${lastError}:${broad}:${viewOnly}`,
    el('h1', { text: viewOnly ? 'Flagged earlier this session' : 'Not running on this page' }),
    viewOnly ? el('p', { class: 'dim', text: 'The flag on this page comes from a check you ran earlier. Nothing new was read.' }) : null,
    el('div', { class: 'menu' },
      item('1', viewOnly ? 'Check this page again' : 'Check this page', () => go(keep.checked ? 'session' : 'page')),
      el('label', { for: 'keep' }, keep, 'Also check pages I open later in this tab'),
      gallery
        ? item('2', 'Check every page of this gallery', () => go('full'),
          'Goes through the gallery page by page on its own, then opens a report.')
        : null,
      broad ? null : el('label', { for: 'auto' }, auto, 'Allow linked personal sites without asking, until the browser closes'),
    ),
    broadLine(),
    lastError ? el('p', { class: 'error', role: 'alert', text: lastError }) : null,
  );
}

function enable(mode, allSites = false) {
  // must run before any await or Firefox loses the user gesture
  const granted = ext.permissions.request({ origins: allSites ? [...DEVPOST_ORIGINS, ...ALL_SITES] : DEVPOST_ORIGINS });
  ext.storage.session.set({ pendingEnable: { tabId: tab.id, mode } });
  granted
    .then(async (ok) => {
      if (ok && allSites) await ext.runtime.sendMessage({ type: 'broad-granted' });
      if (!ok) {
        lastError = 'Needs access to devpost.com to read projects. Nothing changed.';
        await ext.storage.session.remove('pendingEnable');
        return refresh();
      }
      const res = await ext.runtime.sendMessage({ type: 'enable', tabId: tab.id, mode });
      lastError = res?.ok ? '' : 'Could not start here. Reload the page and try again.';
      setTimeout(refresh, 300);
    })
    .catch(() => {
      lastError = 'Could not ask for access. Try again.';
      refresh();
    });
}

function allowSites(origins) {
  const batch = origins.slice(0, MAX_ORIGINS_PER_REQUEST);
  ext.permissions
    .request({ origins: batch.map(originPattern) })
    .then((ok) => (ok ? send('recheck') : null))
    .finally(refresh);
}

function allowAllSites() {
  ext.permissions
    .request({ origins: ALL_SITES })
    .then(async (ok) => {
      if (!ok) return;
      await ext.runtime.sendMessage({ type: 'broad-granted' });
      await send('recheck');
    })
    .finally(refresh);
}

function renderRunning(state, mode) {
  const active = state.status === 'running' || state.status === 'paused';
  const counting = state.full?.countdown != null;
  const title = {
    running: 'Checking',
    paused: 'Paused',
    stopped: 'Stopped',
    done: counting ? 'Moving to next page' : 'Done with this page',
  }[state.status] ?? 'On';

  const rows = [];
  if (state.full) {
    const projects = state.totalProjects ? `, ${state.totalProjects} projects` : '';
    rows.push(['Page', `${state.full.current} of ${state.full.last}${projects}`]);
  }
  rows.push(['Checked', `${state.done} / ${state.total}`]);
  const flaggedAll = state.galleryFlagged ?? state.flagged;
  const flaggedText = flaggedAll === state.flagged ? String(flaggedAll) : `${flaggedAll} in this gallery, ${state.flagged} on this page`;
  rows.push(['Flagged', flaggedText, flaggedAll > 0]);
  if (state.dismissed) rows.push(['Dismissed', String(state.dismissed)]);
  if (state.errors) rows.push(['Unreadable', String(state.errors)]);
  if (state.skipped) rows.push(['Skipped', `${state.skipped} (over the per-page limit)`]);
  if (state.checking) rows.push(['Now', state.checking]);

  const nodes = [
    el('h1', { text: title }),
    el('dl', {}, rows.map(([k, v, hi]) => [el('dt', { text: k }), el('dd', { class: hi ? 'hi' : null, text: v, title: v })])),
  ];

  if (state.pendingOrigins?.length) {
    const origins = state.pendingOrigins;
    nodes.push(
      el('hr', { class: 'rule' }),
      el('p', { text: 'Personal sites linked from team profiles, not read yet:' }),
      el('ul', {}, origins.slice(0, MAX_ORIGINS_PER_REQUEST).map((o) => el('li', { text: o.replace(/^https:\/\//, '') }))),
      el('div', { class: 'menu' },
        item('a', origins.length > MAX_ORIGINS_PER_REQUEST ? `Allow the first ${MAX_ORIGINS_PER_REQUEST}` : 'Allow these', () => allowSites(origins),
          'Only the linked page is read, once.'),
        item('e', 'Allow every site until the browser closes', () => allowAllSites()),
      ),
    );
  }

  const keys = [];
  if (state.status === 'running') keys.push(item('p', 'Pause', () => send('pause').then(refresh)));
  if (state.status === 'paused') keys.push(item('r', 'Resume', () => send('resume').then(refresh)));
  if (active || counting || mode.session) keys.push(item('s', mode.full ? 'Stop full review' : 'Stop', () => stop()));
  if (!active && !counting && !mode.full) keys.push(item('g', 'Check again', () => send('restart').then(refresh)));
  nodes.push(el('hr', { class: 'rule' }), el('div', { class: 'menu' }, keys));
  if (mode.session && !mode.full) nodes.push(el('p', { class: 'dim', text: 'Stays on for this tab. Stop turns it off.' }));
  nodes.push(broadLine());
  show(JSON.stringify([state, mode, broad]), nodes);
}

async function stop() {
  await send('stop');
  await ext.runtime.sendMessage({ type: 'disable', tabId: tab.id });
  refresh();
}

async function refreshReportLink() {
  const run = await ext.runtime.sendMessage({ type: 'full-report' }).catch(() => null);
  document.getElementById('report').hidden = !run;
}

async function refresh() {
  refreshReportLink();
  if (!page || page.kind === 'unsupported') return renderUnsupported(page?.reason ?? 'Not a Devpost page.');
  broad = !!(await ext.runtime.sendMessage({ type: 'broad-status' }).catch(() => null))?.granted;
  const state = await send('getState');
  if (!state || state.status === 'idle') return renderOff();
  if (state.view) return renderOff(true);
  if (state.status === 'unsupported' || state.status === 'unknown-structure') return renderUnsupported(state.message);
  if (state.status === 'starting') return show('starting', el('h1', { text: 'Starting' }));
  const mode = await ext.runtime.sendMessage({ type: 'sessionMode', tabId: tab.id });
  renderRunning(state, mode ?? {});
}

const clearButton = document.getElementById('clear');
const clearLabel = clearButton.querySelector('span');
let clearArmed = false;
// no confirm() in Firefox popups
clearButton.addEventListener('click', async () => {
  if (!clearArmed) {
    clearArmed = true;
    clearLabel.textContent = 'Press again to delete dismissals, notes, report';
    setTimeout(() => {
      clearArmed = false;
      clearLabel.textContent = 'Clear saved data';
    }, 5000);
    return;
  }
  clearArmed = false;
  await ext.runtime.sendMessage({ type: 'clear' });
  await send('dismissals-cleared');
  clearLabel.textContent = 'Cleared';
  shownKey = '';
  refresh();
});

document.getElementById('coffee').addEventListener('click', () => {
  ext.tabs.create({ url: DONATE_URL });
  window.close();
});

document.getElementById('report').addEventListener('click', () => {
  ext.tabs.create({ url: ext.runtime.getURL('report/report.html') });
  window.close();
});

document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.matches?.('input, textarea')) return;
  const target = document.querySelector(`button[data-key="${CSS.escape(ev.key.toLowerCase())}"]:not([hidden])`);
  if (!target) return;
  ev.preventDefault();
  target.click();
});

async function init() {
  [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  page = tab?.url ? classifyPage(tab.url) : { kind: 'unsupported', reason: 'Not a Devpost page.' };
  await refresh();
  pollTimer = setInterval(refresh, 1000);
}

window.addEventListener('unload', () => clearInterval(pollTimer));
init();

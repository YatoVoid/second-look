import { createAnalyzer } from '../lib/analyzer.js';
import { ext } from '../lib/browser.js';
import { loadDismissals, makeDismissal, saveDismissal } from '../lib/dismissals.js';
import {
  extractGalleryItems,
  extractPagination,
  extractProject,
  hasGalleryStructure,
  hasProjectStructure,
} from '../lib/extract.js';
import { buildNavList } from '../lib/flag-nav.js';
import { summarizeEntry } from '../lib/full-review.js';
import { classifyPage, normalizeProjectUrl } from '../lib/url.js';
import { registerFonts } from './fonts.js';
import { createIndicators } from './indicator.js';
import { createStatusChip, stepIndex } from './status-chip.js';

const NEXT_PAGE_DELAY_S = 2;
let session = null;

export function boot() {
  globalThis.__secondLook = {
    wake() {
      if (!session || session.view || ['stopped', 'unsupported', 'unknown-structure'].includes(currentStatus())) start();
      else session.chip?.show();
    },
  };
  ext.runtime.onMessage.addListener(onMessage);
  setInterval(() => {
    if (session && !session.userStopped && session.href !== location.href) start();
  }, 1000);
  start();
}

function currentStatus() {
  return session?.analyzer?.getState().status ?? session?.status ?? 'idle';
}

function snapshot() {
  if (!session) return { status: 'idle' };
  const base = {
    kind: session.page.kind,
    message: session.message ?? '',
    full: session.full ?? null,
    view: !!session.view,
    galleryFlagged: session.navTotal ?? null,
    totalProjects: session.pagination?.total ?? null,
  };
  if (!session.analyzer) return { ...base, status: session.status };
  return { ...base, ...session.analyzer.getState() };
}

function teardown() {
  if (!session) return;
  clearInterval(session.countdownTimer);
  clearTimeout(session.navTimer);
  session.analyzer?.stop();
  session.observer?.disconnect();
  session.indicators?.removeAll();
  session.chip?.remove();
  session = null;
}

// the popup ends the run itself; a second stop message would open the report twice
function userStop(s, notifyRun = true) {
  s.userStopped = true;
  clearInterval(s.countdownTimer);
  s.analyzer?.stop();
  if (s.full) {
    s.full = { ...s.full, countdown: null };
    s.chip?.setFull(s.full);
    if (notifyRun) ext.runtime.sendMessage({ type: 'full-stop' }).catch(() => {});
  }
}

async function reportPage(s) {
  const entries = s.analyzer.entries();
  const flagged = entries.filter((e) => e.result?.flagged && !e.result.dismissed).map(summarizeEntry);
  const state = s.analyzer.getState();
  const report = {
    url: s.href,
    page: s.pagination.current,
    nextUrl: s.pagination.nextUrl,
    checked: state.done,
    flagged,
    dismissed: state.dismissed,
    errors: state.errors,
    pendingOrigins: state.pendingOrigins,
  };
  const res = await ext.runtime.sendMessage({ type: 'full-page-done', report }).catch(() => null);
  if (session !== s || s.userStopped) return;
  if (!res?.next) {
    s.full = { ...s.full, countdown: null, finished: true };
    s.chip.setFull(s.full);
    return;
  }
  let left = NEXT_PAGE_DELAY_S;
  s.full = { ...s.full, countdown: left };
  s.chip.setFull(s.full);
  s.countdownTimer = setInterval(() => {
    left -= 1;
    if (session !== s || s.userStopped) return clearInterval(s.countdownTimer);
    if (left > 0) {
      s.full = { ...s.full, countdown: left };
      s.chip.setFull(s.full);
      return;
    }
    clearInterval(s.countdownTimer);
    location.assign(res.next);
  }, 1000);
}

function trimResult(r) {
  return {
    flagged: r.flagged,
    findings: r.findings,
    limitations: r.limitations,
    blockedOrigins: r.blockedOrigins ?? [],
    checkedAt: r.checkedAt,
    dismissed: !!r.dismissed,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function landOnTarget(s, items) {
  const url = await ext.runtime.sendMessage({ type: 'nav-target' }).catch(() => null);
  if (!url || session !== s) return;
  s.navUrl = url;
  for (let i = 0; i < 25; i++) {
    const anchor = s.indicators.list().find((a) => s.indicators.urlOf(a) === url);
    if (anchor) {
      s.indicators.goTo(anchor);
      s.updateNav();
      return;
    }
    await sleep(200);
    if (session !== s) return;
  }
  const card = items.find((i) => i.url === url)?.element;
  card?.scrollIntoView({ block: 'center' });
  s.updateNav();
}

async function storedResults(urls) {
  if (!urls.length) return {};
  return (await ext.runtime.sendMessage({ type: 'stored-results', urls }).catch(() => null)) ?? {};
}

async function start({ fresh = false } = {}) {
  teardown();
  const href = location.href;
  const page = classifyPage(href);
  const view = globalThis.__secondLookView === true && page.kind !== 'unsupported';
  const s = { href, page, status: 'starting', userStopped: false, full: null, view, pending: 0, permAsked: false };
  session = s;
  if (page.kind === 'unsupported') {
    s.status = 'unsupported';
    s.message = page.reason;
    return;
  }
  const knownLayout = page.kind === 'project' ? hasProjectStructure(document) : hasGalleryStructure(document);
  if (!knownLayout) {
    s.status = 'unknown-structure';
    s.message = "Page layout not recognized, so nothing was read. If Devpost is showing a bot check, let it finish and the page will be checked when it reloads.";
    return;
  }

  const [savedDismissals, fullStatus] = await Promise.all([
    loadDismissals(ext.storage.local).catch(() => ({})),
    page.kind === 'gallery' ? ext.runtime.sendMessage({ type: 'full-status' }).catch(() => null) : null,
  ]);
  if (session !== s) return;
  let dismissals = savedDismissals;
  s.pagination = page.kind === 'project' ? null : extractPagination(document, href);
  if (fullStatus?.active) s.full = { current: s.pagination.current, last: s.pagination.last, countdown: null };

  registerFonts(document);
  const currentPage = s.pagination?.current ?? 1;
  s.navOthers = [];
  const navList = () => {
    const here = (s.indicators?.list() ?? []).map((anchor) => ({ url: s.indicators.urlOf(anchor), anchor }));
    return buildNavList({ here, others: s.navOthers, currentPage });
  };
  const updateNav = () => {
    const list = navList();
    s.navTotal = list.length;
    s.chip?.setNav(list.findIndex((x) => x.url === s.navUrl), list.length);
  };
  s.updateNav = updateNav;
  const refreshOthers = () => {
    if (page.kind !== 'gallery') return;
    clearTimeout(s.navTimer);
    s.navTimer = setTimeout(async () => {
      const others = await ext.runtime.sendMessage({ type: 'gallery-flags' }).catch(() => null);
      if (session !== s || !Array.isArray(others)) return;
      s.navOthers = others;
      updateNav();
    }, 300);
  };
  s.refreshOthers = refreshOthers;
  const step = (dir) => {
    const list = navList();
    const i = stepIndex(list.findIndex((x) => x.url === s.navUrl), list.length, dir);
    if (i < 0) return;
    const target = list[i];
    s.navUrl = target.url;
    updateNav();
    if (target.here) s.indicators.goTo(target.anchor);
    else ext.runtime.sendMessage({ type: 'nav-go', pageUrl: target.pageUrl, url: target.url }).catch(() => {});
  };
  s.indicators = createIndicators(document, {
    onChange: updateNav,
    async onDismiss(entry, reason) {
      const record = makeDismissal({ reason, candidates: entry.result.findings.map((f) => f.source.url), at: Date.now() });
      dismissals = await saveDismissal(ext.storage.local, entry.url, record);
      s.analyzer.refreshDismissals();
      await ext.runtime.sendMessage({ type: 'flag-mark', url: entry.url, dismissed: true }).catch(() => {});
      refreshOthers();
    },
    onHide(entry) {
      entry.result.hidden = true;
      s.indicators.render(entry);
      s.chip.update({ ...s.analyzer.getState(), view });
      ext.runtime.sendMessage({ type: 'flag-mark', url: entry.url, hidden: true }).catch(() => {});
    },
  });
  const noChip = { update() {}, setFull() {}, setPending() {}, setNav() {}, show() {}, remove() {} };
  s.chip = view && page.kind === 'project'
    ? noChip
    : createStatusChip(document, {
        onPause: () => s.analyzer.pause(),
        onResume: () => s.analyzer.resume(),
        onStop: () => userStop(s),
        onPrev: () => step(-1),
        onNext: () => step(1),
        onAllow: () => ext.runtime.sendMessage({ type: 'open-permissions', manual: true }).catch(() => {}),
      });
  s.chip.setFull(s.full);
  s.reloadDismissals = async () => {
    dismissals = await loadDismissals(ext.storage.local).catch(() => ({}));
    s.analyzer.refreshDismissals();
  };
  s.analyzer = createAnalyzer({
    fetchPage: (url) => ext.runtime.sendMessage({ type: 'fetch', url }),
    parseHtml: (html) => new DOMParser().parseFromString(html, 'text/html'),
    getDismissal: (url) => dismissals[url] ?? null,
    onUpdate: (entry) => {
      s.indicators.render(entry);
      if (!entry.fromStore && entry.result && !entry.result.error) {
        const pos = s.positions?.get(entry.url);
        ext.runtime
          .sendMessage({ type: 'store-result', url: entry.url, title: entry.title, result: trimResult(entry.result), page: currentPage, pos })
          .then(() => entry.result.flagged && refreshOthers())
          .catch(() => {});
      }
    },
    onStatus: (state) => {
      s.chip.update({ ...state, view });
      if (state.pendingOrigins.length !== s.pending) {
        s.pending = state.pendingOrigins.length;
        s.chip.setPending(s.pending);
        if (s.pending && !s.permAsked) {
          s.permAsked = true;
          ext.runtime.sendMessage({ type: 'open-permissions' }).catch(() => {});
        }
      }
      if (s.full && !s.reported && state.status === 'done' && state.total > 0 && state.done === state.total) {
        s.reported = true;
        reportPage(s);
      }
    },
  });

  if (page.kind === 'project') {
    const url = normalizeProjectUrl(href);
    const stored = fresh ? {} : await storedResults([url]);
    if (session !== s) return;
    if (view && !stored[url]) return;
    const detail = { ...extractProject(document, href), fetchedAt: Date.now() };
    s.analyzer.add([
      {
        result: stored[url]?.result,
        url,
        title: detail.title,
        tagline: detail.tagline,
        detail,
        placement: 'header',
        element: document.querySelector('#software-header') ?? document.querySelector('#app-title').parentElement,
      },
    ]);
    return;
  }

  const items = extractGalleryItems(document, href);
  s.positions = new Map();
  items.forEach((i, n) => s.positions.has(i.url) || s.positions.set(i.url, n));
  const stored = fresh ? {} : await storedResults([...new Set(items.map((i) => i.url))]);
  if (session !== s) return;
  const withStored = items.map((i) => {
    const rec = stored[i.url];
    return { ...i, result: rec ? { ...rec.result, hidden: !!rec.hidden } : undefined };
  });
  s.analyzer.add(view ? withStored.filter((i) => i.result) : withStored);
  refreshOthers();
  landOnTarget(s, items);
  if (view) return;
  if (s.full && s.analyzer.getState().total === 0) {
    s.reported = true;
    reportPage(s);
  }
  let timer = null;
  s.observer = new MutationObserver((records) => {
    const ours = records.every((r) => [...r.addedNodes].every((n) => n.nodeName?.startsWith('SECOND-LOOK')));
    if (ours) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const fresh = extractGalleryItems(document, href);
      for (const i of fresh) if (!s.positions.has(i.url)) s.positions.set(i.url, s.positions.size);
      s.analyzer.add(fresh);
    }, 500);
  });
  s.observer.observe(document.body, { childList: true, subtree: true });
}

function onMessage(msg, sender, sendResponse) {
  if (sender.id !== ext.runtime.id || !sender.url?.startsWith(ext.runtime.getURL(''))) return false;
  const a = session?.analyzer;
  switch (msg?.type) {
    case 'getState':
      break;
    case 'pause':
      a?.pause();
      break;
    case 'resume':
      a?.resume();
      break;
    case 'stop':
      if (session) userStop(session, false);
      break;
    case 'restart':
      start({ fresh: true });
      break;
    case 'recheck':
      a?.recheck();
      break;
    case 'dismissals-cleared':
      session?.reloadDismissals?.();
      break;
    default:
      return false;
  }
  sendResponse(snapshot());
  return false;
}

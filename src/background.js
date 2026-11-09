import { ext } from './lib/browser.js';
import { createFetcher } from './lib/fetcher.js';
import { galleryKey, isOpenFlag } from './lib/flag-nav.js';
import { recordPage, startRun, stopRun } from './lib/full-review.js';
import { createScheduler } from './lib/rate-limit.js';
import { ALL_SITES, classifyPage, DEVPOST_ORIGINS, isDevpostHost, normalizeProjectUrl, parseHttpsUrl } from './lib/url.js';

const MAX_STORED_FLAGS = 1500;

const scheduler = createScheduler({
  intervalFor: (origin) => (isDevpostHost(new URL(origin).hostname) ? 1000 : 2000),
});

const fetcher = createFetcher({
  fetchImpl: (url, init) => fetch(url, init),
  hasOriginPermission: (origin) => ext.permissions.contains({ origins: [`${origin}/*`] }),
  scheduler,
});

async function sessionGet(key, fallback) {
  const got = await ext.storage.session.get(key);
  return got[key] ?? fallback;
}

async function setSessionTab(tabId, on) {
  const tabs = await sessionGet('sessionTabs', {});
  if (on) tabs[tabId] = true;
  else delete tabs[tabId];
  await ext.storage.session.set({ sessionTabs: tabs });
}

async function getRun() {
  return sessionGet('fullReview', null);
}

async function saveRun(run) {
  await ext.storage.session.set({ fullReview: run });
}

async function inject(tabId, view = false) {
  await ext.scripting.executeScript({ target: { tabId }, func: (v) => (globalThis.__secondLookView = v), args: [view] });
  await ext.scripting.executeScript({ target: { tabId }, files: ['content/loader.js'] });
}

// several tabs write at once, so serialize the read-modify-write
let flagsChain = Promise.resolve();
function updateFlags(fn) {
  flagsChain = flagsChain.then(async () => {
    const flags = await sessionGet('flags', {});
    fn(flags);
    const keys = Object.keys(flags);
    if (keys.length > MAX_STORED_FLAGS) {
      const rank = (k) => (flags[k].result?.flagged ? 1 : 0);
      keys.sort((a, b) => rank(a) - rank(b) || (flags[a].result?.checkedAt ?? 0) - (flags[b].result?.checkedAt ?? 0));
      for (const k of keys.slice(0, keys.length - MAX_STORED_FLAGS)) delete flags[k];
    }
    await ext.storage.session.set({ flags });
  });
  return flagsChain;
}

let permissionWindowId = null;
async function openPermissionWindow(tabId) {
  if (permissionWindowId != null) {
    const ok = await ext.windows.update(permissionWindowId, { focused: true }).then(() => true, () => false);
    if (ok) return;
  }
  const win = await ext.windows.create({
    url: ext.runtime.getURL(`permissions/permissions.html?tab=${tabId}`),
    type: 'popup',
    width: 420,
    height: 520,
    focused: true,
  });
  permissionWindowId = win.id;
}

async function broadGranted() {
  return ext.permissions.contains({ origins: ALL_SITES });
}

async function enable(tabId, mode) {
  if (!Number.isInteger(tabId)) return { ok: false, error: 'bad-tab' };
  if (!(await ext.permissions.contains({ origins: DEVPOST_ORIGINS }))) return { ok: false, error: 'permission' };
  const tab = await ext.tabs.get(tabId);
  const page = classifyPage(tab.url ?? '');
  if (page.kind === 'unsupported') return { ok: false, error: 'unsupported' };
  if (mode === 'full') {
    if (page.kind !== 'gallery') return { ok: false, error: 'not-gallery' };
    await saveRun(startRun({ tabId, url: tab.url, now: Date.now() }));
  }
  await setSessionTab(tabId, mode === 'session' || mode === 'full');
  await inject(tabId);
  return { ok: true };
}

async function setNavTarget(tabId, url) {
  const targets = await sessionGet('navTargets', {});
  if (url) targets[tabId] = url;
  else delete targets[tabId];
  await ext.storage.session.set({ navTargets: targets });
}

async function takeNavTarget(tabId) {
  const url = (await sessionGet('navTargets', {}))[tabId] ?? null;
  if (url) await setNavTarget(tabId, null);
  return url;
}

const whole = (n, max) => (Number.isInteger(n) && n >= 0 && n <= max ? n : null);

async function navGo(sender, pageUrl, projectUrl) {
  const key = galleryKey(sender.tab.url ?? '');
  const target = parseHttpsUrl(pageUrl);
  const url = normalizeProjectUrl(projectUrl ?? '');
  if (!key || !target || !url || galleryKey(target.href) !== key || target.origin !== new URL(sender.tab.url).origin) {
    return { ok: false };
  }
  const run = await getRun();
  if (!(run?.tabId === sender.tab.id && run.status === 'running')) {
    await setNavTarget(sender.tab.id, url);
    await ext.tabs.update(sender.tab.id, { url: target.href });
    return { ok: true, tab: 'same' };
  }
  // a running review owns its tab, so jumps open in a second tab
  let tabId = await sessionGet('navTabId', null);
  const existing = tabId != null ? await ext.tabs.get(tabId).catch(() => null) : null;
  if (!existing) {
    const created = await ext.tabs.create({ url: 'about:blank', windowId: sender.tab.windowId, index: sender.tab.index + 1 });
    tabId = created.id;
    await ext.storage.session.set({ navTabId: tabId });
  }
  await setNavTarget(tabId, url);
  await ext.tabs.update(tabId, { url: target.href, active: true });
  return { ok: true, tab: 'other' };
}

async function endRun(run) {
  await saveRun(run);
  await setSessionTab(run.tabId, false);
  // the focused window might be the permission popup, which can't take tabs
  const tab = await ext.tabs.get(run.tabId).catch(() => null);
  await ext.tabs
    .create({ url: ext.runtime.getURL('report/report.html'), ...(tab ? { windowId: tab.windowId, index: tab.index + 1 } : {}) })
    .catch(() => ext.windows.create({ url: ext.runtime.getURL('report/report.html') }));
}

async function handle(msg, sender) {
  const fromPage = !!sender.tab && !sender.url?.startsWith(ext.runtime.getURL(''));
  switch (msg?.type) {
    case 'fetch':
      if (!fromPage || typeof msg.url !== 'string') return { ok: false, error: 'invalid-url' };
      return fetcher.get(msg.url);
    case 'enable':
      if (fromPage) return { ok: false, error: 'forbidden' };
      await ext.storage.session.remove('pendingEnable');
      return enable(msg.tabId, msg.mode);
    case 'disable': {
      if (fromPage) return { ok: false, error: 'forbidden' };
      await setSessionTab(msg.tabId, false);
      const run = await getRun();
      if (run?.tabId === msg.tabId && run.status === 'running') await endRun(stopRun(run, Date.now()));
      return { ok: true };
    }
    case 'sessionMode': {
      const tabs = await sessionGet('sessionTabs', {});
      const run = await getRun();
      return { session: !!tabs[msg.tabId], full: run?.tabId === msg.tabId && run.status === 'running' };
    }
    case 'full-status': {
      const run = await getRun();
      const active = fromPage && run?.tabId === sender.tab.id && run.status === 'running';
      return { active, pagesDone: active ? run.pages.length : 0 };
    }
    case 'full-page-done': {
      const run = await getRun();
      if (!fromPage || run?.tabId !== sender.tab.id) return { next: null };
      const { run: updated, next } = recordPage(run, msg.report, Date.now());
      if (updated.status === 'running') await saveRun(updated);
      else if (run.status === 'running') await endRun(updated);
      return { next };
    }
    case 'full-stop': {
      const run = await getRun();
      const tabId = fromPage ? sender.tab.id : msg.tabId;
      if (run?.tabId === tabId && run.status === 'running') await endRun(stopRun(run, Date.now()));
      return { ok: true };
    }
    case 'store-result': {
      if (!fromPage || typeof msg.url !== 'string' || !normalizeProjectUrl(msg.url)) return { ok: false };
      const pageUrl = sender.tab.url ?? '';
      const key = galleryKey(pageUrl);
      const page = whole(msg.page, 100000);
      const pos = whole(msg.pos, 100000);
      const where = key && page != null && pos != null ? { key, page, pos, pageUrl } : null;
      await updateFlags((flags) => {
        const prev = flags[msg.url];
        if (msg.result && !msg.result.error) {
          flags[msg.url] = {
            title: String(msg.title ?? '').slice(0, 300),
            result: msg.result,
            where: where ?? prev?.where ?? null,
            hidden: prev?.hidden ?? false,
          };
        } else delete flags[msg.url];
      });
      return { ok: true };
    }
    case 'flag-mark': {
      if (!fromPage || typeof msg.url !== 'string') return { ok: false };
      await updateFlags((flags) => {
        const rec = flags[msg.url];
        if (!rec) return;
        if (typeof msg.hidden === 'boolean') rec.hidden = msg.hidden;
        if (typeof msg.dismissed === 'boolean') rec.result = { ...rec.result, dismissed: msg.dismissed };
      });
      return { ok: true };
    }
    case 'gallery-flags': {
      if (!fromPage) return [];
      await flagsChain;
      const key = galleryKey(sender.tab.url ?? '');
      if (!key) return [];
      const flags = await sessionGet('flags', {});
      return Object.entries(flags)
        .filter(([, rec]) => rec.where?.key === key && isOpenFlag(rec))
        .map(([url, rec]) => ({ url, title: rec.title, page: rec.where.page, pos: rec.where.pos, pageUrl: rec.where.pageUrl }));
    }
    case 'nav-go':
      if (!fromPage) return { ok: false };
      return navGo(sender, msg.pageUrl, msg.url);
    case 'nav-target':
      if (!fromPage) return null;
      return takeNavTarget(sender.tab.id);
    case 'stored-results': {
      const flags = await sessionGet('flags', {});
      const urls = Array.isArray(msg.urls) ? msg.urls.slice(0, 500) : [];
      return Object.fromEntries(urls.filter((u) => flags[u]).map((u) => [u, flags[u]]));
    }
    case 'open-permissions': {
      const tabId = fromPage ? sender.tab.id : msg.tabId;
      if (!msg.manual && ((await sessionGet('permNotNow', false)) || (await broadGranted()))) return { opened: false };
      await openPermissionWindow(tabId);
      return { opened: true };
    }
    case 'perm-not-now':
      if (fromPage) return { ok: false };
      await ext.storage.session.set({ permNotNow: true });
      return { ok: true };
    case 'broad-granted':
      if (fromPage) return { ok: false };
      await ext.storage.local.set({ revokeBroadOnStartup: true });
      return { ok: true };
    case 'broad-status':
      return { granted: await broadGranted() };
    case 'revoke-broad':
      if (fromPage) return { ok: false };
      await ext.permissions.remove({ origins: ALL_SITES }).catch(() => {});
      await ext.storage.local.remove('revokeBroadOnStartup');
      return { ok: true };
    case 'full-report':
      if (fromPage) return null;
      return getRun();
    case 'clear':
      if (fromPage) return { ok: false, error: 'forbidden' };
      fetcher.clear();
      await ext.storage.local.clear();
      await ext.storage.session.remove(['fullReview', 'flags', 'permNotNow', 'navTargets']);
      await ext.permissions.remove({ origins: ALL_SITES }).catch(() => {});
      return { ok: true };
    default:
      return { ok: false, error: 'unknown' };
  }
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== ext.runtime.id) return false;
  handle(msg, sender).then(sendResponse, () => sendResponse({ ok: false, error: 'internal' }));
  return true;
});

// Firefox can close the popup while the permission prompt is up, so finish enabling here
ext.permissions.onAdded.addListener(async () => {
  const pending = await sessionGet('pendingEnable', null);
  if (pending) {
    await ext.storage.session.remove('pendingEnable');
    await enable(pending.tabId, pending.mode).catch(() => {});
  }
  const tabs = await ext.tabs.query({ url: DEVPOST_ORIGINS }).catch(() => []);
  for (const tab of tabs) ext.tabs.sendMessage(tab.id, { type: 'recheck' }).catch(() => {});
});

ext.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const page = classifyPage(tab.url ?? '');
  if (page.kind === 'unsupported') return;
  const tabs = await sessionGet('sessionTabs', {});
  if (tabs[tabId]) return inject(tabId).catch(() => {});
  if (page.kind === 'gallery') {
    const targets = await sessionGet('navTargets', {});
    if (targets[tabId]) inject(tabId, true).catch(() => {});
    return;
  }
  const flags = await sessionGet('flags', {});
  if (flags[normalizeProjectUrl(tab.url)]?.result?.flagged) inject(tabId, true).catch(() => {});
});

ext.windows.onRemoved.addListener((windowId) => {
  if (windowId === permissionWindowId) permissionWindowId = null;
});

ext.runtime.onStartup.addListener(async () => {
  const { revokeBroadOnStartup } = await ext.storage.local.get('revokeBroadOnStartup');
  if (!revokeBroadOnStartup) return;
  await ext.permissions.remove({ origins: ALL_SITES }).catch(() => {});
  await ext.storage.local.remove('revokeBroadOnStartup');
});

ext.tabs.onRemoved.addListener(async (tabId) => {
  await setSessionTab(tabId, false).catch(() => {});
  await setNavTarget(tabId, null).catch(() => {});
  if ((await sessionGet('navTabId', null)) === tabId) await ext.storage.session.remove('navTabId');
  const run = await getRun();
  if (run?.tabId === tabId && run.status === 'running') await saveRun(stopRun(run, Date.now()));
});

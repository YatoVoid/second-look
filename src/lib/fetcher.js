import { DISALLOW_ALL, isAllowed, parseRobots } from './robots.js';
import { isDevpostHost, parseHttpsUrl } from './url.js';

export const FETCH_DEFAULTS = Object.freeze({
  ttlMs: 30 * 60 * 1000,
  maxBytes: 1_500_000,
  timeoutMs: 15_000,
  maxEntries: 300,
  budget: 8000,
  retryDelayMs: 5000,
});

function isTransient(res) {
  return !res.ok && (res.error === 'network' || res.error === 'timeout' || res.status === 429 || res.status === 503);
}

export function retryAfter(header, nowMs) {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

export function createFetcher({
  fetchImpl,
  hasOriginPermission,
  scheduler,
  now = () => Date.now(),
  options = {},
}) {
  const opt = { ...FETCH_DEFAULTS, ...options };
  const cache = new Map();
  const inflight = new Map();
  const robots = new Map();
  let used = 0;

  async function rawFetch(url, accept) {
    if (used >= opt.budget) return { ok: false, error: 'budget' };
    used++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opt.timeoutMs);
    try {
      const res = await fetchImpl(url, {
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: { Accept: accept },
      });
      if (!res.ok) return { ok: false, error: 'http', status: res.status, retryAfterMs: retryAfter(res.headers.get('retry-after'), now()) };
      const { text, truncated } = await readCapped(res, opt.maxBytes);
      return { ok: true, status: res.status, text, truncated, contentType: res.headers.get('content-type') ?? '' };
    } catch (err) {
      return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function robotsFor(origin) {
    if (robots.has(origin)) return robots.get(origin);
    const pending = scheduler.schedule(origin, async () => {
      const res = await rawFetch(`${origin}/robots.txt`, 'text/plain');
      if (res.ok) return parseRobots(res.text);
      if (res.error === 'http' && res.status >= 400 && res.status < 500) return null;
      return DISALLOW_ALL;
    });
    robots.set(origin, pending);
    return pending;
  }

  async function load(u) {
    const rules = await robotsFor(u.origin);
    if (!isAllowed(rules, u.pathname + u.search)) return { ok: false, error: 'robots' };
    let res = await scheduler.schedule(u.origin, () => rawFetch(u.href, 'text/html'));
    if (isTransient(res)) {
      scheduler.penalize?.(u.origin, Math.min(res.retryAfterMs ?? opt.retryDelayMs, 60_000));
      res = await scheduler.schedule(u.origin, () => rawFetch(u.href, 'text/html'));
    }
    if (!res.ok) return { ok: false, error: res.error, status: res.status };
    if (!/text\/html|application\/xhtml\+xml/i.test(res.contentType)) return { ok: false, error: 'not-html' };
    return { ok: true, html: res.text, truncated: res.truncated, fetchedAt: now() };
  }

  async function get(rawUrl) {
    const u = parseHttpsUrl(rawUrl);
    if (!u) return { ok: false, error: 'invalid-url' };
    u.hash = '';
    const key = u.href;
    const hit = cache.get(key);
    if (hit && now() - hit.storedAt < opt.ttlMs) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    if (!isDevpostHost(u.hostname) && !(await hasOriginPermission(u.origin))) {
      return { ok: false, error: 'permission', origin: u.origin };
    }
    const p = load(u).then((value) => {
      if (value.ok || value.error === 'http' || value.error === 'robots' || value.error === 'not-html') {
        cache.set(key, { value, storedAt: now() });
        while (cache.size > opt.maxEntries) cache.delete(cache.keys().next().value);
      }
      return value;
    });
    inflight.set(key, p);
    try {
      return await p;
    } finally {
      inflight.delete(key);
    }
  }

  function clear() {
    cache.clear();
    robots.clear();
  }

  return { get, clear, stats: () => ({ used, budget: opt.budget, cached: cache.size }) };
}

async function readCapped(res, maxBytes) {
  if (!res.body?.getReader) {
    const text = await res.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      truncated = true;
      text += decoder.decode(value.subarray(0, value.byteLength - (bytes - maxBytes)));
      reader.cancel().catch(() => {});
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return { text, truncated };
}

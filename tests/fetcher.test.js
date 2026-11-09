import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFetcher } from '../src/lib/fetcher.js';
import { createScheduler } from '../src/lib/rate-limit.js';
import { isAllowed, parseRobots } from '../src/lib/robots.js';

const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

function make({ routes = {}, permitted = [], options } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const r = routes[url];
    if (typeof r === 'function') return r();
    if (r) return r.clone();
    return new Response('', { status: 404 });
  };
  const fetcher = createFetcher({
    fetchImpl,
    hasOriginPermission: async (o) => permitted.includes(o),
    scheduler: createScheduler({ intervalFor: () => 0 }),
    options: { retryDelayMs: 1, ...options },
  });
  return { fetcher, calls };
}

test('never sends cookies and reads Devpost without extra permission', async () => {
  const { fetcher, calls } = make({ routes: { 'https://devpost.com/benr': html('<p>hi</p>') } });
  const res = await fetcher.get('https://devpost.com/benr#x');
  assert.equal(res.ok, true);
  assert.equal(res.html, '<p>hi</p>');
  const page = calls.find((c) => c.url === 'https://devpost.com/benr');
  assert.equal(page.init.credentials, 'omit');
});

test('other origins need a granted permission', async () => {
  const { fetcher, calls } = make({ routes: { 'https://ana.example/': html('x') } });
  const res = await fetcher.get('https://ana.example/');
  assert.deepEqual(res, { ok: false, error: 'permission', origin: 'https://ana.example' });
  assert.equal(calls.length, 0);
});

test('honours robots.txt disallow rules', async () => {
  const { fetcher, calls } = make({
    permitted: ['https://ana.example'],
    routes: {
      'https://ana.example/robots.txt': new Response('User-agent: *\nDisallow: /private', { status: 200, headers: { 'content-type': 'text/plain' } }),
      'https://ana.example/private/p': html('secret'),
    },
  });
  assert.equal((await fetcher.get('https://ana.example/private/p')).error, 'robots');
  assert.ok(!calls.some((c) => c.url === 'https://ana.example/private/p'));
});

test('unreachable robots.txt means do not read', async () => {
  const { fetcher } = make({
    permitted: ['https://ana.example'],
    routes: { 'https://ana.example/robots.txt': new Response('', { status: 503 }), 'https://ana.example/': html('x') },
  });
  assert.equal((await fetcher.get('https://ana.example/')).error, 'robots');
});

test('caches results and shares in-flight requests', async () => {
  const { fetcher, calls } = make({ routes: { 'https://devpost.com/a': html('a') } });
  await Promise.all([fetcher.get('https://devpost.com/a'), fetcher.get('https://devpost.com/a')]);
  await fetcher.get('https://devpost.com/a');
  assert.equal(calls.filter((c) => c.url === 'https://devpost.com/a').length, 1);
});

test('rejects non-html, oversized and invalid responses', async () => {
  const { fetcher } = make({
    options: { maxBytes: 10 },
    routes: {
      'https://devpost.com/json': new Response('{}', { headers: { 'content-type': 'application/json' } }),
      'https://devpost.com/big': html('x'.repeat(100)),
    },
  });
  assert.equal((await fetcher.get('https://devpost.com/json')).error, 'not-html');
  const big = await fetcher.get('https://devpost.com/big');
  assert.equal(big.truncated, true);
  assert.equal(big.html.length, 10);
  assert.equal((await fetcher.get('http://devpost.com/x')).error, 'invalid-url');
});

test('stops at the session request budget', async () => {
  const { fetcher } = make({ options: { budget: 2 }, routes: { 'https://devpost.com/a': html('a'), 'https://devpost.com/b': html('b') } });
  assert.equal((await fetcher.get('https://devpost.com/a')).ok, true);
  assert.equal((await fetcher.get('https://devpost.com/b')).error, 'budget');
});

test('timeouts are reported as timeouts', async () => {
  const { fetcher } = make({
    options: { timeoutMs: 5 },
    routes: {
      'https://devpost.com/slow': () =>
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 20)),
    },
  });
  assert.equal((await fetcher.get('https://devpost.com/slow')).error, 'timeout');
});

test('scheduler spaces requests to the same origin', async () => {
  let t = 0;
  const waits = [];
  const s = createScheduler({ intervalFor: () => 1000, now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  await Promise.all([s.schedule('a', () => 1), s.schedule('a', () => 2), s.schedule('b', () => 3)]);
  assert.deepEqual(waits, [1000]);
});

test('robots parser: longest match wins, allow wins ties, other agents ignored', () => {
  const r = parseRobots(`
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /a
Allow: /a/public
Disallow: /*.pdf$
`);
  assert.equal(isAllowed(r, '/'), true);
  assert.equal(isAllowed(r, '/a/secret'), false);
  assert.equal(isAllowed(r, '/a/public/x'), true);
  assert.equal(isAllowed(r, '/doc.pdf'), false);
  assert.equal(isAllowed(r, '/doc.pdf?x'), true);
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow:'), '/x'), true);
});

test('a 429 is retried once after backing off', async () => {
  let n = 0;
  const { fetcher, calls } = make({
    routes: {
      'https://devpost.com/busy': () =>
        ++n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : html('ok'),
    },
  });
  const res = await fetcher.get('https://devpost.com/busy');
  assert.equal(res.ok, true);
  assert.equal(calls.filter((c) => c.url === 'https://devpost.com/busy').length, 2);
});

test('scheduler penalty delays the next start and slows the origin down', async () => {
  let t = 0;
  const waits = [];
  const s = createScheduler({ intervalFor: () => 100, now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  await s.schedule('a', () => 1);
  s.penalize('a', 5000);
  await s.schedule('a', () => 2);
  await s.schedule('a', () => 3);
  assert.deepEqual(waits, [5000, 200]);
  assert.equal(s.slowdownFor('a'), 2);
});

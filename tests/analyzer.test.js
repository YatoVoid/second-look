import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnalyzer } from '../src/lib/analyzer.js';
import { extractGalleryItems, extractProject } from '../src/lib/extract.js';
import { fakeFetchPage, loadDoc, parse } from './helpers.js';

function setup(opts = {}) {
  const fake = fakeFetchPage(opts.fetch);
  const updates = [];
  let resolveIdle;
  const idle = new Promise((r) => (resolveIdle = r));
  const analyzer = createAnalyzer({
    fetchPage: fake.fetchPage,
    parseHtml: (html, url) => parse(html, url),
    getDismissal: opts.getDismissal ?? (() => null),
    onUpdate: (e) => updates.push(e),
    onStatus: (s) => {
      if (s.status === 'done' && s.total > 0 && s.done === s.total) resolveIdle(s);
      opts.onStatus?.(s);
    },
    now: () => 1_800_000_000_000,
  });
  return { analyzer, fake, updates, idle };
}

const galleryItems = () => extractGalleryItems(loadDoc('gallery.html'), 'https://harbor-hack.devpost.com/project-gallery');

test('flags a project whose teammate profile lists a near-identical project', async () => {
  const { analyzer, idle } = setup();
  analyzer.add([galleryItems()[0]]);
  const state = await idle;
  assert.equal(state.flagged, 1);
  const [entry] = analyzer.entries();
  const finding = entry.result.findings[0];
  assert.equal(finding.kind, 'devpost-project');
  assert.equal(finding.source.url, 'https://devpost.com/software/tide-watch');
  assert.deepEqual(finding.source.hackathons, ['Gulf Hacks 2024']);
  assert.equal(finding.source.fetchedAt, 1_800_000_000_000);
  assert.match(finding.via, /Ana K/);
});

test('duplicate cards are analyzed once and both get the result', async () => {
  const { analyzer, fake, idle, updates } = setup();
  analyzer.add(galleryItems());
  await idle;
  assert.equal(analyzer.entries().length, 2);
  assert.equal(fake.calls.filter((u) => u === 'https://devpost.com/software/tidewatch').length, 1);
  const tide = analyzer.entries().find((e) => e.url.endsWith('/tidewatch'));
  assert.equal(tide.elements.size, 2);
  assert.ok(updates.includes(tide));
});

test('shared candidate projects and profiles are fetched once', async () => {
  const { analyzer, fake, idle } = setup();
  analyzer.add([galleryItems()[0]]);
  await idle;
  const counts = fake.calls.reduce((m, u) => m.set(u, (m.get(u) ?? 0) + 1), new Map());
  assert.equal(counts.get('https://devpost.com/software/tide-watch'), 1);
  assert.equal(counts.get('https://devpost.com/ana_k'), 1);
  assert.ok(!fake.calls.some((u) => u.includes('linkedin') || u.startsWith('http:')), 'never reads social or plain-http links');
});

test('unrelated past projects are not fetched in full', async () => {
  const { analyzer, fake, idle } = setup();
  analyzer.add([galleryItems()[0]]);
  await idle;
  assert.ok(!fake.calls.includes('https://devpost.com/software/pantry-pal'));
});

test('portfolio sites without permission are reported, not read', async () => {
  const { analyzer, idle } = setup({
    fetch: { overrides: { 'https://ana.example/projects': { ok: false, error: 'permission', origin: 'https://ana.example' } } },
  });
  analyzer.add([galleryItems()[0]]);
  const state = await idle;
  assert.deepEqual(state.pendingOrigins, ['https://ana.example']);
  const [entry] = analyzer.entries();
  assert.ok(entry.result.limitations.some((l) => /ana\.example was not checked because you have not allowed/.test(l)));
  assert.ok(entry.result.limitations.some((l) => /www\.linkedin\.com was skipped/.test(l)));
  assert.ok(entry.result.limitations.some((l) => /first page of Ana K/.test(l)));
});

test('failures become limitations, never flags', async () => {
  const { analyzer, idle } = setup({
    fetch: {
      overrides: {
        'https://devpost.com/ana_k': { ok: false, error: 'timeout' },
        'https://devpost.com/benr': { ok: false, error: 'http', status: 503 },
      },
    },
  });
  analyzer.add([galleryItems()[0]]);
  const state = await idle;
  assert.equal(state.flagged, 0);
  const [entry] = analyzer.entries();
  assert.ok(entry.result.limitations.some((l) => /Ana K's Devpost profile was not checked: the page took too long/.test(l)));
  assert.ok(entry.result.limitations.some((l) => /HTTP 503/.test(l)));
});

test('an unreadable project page is an error entry, not a flag', async () => {
  const { analyzer, idle } = setup({
    fetch: { overrides: { 'https://devpost.com/software/tidewatch': { ok: true, html: '<html><body>new layout</body></html>' } } },
  });
  analyzer.add([galleryItems()[0]]);
  const state = await idle;
  assert.equal(state.errors, 1);
  assert.equal(state.flagged, 0);
});

test('current project page is analyzed from the live DOM without refetching it', async () => {
  const { analyzer, fake, idle } = setup();
  const detail = extractProject(loadDoc('project-current.html'), 'https://devpost.com/software/tidewatch');
  analyzer.add([{ url: 'https://devpost.com/software/tidewatch', title: detail.title, detail, placement: 'header' }]);
  const state = await idle;
  assert.equal(state.flagged, 1);
  assert.ok(!fake.calls.includes('https://devpost.com/software/tidewatch'));
});

test('a dismissal hides the marker until a new source shows up', async () => {
  let record = { reason: 'same team, approved resubmission', candidates: ['https://devpost.com/software/tide-watch'], at: 1 };
  const { analyzer, idle } = setup({ getDismissal: () => record });
  analyzer.add([galleryItems()[0]]);
  const state = await idle;
  assert.equal(state.flagged, 0);
  assert.equal(state.dismissed, 1);
  record = { ...record, candidates: ['https://devpost.com/software/something-else'] };
  analyzer.refreshDismissals();
  assert.equal(analyzer.getState().flagged, 1);
});

test('pause holds the queue and resume finishes it', async () => {
  const statuses = [];
  const { analyzer, idle, fake } = setup({ fetch: { delay: 5 }, onStatus: (s) => statuses.push(s.status) });
  analyzer.pause();
  analyzer.add(galleryItems());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(fake.calls.length, 0);
  assert.equal(analyzer.getState().status, 'paused');
  analyzer.resume();
  const state = await idle;
  assert.equal(state.done, 2);
});

test('stop halts further requests', async () => {
  const { analyzer, fake } = setup({ fetch: { delay: 10 } });
  analyzer.add(galleryItems());
  await new Promise((r) => setTimeout(r, 15));
  analyzer.stop();
  const before = fake.calls.length;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fake.calls.length, before);
  assert.equal(analyzer.getState().status, 'stopped');
});

test('caps the number of projects per page', async () => {
  const fake = fakeFetchPage();
  const analyzer = createAnalyzer({ fetchPage: fake.fetchPage, parseHtml: parse, limits: { maxProjects: 1 } });
  analyzer.add(galleryItems());
  assert.equal(analyzer.getState().skipped, 1);
  analyzer.stop();
});

test('a permitted portfolio page that repeats the description is flagged with a dating caution', async () => {
  const copied = `<html><body><main><h2>Flood project</h2><p>Coastal neighborhoods often get less than an hour of warning before streets flood. We wanted residents to know about rising water before it reaches their doorstep, without relying on expensive municipal gauges.</p></main></body></html>`;
  const { analyzer, idle } = setup({ fetch: { overrides: { 'https://ana.example/projects': { ok: true, html: copied, fetchedAt: 5 } } } });
  analyzer.add([galleryItems()[0]]);
  await idle;
  const [entry] = analyzer.entries();
  const p = entry.result.findings.find((f) => f.kind === 'portfolio');
  assert.ok(p);
  assert.equal(p.source.url, 'https://ana.example/projects');
  assert.match(p.caution, /after the event/);
});

test('results stored earlier in the session are reused without any requests', async () => {
  const { analyzer, fake, updates } = setup();
  const stored = { flagged: true, findings: [{ source: { url: 'https://devpost.com/software/tide-watch' }, reasons: [], excerpts: [] }], limitations: [] };
  analyzer.add([{ ...galleryItems()[0], result: stored }]);
  assert.equal(fake.calls.length, 0);
  assert.equal(analyzer.getState().flagged, 1);
  assert.equal(updates[0].fromStore, true);
});

test('two projects are checked at the same time', async () => {
  let inFlight = 0;
  let peak = 0;
  const fake = fakeFetchPage();
  const analyzer = createAnalyzer({
    fetchPage: async (url) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return fake.fetchPage(url);
    },
    parseHtml: (html, url) => parse(html, url),
  });
  await new Promise((resolve) => {
    analyzer.add(galleryItems());
    const timer = setInterval(() => {
      if (analyzer.getState().status === 'done') {
        clearInterval(timer);
        resolve();
      }
    }, 5);
  });
  assert.equal(peak, 2);
});

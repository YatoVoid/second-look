import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_PAGES, isNextGalleryPage, recordPage, startRun, stopRun, summarizeEntry } from '../src/lib/full-review.js';

const START = 'https://harbor-hack.devpost.com/project-gallery';
const page = (n, extra = {}) => ({
  url: n === 1 ? START : `${START}?page=${n}`,
  page: n,
  nextUrl: `${START}?page=${n + 1}`,
  checked: 24,
  flagged: [],
  dismissed: 0,
  errors: 0,
  pendingOrigins: [],
  ...extra,
});

test('walks pages and finishes on the last one', () => {
  let run = startRun({ tabId: 7, url: START, now: 1 });
  let r = recordPage(run, page(1, { flagged: [{ url: 'https://devpost.com/software/a', title: 'A', findings: [] }] }), 2);
  assert.equal(r.next, `${START}?page=2`);
  run = r.run;
  r = recordPage(run, page(2, { nextUrl: null, checked: 3, pendingOrigins: ['https://ana.example'] }), 3);
  assert.equal(r.next, null);
  assert.equal(r.run.status, 'done');
  assert.equal(r.run.endReason, 'last-page');
  assert.equal(r.run.checked, 27);
  assert.equal(r.run.flagged[0].page, 1);
  assert.deepEqual(r.run.pendingOrigins, ['https://ana.example']);
  assert.equal(r.run.finishedAt, 3);
});

test('a reloaded page is counted once', () => {
  let run = startRun({ tabId: 7, url: START, now: 1 });
  run = recordPage(run, page(1, { errors: 1 }), 2).run;
  run = recordPage(run, page(1, { errors: 1 }), 3).run;
  assert.equal(run.pages.length, 1);
  assert.equal(run.errors, 1);
  assert.equal(run.checked, 24);
});

test('never follows a next link out of the gallery or back to a visited page', () => {
  let run = startRun({ tabId: 7, url: START, now: 1 });
  assert.equal(recordPage(run, page(1, { nextUrl: 'https://evil.example/project-gallery?page=2' }), 2).run.endReason, 'left-gallery');
  assert.equal(recordPage(run, page(1, { nextUrl: 'https://other.devpost.com/project-gallery?page=2' }), 2).run.endReason, 'left-gallery');
  run = recordPage(run, page(1), 2).run;
  assert.equal(recordPage(run, page(2, { nextUrl: START }), 3).run.endReason, 'loop');
});

test('stops at the page limit', () => {
  let run = startRun({ tabId: 7, url: START, now: 1 });
  let r;
  for (let n = 1; n <= MAX_PAGES; n++) {
    r = recordPage(run, page(n), n);
    run = r.run;
  }
  assert.equal(r.next, null);
  assert.equal(run.endReason, 'page-limit');
});

test('stopped runs ignore late page reports', () => {
  const run = stopRun(startRun({ tabId: 7, url: START, now: 1 }), 5);
  assert.equal(run.endReason, 'stopped');
  const r = recordPage(run, page(1), 6);
  assert.equal(r.next, null);
  assert.equal(r.run.pages.length, 0);
});

test('next-page check', () => {
  assert.ok(isNextGalleryPage(`${START}?page=3`, START));
  assert.ok(!isNextGalleryPage('https://harbor-hack.devpost.com/updates', START));
  assert.ok(!isNextGalleryPage('javascript:alert(1)', START));
  const filtered = 'https://harbor-hack.devpost.com/submissions/search?prize_filter[prizes][]=1';
  assert.ok(isNextGalleryPage(`${filtered}&page=2`, filtered));
  assert.ok(!isNextGalleryPage('https://harbor-hack.devpost.com/project-gallery?page=2', filtered), 'filtered runs stay filtered');
  assert.ok(isNextGalleryPage('https://harbor-hack.devpost.com/project-gallery?page=2', 'https://harbor-hack.devpost.com/submissions'));
});

test('summaries keep one excerpt per finding', () => {
  const s = summarizeEntry({
    url: 'u',
    title: 't',
    result: { findings: [{ kind: 'devpost-project', source: { url: 's', title: 'S', fetchedAt: 1 }, via: 'v', reasons: ['r'], excerpts: ['a', 'b'] }] },
  });
  assert.deepEqual(s.findings[0], { kind: 'devpost-project', source: { url: 's', title: 'S', hackathons: [] }, via: 'v', reasons: ['r'], excerpt: 'a' });
});

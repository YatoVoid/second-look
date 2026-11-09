import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavList, galleryKey, isOpenFlag } from '../src/lib/flag-nav.js';

test('gallery key ignores the page number and treats the plain gallery and submissions as one', () => {
  const base = 'https://harbor-hack.devpost.com/project-gallery';
  assert.equal(galleryKey(`${base}?page=4`), base);
  assert.equal(galleryKey('https://harbor-hack.devpost.com/submissions?page=2'), base);
  const a = galleryKey('https://harbor-hack.devpost.com/submissions/search?utf8=%E2%9C%93&prize_filter[prizes][]=1&page=3');
  const b = galleryKey('https://harbor-hack.devpost.com/submissions/search?prize_filter[prizes][]=1');
  assert.equal(a, b);
  assert.notEqual(a, base);
  assert.notEqual(a, galleryKey('https://harbor-hack.devpost.com/submissions/search?prize_filter[prizes][]=2'));
  assert.notEqual(galleryKey(`${base}?page=1`), galleryKey('https://other.devpost.com/project-gallery'));
  assert.equal(galleryKey('https://devpost.com/software/x'), null);
});

test('open flags exclude dismissed and hidden ones', () => {
  assert.ok(isOpenFlag({ result: { flagged: true } }));
  assert.ok(!isOpenFlag({ result: { flagged: true, dismissed: true } }));
  assert.ok(!isOpenFlag({ result: { flagged: true }, hidden: true }));
  assert.ok(!isOpenFlag({ result: { flagged: false } }));
  assert.ok(!isOpenFlag(null));
});

test('nav list runs across pages in page order, with this page taken from the screen', () => {
  const others = [
    { url: 'p5b', page: 5, pos: 9, pageUrl: 'g?page=5' },
    { url: 'p1a', page: 1, pos: 3, pageUrl: 'g?page=1' },
    { url: 'p5a', page: 5, pos: 2, pageUrl: 'g?page=5' },
    { url: 'stale', page: 3, pos: 0, pageUrl: 'g?page=3' },
  ];
  const here = [{ url: 'p3x' }, { url: 'p3y' }];
  const list = buildNavList({ here, others, currentPage: 3 });
  assert.deepEqual(list.map((x) => x.url), ['p1a', 'p3x', 'p3y', 'p5a', 'p5b']);
  assert.deepEqual(list.map((x) => x.here), [false, true, true, false, false]);
});

test('a project stored on another page but shown here is not listed twice', () => {
  const list = buildNavList({ here: [{ url: 'a' }], others: [{ url: 'a', page: 2, pos: 0 }], currentPage: 1 });
  assert.deepEqual(list.map((x) => [x.url, x.here]), [['a', true]]);
});

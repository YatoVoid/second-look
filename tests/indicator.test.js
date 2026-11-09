import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createIndicators, DISCLAIMER } from '../src/content/indicator.js';
import { describeState } from '../src/content/status-chip.js';

function setup() {
  const dom = new JSDOM('<div class="gallery-item"><a class="link-to-software" href="#">card</a></div>', { url: 'https://devpost.com/software' });
  const doc = dom.window.document;
  const card = doc.querySelector('.gallery-item');
  const calls = { dismiss: [], hide: [] };
  const ui = createIndicators(doc, {
    onDismiss: (e, reason) => calls.dismiss.push([e.url, reason]),
    onHide: (e) => calls.hide.push(e.url),
  });
  return { dom, doc, card, ui, calls };
}

const entry = (card, result) => ({
  url: 'https://devpost.com/software/tidewatch',
  title: 'TideWatch',
  placement: 'card',
  elements: new Set([card]),
  result,
});

const flagged = () => ({
  flagged: true,
  dismissed: null,
  findings: [
    {
      kind: 'devpost-project',
      source: { url: 'https://devpost.com/software/tide-watch', title: '<img src=x onerror=alert(1)>', hackathons: ['Gulf Hacks 2024'], fetchedAt: 1 },
      via: "Listed on Ana K's Devpost profile",
      reasons: ['Shares one 40-word run of identical wording.'],
      excerpts: ['<script>alert(1)</script> coastal neighborhoods'],
    },
    {
      kind: 'portfolio',
      source: { url: 'javascript:alert(1)', title: 'Bad link', fetchedAt: 1 },
      via: 'Linked from profile',
      reasons: ['r'],
      excerpts: [],
      caution: 'Check dates.',
    },
  ],
  limitations: ['ana.example was not checked.'],
});

test('only flagged projects get a marker', () => {
  const { card, ui } = setup();
  ui.render(entry(card, { flagged: false, findings: [], limitations: [] }));
  assert.equal(ui._rootFor(card), null);
  ui.render(entry(card, flagged()));
  assert.ok(ui._rootFor(card));
});

test('marker is an accessible button outside the card link', () => {
  const { card, ui } = setup();
  ui.render(entry(card, flagged()));
  const root = ui._rootFor(card);
  const button = root.querySelector('button.flag');
  assert.equal(button.textContent, 'CHECK AGAIN2');
  assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
  assert.match(button.getAttribute('aria-label'), /TideWatch: similar text found in 2 other pages/);
  assert.equal(card.querySelector('second-look-indicator').closest('a'), null);
});

test('evidence is rendered as text and unsafe links are dropped', () => {
  const { card, ui } = setup();
  ui.render(entry(card, flagged()));
  const root = ui._rootFor(card);
  assert.equal(root.querySelectorAll('img, script').length, 0);
  const links = [...root.querySelectorAll('a')];
  assert.equal(links[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.equal(links[1].hasAttribute('href'), false);
  assert.ok(root.textContent.includes(DISCLAIMER));
  assert.ok(root.textContent.includes('Gulf Hacks 2024'));
  assert.ok(root.textContent.includes('ana.example was not checked.'));
  assert.ok(root.textContent.includes('Check dates.'));
  assert.doesNotMatch(root.textContent, /cheat|plagiar|score|\u2014/i);
});

test('opening, dismissing with a reason, and hiding', () => {
  const { card, ui, calls, dom } = setup();
  ui.render(entry(card, flagged()));
  const root = ui._rootFor(card);
  root.querySelector('button.flag').click();
  const dialog = root.querySelector('dialog');
  assert.ok(dialog.open || dialog.hasAttribute('open'));
  root.querySelector('textarea').value = 'Approved resubmission';
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'DDismiss').click();
  assert.deepEqual(calls.dismiss, [['https://devpost.com/software/tidewatch', 'Approved resubmission']]);
  assert.equal(dialog.hasAttribute('open'), false);

  root.querySelector('button.flag').click();
  dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dialog.hasAttribute('open'), false);

  [...root.querySelectorAll('button')].find((b) => b.textContent === 'HHide').click();
  assert.deepEqual(calls.hide, ['https://devpost.com/software/tidewatch']);
});

test('dismissed or hidden results remove the marker', () => {
  const { card, ui } = setup();
  const e = entry(card, flagged());
  ui.render(e);
  e.result.dismissed = { reason: '' };
  ui.render(e);
  assert.equal(ui._rootFor(card), null);
  assert.equal(card.querySelector('second-look-indicator'), null);
});

test('status text', () => {
  assert.equal(describeState({ status: 'running', done: 2, total: 10, flagged: 1 }), 'Checking 3/10  1 flagged');
  assert.equal(describeState({ status: 'done', done: 10, total: 10, flagged: 0 }, { current: 2, last: 5, countdown: 3 }), 'Pg 2/5  0 flagged  Next page in 3s');
});

test('H and D keys work in the panel but not while typing a note', () => {
  const { card, ui, calls, dom } = setup();
  ui.render(entry(card, flagged()));
  const root = ui._rootFor(card);
  const dialog = root.querySelector('dialog');
  root.querySelector('button.flag').click();
  root.querySelector('textarea').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'h', bubbles: true }));
  assert.deepEqual(calls.hide, []);
  dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'h', bubbles: true }));
  assert.deepEqual(calls.hide, ['https://devpost.com/software/tidewatch']);
});

test('flag stepping works like find-next: first press lands on the first flag, then wraps', async () => {
  const { stepIndex, navLabel } = await import('../src/content/status-chip.js');
  assert.equal(stepIndex(-1, 3, 1), 0);
  assert.equal(stepIndex(-1, 3, -1), 2);
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(5, 3, 1), 0, 'a flag that went away restarts from the top');
  assert.equal(stepIndex(-1, 0, 1), -1);
  assert.equal(navLabel(-1, 4), '0/4');
  assert.equal(navLabel(1, 4), '2/4');
});

test('flags are listed in page order and goTo marks only the current one', () => {
  const dom = new JSDOM('<div class="a"></div><div class="b"></div><div class="c"></div>', { url: 'https://devpost.com/software' });
  const doc = dom.window.document;
  const [a, b, c] = ['.a', '.b', '.c'].map((s) => doc.querySelector(s));
  let changes = 0;
  const ui = createIndicators(doc, { onDismiss() {}, onHide() {}, onChange: () => changes++ });
  for (const el of [c, a, b]) ui.render(entry(el, flagged()));
  assert.deepEqual(ui.list(), [a, b, c]);
  assert.equal(ui.urlOf(b), 'https://devpost.com/software/tidewatch');
  assert.equal(changes, 3);
  ui.goTo(b);
  const isCurrent = (el) => ui._rootFor(el).querySelector('button.flag').classList.contains('current');
  assert.deepEqual([a, b, c].map(isCurrent), [false, true, false]);
  ui.goTo(c);
  assert.deepEqual([a, b, c].map(isCurrent), [false, false, true]);
});

test('status bar rises above a taskbar that covers the window bottom', async () => {
  const { bottomOffset } = await import('../src/content/status-chip.js');
  assert.equal(bottomOffset({ screenY: 0, outerHeight: 1032, availTop: 0, availHeight: 1032 }), 16);
  assert.equal(bottomOffset({ screenY: 0, outerHeight: 1080, availTop: 0, availHeight: 1032 }), 64);
  assert.equal(bottomOffset({ screenY: -8, outerHeight: 1048, availTop: 0, availHeight: 1032 }), 24);
  assert.equal(bottomOffset({ screenY: 100, outerHeight: 600, availTop: 0, availHeight: 1032 }), 16);
  assert.equal(bottomOffset({ screenY: 0, outerHeight: 5000, availTop: 0, availHeight: 1032 }), 256);
  assert.equal(bottomOffset({ screenY: undefined, outerHeight: 1080, availTop: 0, availHeight: 1032 }), 16);
  assert.equal(bottomOffset({ screenY: 0, outerHeight: 1080, availTop: 0, availHeight: 0 }), 16);
});

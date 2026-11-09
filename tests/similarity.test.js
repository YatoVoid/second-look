import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractProject } from '../src/lib/extract.js';
import { cardLooksRelated, compare, prepare, sharedSpans, titleSimilarity } from '../src/lib/similarity.js';
import { isTemplateHeading } from '../src/lib/text.js';
import { loadDoc } from './helpers.js';

const prep = (name) => {
  const p = extractProject(loadDoc(name), 'https://devpost.com/');
  return prepare(`${p.tagline}\n${p.description}`, p.title);
};

test('near-identical descriptions flag with readable reasons and excerpts', () => {
  const r = compare(prep('project-current.html'), prep('project-old.html'));
  assert.equal(r.flag, true);
  assert.ok(r.reasons.some((x) => /identical/.test(x)));
  assert.ok(r.reasons.some((x) => /close titles|titles are close/i.test(x)));
  assert.ok(r.excerpts.some((e) => e.includes('coastal neighborhoods often get less than an hour of warning')));
  assert.ok(r.excerpts.every((e) => e.length <= 243));
});

test('related topic and shared stack do not flag on their own', () => {
  const r = compare(prep('project-current.html'), prep('project-unrelated.html'));
  assert.equal(r.flag, false);
  assert.deepEqual(r.reasons, []);
});

test('a matching title alone never flags', () => {
  const a = prepare('We built a habit tracker for nurses on night shifts that syncs with their rota.', 'Pulse');
  const b = prepare('A rhythm game where you tap along to procedurally generated drum patterns.', 'Pulse');
  assert.equal(titleSimilarity(a.titleKey, b.titleKey), 1);
  assert.equal(compare(a, b).flag, false);
});

test('generic phrasing shared across many projects is ignored', () => {
  const boiler = 'this project was built during a weekend hackathon by a team of four computer science students';
  const a = prepare(`${boiler} who wanted to help local food banks schedule volunteers more fairly across shifts.`, 'Shift');
  const b = prepare(`${boiler} who wanted to map accessible entrances for wheelchair users around campus buildings.`, 'Ramp');
  assert.equal(compare(a, b).flag, true, 'a long shared run flags without context');
  const generic = new Set(sharedSpansKeys(a, b));
  assert.equal(compare(a, b, { generic }).flag, false);
});

function sharedSpansKeys(a, b) {
  return [...a.shingles.keys()].filter((k) => b.shingles.has(k));
}

test('short texts need a long verbatim run', () => {
  const a = prepare('Flood alerts for coastal neighborhoods using sensors.', 'A');
  const b = prepare('Flood alerts for coastal neighborhoods using drones.', 'B');
  assert.equal(compare(a, b).flag, false);
  const long = 'real time flood alerts for coastal neighborhoods using cheap ultrasonic water level sensors under storm drains';
  assert.equal(compare(prepare(long, 'A'), prepare(long, 'B')).flag, true);
});

test('spans merge overlapping shingles into one run', () => {
  const t = 'the quick brown fox jumps over the lazy sleeping dog near quiet riverbank tonight';
  const { spans } = sharedSpans(prepare(t), prepare(`unrelated start ${t} unrelated end`));
  assert.equal(spans.length, 1);
  assert.equal(spans[0].words, t.split(' ').length);
});

test('profile card pre-check picks the related card only', () => {
  const current = prep('project-current.html');
  assert.equal(cardLooksRelated(current, { title: 'Tide Watch', tagline: 'Early flood warnings for coastal streets.' }).related, true);
  assert.equal(cardLooksRelated(current, { title: 'Pantry Pal', tagline: 'Track what is in your pantry.' }).related, false);
});

test('template headings are recognized', () => {
  assert.ok(isTemplateHeading("What's next for TideWatch"));
  assert.ok(isTemplateHeading('Accomplishments that we’re proud of'));
  assert.ok(!isTemplateHeading('Hardware design'));
});

test('README examples give the reasons the README quotes', () => {
  const cases = JSON.parse(readFileSync(new URL('./fixtures/examples.json', import.meta.url), 'utf8'));
  const run = ([a, b]) => compare(prepare(a.text, a.title), prepare(b.text, b.title));
  assert.deepEqual(run(cases.resubmitted).reasons, [
    '2 identical passages, the longest 63 words.',
    "91% of the shorter text's 6-word phrases also appear in the other.",
    'Close titles ("ShelfLife", "Shelf Life") and mostly the same vocabulary.',
  ]);
  assert.deepEqual(run(cases.portfolio).reasons, [
    '5 identical passages, the longest 25 words.',
    "38% of the shorter text's 6-word phrases also appear in the other.",
  ]);
  assert.deepEqual(run(cases.reworded).reasons, [
    '4 identical passages, the longest 17 words.',
    "46% of the shorter text's 6-word phrases also appear in the other.",
  ]);
  const clean = run(cases.clean);
  assert.equal(clean.flag, false);
  assert.equal(Math.round(clean.signals.title * 100), 62);
});

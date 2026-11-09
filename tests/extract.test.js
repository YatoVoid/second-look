import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractGalleryItems,
  extractPagination,
  extractPortfolioBlocks,
  extractProfile,
  extractProject,
  hasGalleryStructure,
  hasProjectStructure,
} from '../src/lib/extract.js';
import { loadDoc } from './helpers.js';

test('gallery: finds project cards, normalizes links, ignores non-project links', () => {
  const doc = loadDoc('gallery.html', 'https://harbor-hack.devpost.com/project-gallery');
  assert.ok(hasGalleryStructure(doc));
  const items = extractGalleryItems(doc, 'https://harbor-hack.devpost.com/project-gallery');
  assert.deepEqual(items.map((i) => i.url), [
    'https://devpost.com/software/tidewatch',
    'https://devpost.com/software/study-buddy',
    'https://devpost.com/software/tidewatch',
  ]);
  assert.equal(items[0].title, 'TideWatch');
});

test('gallery text is read as text, scripts are not run', () => {
  const doc = loadDoc('gallery.html');
  const [, study] = extractGalleryItems(doc, 'https://devpost.com/');
  assert.equal(study.tagline, 'Flashcards that alert(1)adapt to you.');
});

test('project: description drops gallery, template headings, built-with and links', () => {
  const doc = loadDoc('project-current.html', 'https://devpost.com/software/tidewatch');
  assert.ok(hasProjectStructure(doc));
  const p = extractProject(doc, 'https://devpost.com/software/tidewatch');
  assert.equal(p.title, 'TideWatch');
  assert.match(p.tagline, /^Flood alerts/);
  assert.match(p.description, /^Coastal neighborhoods/);
  assert.doesNotMatch(p.description, /Inspiration|What it does|What's next|Screenshot caption|esp32\n|github\.com|pwned/);
  assert.deepEqual(p.hackathons, ['Harbor Hack 2026']);
});

test('project: team is de-duplicated and resolved to profile URLs', () => {
  const p = extractProject(loadDoc('project-current.html'), 'https://devpost.com/software/tidewatch');
  assert.deepEqual(p.team, [
    { name: 'Ana K', profileUrl: 'https://devpost.com/ana_k' },
    { name: 'Ben R', profileUrl: 'https://devpost.com/benr' },
  ]);
});

test('profile: links, projects, and pagination', () => {
  const p = extractProfile(loadDoc('profile-ana.html'), 'https://devpost.com/ana_k');
  assert.equal(p.name, 'Ana K');
  assert.deepEqual(p.links, ['https://ana.example/projects', 'https://www.linkedin.com/in/ana', 'http://old-site.example/']);
  assert.equal(p.projects.length, 3);
  assert.equal(p.hasMoreProjects, true);
});

test('portfolio: heading-led blocks without nav, footer or scripts', () => {
  const blocks = extractPortfolioBlocks(loadDoc('portfolio-ana.html', 'https://ana.example/projects'));
  assert.deepEqual(blocks.map((b) => b.title), ['Pantry Pal', 'Weather station']);
  assert.ok(blocks.every((b) => !/Copyright|weekends|evil/.test(b.text)));
});

test('unknown layouts are recognized as unknown', () => {
  const doc = loadDoc('unknown.html');
  assert.equal(hasGalleryStructure(doc), false);
  assert.equal(hasProjectStructure(doc), false);
});

test('pagination: next link on the first page, none on the last', () => {
  const base = 'https://harbor-hack.devpost.com/project-gallery';
  const first = extractPagination(loadDoc('gallery.html', base), base);
  assert.deepEqual(first, { current: 1, last: 2, total: 6, nextUrl: 'https://harbor-hack.devpost.com/project-gallery?page=2' });
  const last = extractPagination(loadDoc('gallery-2.html', `${base}?page=2`), `${base}?page=2`);
  assert.deepEqual(last, { current: 2, last: 2, total: 6, nextUrl: null });
  assert.deepEqual(extractPagination(loadDoc('unknown.html', base), base), { current: 1, last: 1, total: null, nextUrl: null });
});

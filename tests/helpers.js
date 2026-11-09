import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(name) {
  return readFileSync(join(here, 'fixtures', name), 'utf8');
}

export function parse(html, url = 'https://devpost.com/') {
  return new JSDOM(html, { url }).window.document;
}

export function loadDoc(name, url) {
  return parse(fixture(name), url);
}

export const FIXTURE_URLS = {
  'https://devpost.com/software/tidewatch': 'project-current.html',
  'https://devpost.com/software/tide-watch': 'project-old.html',
  'https://devpost.com/software/pantry-pal': 'project-unrelated.html',
  'https://devpost.com/ana_k': 'profile-ana.html',
  'https://devpost.com/benr': 'profile-ben.html',
  'https://ana.example/projects': 'portfolio-ana.html',
};

export function fakeFetchPage({ overrides = {}, delay = 0 } = {}) {
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (url in overrides) return overrides[url];
    const name = FIXTURE_URLS[url];
    if (!name) return { ok: false, error: 'http', status: 404 };
    return { ok: true, html: fixture(name), fetchedAt: 1_800_000_000_000 };
  };
  return { fetchPage, calls };
}

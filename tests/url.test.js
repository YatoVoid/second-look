import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPage, normalizeProfileUrl, normalizeProjectUrl, parseHttpsUrl, portfolioTarget } from '../src/lib/url.js';

test('classifies supported Devpost pages', () => {
  assert.equal(classifyPage('https://harbor-hack.devpost.com/project-gallery').kind, 'gallery');
  assert.equal(classifyPage('https://harbor-hack.devpost.com/project-gallery?page=2').kind, 'gallery');
  assert.equal(classifyPage('https://hackutd-zeroday.devpost.com/submissions').kind, 'gallery');
  assert.equal(
    classifyPage('https://hackutd-zeroday.devpost.com/submissions/search?utf8=%E2%9C%93&prize_filter[prizes][]=108674').kind,
    'gallery',
  );
  assert.equal(classifyPage('https://devpost.com/software').kind, 'listing');
  assert.equal(classifyPage('https://devpost.com/software/search?query=ai').kind, 'listing');
  assert.equal(classifyPage('https://devpost.com/software/tidewatch').kind, 'project');
  assert.equal(classifyPage('https://devpost.com/software/tidewatch/').kind, 'project');
});

test('rejects everything else', () => {
  for (const url of [
    'http://devpost.com/software/tidewatch',
    'https://devpost.com/ana_k',
    'https://devpost.com/software/built-with/react',
    'https://devpost.com/hackathons',
    'https://secure.devpost.com/project-gallery',
    'https://harbor-hack.devpost.com/submissions/123',
    'https://harbor-hack.devpost.com/submissions/search/extra',
    'https://evil-devpost.com/software/x',
    'https://devpost.com.evil.example/software/x',
    'https://harbor-hack.devpost.com/',
    'chrome://extensions',
    'not a url',
  ]) {
    assert.equal(classifyPage(url).kind, 'unsupported', url);
  }
});

test('normalizes project and profile links', () => {
  assert.equal(normalizeProjectUrl('/software/TideWatch/', 'https://devpost.com/'), 'https://devpost.com/software/tidewatch');
  assert.equal(normalizeProjectUrl('https://devpost.com/software/built-with/css'), null);
  assert.equal(normalizeProjectUrl('https://example.com/software/x'), null);
  assert.equal(normalizeProfileUrl('/benr', 'https://devpost.com/software/x'), 'https://devpost.com/benr');
  assert.equal(normalizeProfileUrl('https://devpost.com/software'), null);
  assert.equal(normalizeProfileUrl('https://devpost.com/a/b'), null);
});

test('refuses credentials and non-https URLs', () => {
  assert.equal(parseHttpsUrl('https://user:pw@devpost.com/'), null);
  assert.equal(parseHttpsUrl('javascript:alert(1)'), null);
  assert.equal(parseHttpsUrl('x'.repeat(3000)), null);
});

test('portfolio targets skip social networks, plain http and Devpost', () => {
  assert.equal(portfolioTarget('https://ana.example/p#top').url, 'https://ana.example/p');
  assert.match(portfolioTarget('https://www.linkedin.com/in/ana').skip, /social/);
  assert.match(portfolioTarget('https://x.com/ana').skip, /social/);
  assert.match(portfolioTarget('http://ana.example/').skip, /HTTPS/);
  assert.ok(portfolioTarget('https://devpost.com/ana').skip);
  assert.ok(portfolioTarget('javascript:alert(1)').skip);
  assert.ok(portfolioTarget('https://notx.com/').url, 'suffix match must respect the dot');
});

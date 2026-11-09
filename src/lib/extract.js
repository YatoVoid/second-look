import { collapse, isTemplateHeading } from './text.js';
import { normalizeProfileUrl, normalizeProjectUrl, parseHttpsUrl } from './url.js';

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dd, dt, figcaption';
const HEADING = /^H[1-6]$/;
const MAX_TEXT = 20_000;

export function blockTexts(root) {
  if (!root) return [];
  const out = [];
  for (const el of root.querySelectorAll(BLOCK_SELECTOR)) {
    if (el.querySelector(BLOCK_SELECTOR)) continue;
    if (el.closest('script, style, noscript, template')) continue;
    const text = collapse(el.textContent);
    if (text) out.push({ text, heading: HEADING.test(el.tagName) });
  }
  if (!out.length) {
    const text = collapse(root.textContent);
    if (text) out.push({ text, heading: false });
  }
  return out;
}

export function hasGalleryStructure(doc) {
  return !!doc.querySelector('.gallery-item a.link-to-software[href]');
}

export function hasProjectStructure(doc) {
  return !!doc.querySelector('#app-title') && !!doc.querySelector('#app-details-left');
}

export function hasProfileStructure(doc) {
  return !!doc.querySelector('#portfolio-user-name, #portfolio-header');
}

function galleryCards(scope, base) {
  const out = [];
  for (const item of scope.querySelectorAll('.gallery-item')) {
    const link = item.querySelector('a.link-to-software[href]');
    const url = link && normalizeProjectUrl(link.getAttribute('href'), base);
    if (!url) continue;
    out.push({
      url,
      title: collapse(item.querySelector('h5')?.textContent),
      tagline: collapse(item.querySelector('.tagline')?.textContent),
      element: item,
    });
  }
  return out;
}

export function extractGalleryItems(doc, base) {
  return galleryCards(doc, base);
}

export function extractPagination(doc, base) {
  const nav = doc.querySelector('ul.pagination');
  const info = collapse(doc.querySelector('.pagination-info .items_info')?.textContent);
  const m = info.match(/(\d[\d,]*)\D+?(\d[\d,]*)\s+of\s+(\d[\d,]*)/);
  const num = (s) => Number(s.replace(/,/g, ''));
  const current = Number(collapse(nav?.querySelector('li.current')?.textContent)) || 1;
  const linked = [...(nav?.querySelectorAll('li a') ?? [])]
    .map((a) => Number(collapse(a.textContent)))
    .filter((n) => Number.isInteger(n) && n > 0);
  const total = m ? num(m[3]) : null;
  // the last page can be short
  const perPage = m && num(m[2]) < num(m[3]) ? num(m[2]) - num(m[1]) + 1 : null;
  const last = Math.max(current, ...linked, total && perPage ? Math.ceil(total / perPage) : 0);
  const href = nav?.querySelector('li.next_page:not(.unavailable) a[href], li.next:not(.unavailable) a[href]')?.getAttribute('href');
  const nextUrl = href && href !== '#' ? (parseHttpsUrl(href, base)?.href ?? null) : null;
  return { current, last, total, nextUrl };
}

export function extractProject(doc, base) {
  const left = doc.querySelector('#app-details-left');
  const parts = [];
  let length = 0;
  for (const child of left?.children ?? []) {
    if (child.id === 'gallery' || child.id === 'built-with') continue;
    if (child.matches('.app-links, script, style, iframe, noscript')) continue;
    for (const b of blockTexts(child)) {
      if (b.heading && isTemplateHeading(b.text)) continue;
      if (length + b.text.length > MAX_TEXT) break;
      parts.push(b.text);
      length += b.text.length;
    }
  }

  const team = [];
  const seen = new Set();
  for (const member of doc.querySelectorAll('#app-team .software-team-member')) {
    const links = [...member.querySelectorAll('a.user-profile-link[href]')];
    const profileUrl = links.map((a) => normalizeProfileUrl(a.getAttribute('href'), base)).find(Boolean);
    const name = links.map((a) => collapse(a.textContent)).find(Boolean) ?? '';
    if (!profileUrl || seen.has(profileUrl)) continue;
    seen.add(profileUrl);
    team.push({ name: name || profileUrl.split('/').pop(), profileUrl });
  }

  return {
    title: collapse(doc.querySelector('#app-title')?.textContent),
    tagline: collapse(doc.querySelector('#software-header p.large, #app-title + p')?.textContent),
    description: parts.join('\n'),
    team,
    hackathons: [...doc.querySelectorAll('#submissions .software-list-content > p a')]
      .map((a) => collapse(a.textContent))
      .filter(Boolean),
  };
}

export function extractProfile(doc, base) {
  const nameEl = doc.querySelector('#portfolio-user-name');
  const name = collapse([...(nameEl?.childNodes ?? [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
  const links = [];
  for (const a of doc.querySelectorAll('#portfolio-user-links a[href]')) {
    const href = a.getAttribute('href');
    try {
      const u = new URL(href, base);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !links.includes(u.href)) links.push(u.href);
    } catch {}
  }
  const scope = doc.querySelector('#software-entries') ?? doc;
  const pager = doc.querySelector('.pagination-centered, .pagination');
  const hasMoreProjects = !!pager?.querySelector('a[rel="next"], .next:not(.unavailable) a');
  return {
    name,
    links,
    projects: galleryCards(scope, base).map(({ url, title, tagline }) => ({ url, title, tagline })),
    hasMoreProjects,
  };
}

export function extractPortfolioBlocks(doc) {
  for (const n of doc.querySelectorAll('script, style, noscript, template, nav, footer, form, svg, iframe')) n.remove();
  const blocks = [];
  for (const pin of doc.querySelectorAll('.pinned-item-list-item')) {
    const text = collapse(pin.querySelector('.pinned-item-desc')?.textContent);
    if (text) blocks.push({ title: collapse(pin.querySelector('.repo')?.textContent), text });
  }
  const main = doc.querySelector('main, [role="main"]') ?? doc.body;
  let current = null;
  for (const b of blockTexts(main)) {
    if (b.heading) {
      if (current?.text) blocks.push(current);
      current = { title: b.text.slice(0, 200), text: '' };
    } else {
      current ??= { title: '', text: '' };
      if (current.text.length < 6000) current.text = current.text ? `${current.text} ${b.text}` : b.text;
    }
  }
  if (current?.text) blocks.push(current);
  return blocks.filter((b) => b.text.length >= 40).slice(0, 40);
}

export function safeHttpsHref(raw) {
  return parseHttpsUrl(raw)?.href ?? null;
}

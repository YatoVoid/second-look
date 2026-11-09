import { isGalleryPath, parseHttpsUrl } from './url.js';

const IGNORED_PARAMS = new Set(['page', 'utf8']);

export function galleryKey(href) {
  const u = parseHttpsUrl(href);
  if (!u || !isGalleryPath(u.pathname)) return null;
  const path = u.pathname.replace(/\/+$/, '');
  if (path !== '/submissions/search') return `${u.origin}/project-gallery`;
  const params = [...u.searchParams].filter(([k]) => !IGNORED_PARAMS.has(k)).sort(([a, av], [b, bv]) => (a + av < b + bv ? -1 : 1));
  return `${u.origin}/submissions/search?${new URLSearchParams(params)}`;
}

export function isOpenFlag(record) {
  return !!(record?.result?.flagged && !record.result.dismissed && !record.hidden);
}

export function buildNavList({ here, others, currentPage }) {
  const rest = others
    .filter((o) => o.page !== currentPage && !here.some((h) => h.url === o.url))
    .map((o) => ({ ...o, here: false }));
  const local = here.map((h, i) => ({ ...h, page: currentPage, pos: i, here: true }));
  const seen = new Set();
  return [...local, ...rest]
    .sort((a, b) => a.page - b.page || a.pos - b.pos)
    .filter((x) => (seen.has(x.url) ? false : seen.add(x.url)));
}

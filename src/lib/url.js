export const DEVPOST_ORIGINS = ['https://devpost.com/*', 'https://*.devpost.com/*'];
export const ALL_SITES = ['https://*/*'];
export const GALLERY_PATHS = new Set(['/project-gallery', '/submissions', '/submissions/search']);

export function isGalleryPath(pathname) {
  return GALLERY_PATHS.has(pathname.replace(/\/+$/, '') || '/');
}

export const DONATE_URL = 'https://buymeacoffee.com/walilambere';

const LISTING_PATHS = new Set([
  '/software',
  '/software/popular',
  '/software/newest',
  '/software/trending',
  '/software/search',
]);

const RESERVED_SOFTWARE_SLUGS = new Set(['built-with', 'search', 'popular', 'newest', 'trending', 'new']);

const NON_HACKATHON_SUBDOMAINS = new Set(['www', 'secure', 'info', 'help', 'api', 'assets', 'blog', 'manage']);

const NOT_PROFILE_SEGMENTS = new Set([
  'software', 'hackathons', 'users', 'settings', 'portfolio', 'about', 'contact', 'help', 'api',
  'search', 'teams', 'notifications', 'challenges', 'c', 'login', 'register', 'organizers', 'cdn-cgi',
]);

const SKIPPED_HOSTS = [
  'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'threads.net', 'discord.com', 'discord.gg', 't.me', 'snapchat.com', 'youtube.com',
];

export const SUPPORTED_PAGES = [
  'hackathon galleries: <name>.devpost.com/project-gallery, /submissions, and filtered submission searches',
  'the listing at devpost.com/software',
  'project pages: devpost.com/software/<name>',
];

export function parseHttpsUrl(raw, base) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

export function isDevpostHost(hostname) {
  return hostname === 'devpost.com' || hostname.endsWith('.devpost.com');
}

function trimPath(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}

export function classifyPage(raw) {
  const u = parseHttpsUrl(raw);
  if (!u || !isDevpostHost(u.hostname)) {
    return { kind: 'unsupported', reason: 'This is not a Devpost page.' };
  }
  const path = trimPath(u.pathname);
  if (u.hostname === 'devpost.com') {
    if (LISTING_PATHS.has(path)) return { kind: 'listing' };
    const m = path.match(/^\/software\/([a-z0-9][a-z0-9-]*)$/i);
    if (m && !RESERVED_SOFTWARE_SLUGS.has(m[1].toLowerCase())) return { kind: 'project' };
  } else {
    const sub = u.hostname.slice(0, -'.devpost.com'.length);
    if (!sub.includes('.') && !NON_HACKATHON_SUBDOMAINS.has(sub) && isGalleryPath(path)) {
      return { kind: 'gallery' };
    }
  }
  return {
    kind: 'unsupported',
    reason: 'Only project galleries, the software listing and project pages are supported.',
  };
}

export function normalizeProjectUrl(raw, base) {
  const u = parseHttpsUrl(raw, base);
  if (!u || !isDevpostHost(u.hostname)) return null;
  const m = trimPath(u.pathname).match(/^\/software\/([a-z0-9][a-z0-9-]*)$/i);
  if (!m || RESERVED_SOFTWARE_SLUGS.has(m[1].toLowerCase())) return null;
  return `https://devpost.com/software/${m[1].toLowerCase()}`;
}

export function normalizeProfileUrl(raw, base) {
  const u = parseHttpsUrl(raw, base);
  if (!u || u.hostname !== 'devpost.com') return null;
  const m = trimPath(u.pathname).match(/^\/([A-Za-z0-9_-]{1,64})$/);
  if (!m || NOT_PROFILE_SEGMENTS.has(m[1].toLowerCase())) return null;
  return `https://devpost.com/${m[1]}`;
}

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function portfolioTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { skip: 'not a valid link' };
  }
  if (u.protocol === 'http:') return { skip: 'not served over HTTPS', host: u.hostname };
  if (u.protocol !== 'https:' || u.username || u.password) return { skip: 'not a web link' };
  if (isDevpostHost(u.hostname)) return { skip: 'Devpost link', host: u.hostname };
  if (SKIPPED_HOSTS.some((d) => hostMatches(u.hostname, d))) {
    return { skip: 'social network pages are never read', host: u.hostname };
  }
  u.hash = '';
  return { url: u.href, origin: u.origin, host: u.hostname };
}

export function originPattern(origin) {
  return `${origin}/*`;
}

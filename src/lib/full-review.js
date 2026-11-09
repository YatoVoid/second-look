import { isGalleryPath, parseHttpsUrl } from './url.js';

export const MAX_PAGES = 40;
const MAX_ORIGINS = 50;

export function isNextGalleryPage(next, startUrl) {
  const a = parseHttpsUrl(next);
  const b = parseHttpsUrl(startUrl);
  if (!a || !b || a.origin !== b.origin || !isGalleryPath(a.pathname)) return false;
  // don't let a filtered run fall back to the whole gallery
  const filtered = (u) => u.pathname.replace(/\/+$/, '') === '/submissions/search';
  return !filtered(b) || filtered(a);
}

export function startRun({ tabId, url, now }) {
  return {
    tabId,
    startUrl: url,
    startedAt: now,
    finishedAt: null,
    status: 'running',
    endReason: null,
    pages: [],
    flagged: [],
    dismissed: 0,
    errors: 0,
    checked: 0,
    pendingOrigins: [],
  };
}

export function recordPage(run, report, now) {
  if (!run || run.status !== 'running') return { run, next: null };
  const pageKey = report.url;
  const pages = run.pages.filter((p) => p.url !== pageKey);
  pages.push({ url: pageKey, page: report.page ?? pages.length + 1, checked: report.checked, flagged: report.flagged.length });

  const byUrl = new Map(run.flagged.map((f) => [f.url, f]));
  for (const f of report.flagged) byUrl.set(f.url, { ...f, page: report.page });
  const origins = [...new Set([...run.pendingOrigins, ...(report.pendingOrigins ?? [])])].slice(0, MAX_ORIGINS);

  const next = {
    ...run,
    pages,
    flagged: [...byUrl.values()],
    dismissed: pages.length === run.pages.length ? run.dismissed : run.dismissed + (report.dismissed ?? 0),
    errors: pages.length === run.pages.length ? run.errors : run.errors + (report.errors ?? 0),
    checked: pages.reduce((n, p) => n + (p.checked ?? 0), 0),
    pendingOrigins: origins,
  };

  const visited = new Set(pages.map((p) => p.url));
  let endReason = null;
  if (!report.nextUrl) endReason = 'last-page';
  else if (!isNextGalleryPage(report.nextUrl, run.startUrl)) endReason = 'left-gallery';
  else if (visited.has(report.nextUrl)) endReason = 'loop';
  else if (pages.length >= MAX_PAGES) endReason = 'page-limit';

  if (endReason) return { run: { ...next, status: 'done', endReason, finishedAt: now }, next: null };
  return { run: next, next: report.nextUrl };
}

export function stopRun(run, now) {
  if (!run || run.status !== 'running') return run;
  return { ...run, status: 'stopped', endReason: 'stopped', finishedAt: now };
}

export function summarizeEntry(entry) {
  return {
    url: entry.url,
    title: entry.title,
    findings: entry.result.findings.map((f) => ({
      kind: f.kind,
      source: { url: f.source.url, title: f.source.title, hackathons: f.source.hackathons ?? [] },
      via: f.via,
      reasons: f.reasons,
      excerpt: f.excerpts[0] ?? '',
    })),
  };
}

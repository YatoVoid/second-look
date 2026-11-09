import {
  extractPortfolioBlocks,
  extractProfile,
  extractProject,
  hasProfileStructure,
  hasProjectStructure,
} from './extract.js';
import { cardLooksRelated, compare, prepare } from './similarity.js';
import { portfolioTarget } from './url.js';

export const LIMITS = Object.freeze({
  maxProjects: 80,
  maxMembers: 8,
  candidatesPerMember: 2,
  candidatesPerProject: 6,
  portfolioLinksPerMember: 3,
  genericDocFreq: 3,
  concurrency: 2,
});

const FETCH_ERRORS = {
  permission: 'site access was not granted',
  robots: "the site's robots.txt asks automated readers not to",
  timeout: 'the page took too long to respond',
  network: 'the page could not be reached',
  'not-html': 'the link is not a web page',
  budget: 'the request limit for this browser session was reached',
  'invalid-url': 'the link is not a valid HTTPS address',
};

export function describeFetchError(res) {
  if (res?.error === 'http') return `the site answered HTTP ${res.status}`;
  return FETCH_ERRORS[res?.error] ?? 'the page could not be read';
}

class Stopped extends Error {}

export function createAnalyzer(deps) {
  const L = { ...LIMITS, ...deps.limits };
  const now = deps.now ?? (() => Date.now());
  const entries = new Map();
  const queue = [];
  const docFreq = new Map();
  const cache = { project: new Map(), profile: new Map(), portfolio: new Map() };
  const pendingOrigins = new Set();
  let paused = false;
  let stopped = false;
  let running = false;
  let skipped = 0;
  let checking = null;
  let waiters = [];

  const emit = () => deps.onStatus?.(getState());

  function remember(url, prepared) {
    for (const key of prepared.shingles.keys()) {
      let set = docFreq.get(key);
      if (!set) docFreq.set(key, (set = new Set()));
      set.add(url);
    }
  }

  function genericKeys() {
    const out = new Set();
    for (const [key, urls] of docFreq) if (urls.size >= L.genericDocFreq) out.add(key);
    return out;
  }

  function add(items) {
    const added = [];
    for (const item of items) {
      if (!item?.url) continue;
      const existing = entries.get(item.url);
      if (existing) {
        if (item.element && !existing.elements.has(item.element)) {
          existing.elements.add(item.element);
          if (existing.result) deps.onUpdate?.(existing);
        }
        continue;
      }
      if (entries.size >= L.maxProjects) {
        skipped++;
        continue;
      }
      const entry = {
        url: item.url,
        title: item.title ?? '',
        tagline: item.tagline ?? '',
        detail: item.detail ?? null,
        placement: item.placement ?? 'card',
        elements: new Set(item.element ? [item.element] : []),
        status: 'queued',
        result: null,
        fromStore: false,
      };
      entries.set(item.url, entry);
      remember(item.url, prepare(`${entry.title} ${entry.tagline}`));
      added.push(entry);
      if (item.result) {
        entry.status = 'done';
        entry.fromStore = true;
        entry.result = item.result;
        applyDismissal(entry);
        deps.onUpdate?.(entry);
        continue;
      }
      queue.push(entry);
    }
    emit();
    run();
    return added;
  }

  async function gate() {
    while (paused && !stopped) await new Promise((r) => waiters.push(r));
    if (stopped) throw new Stopped();
  }

  function release() {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  }

  function memo(map, key, loader) {
    if (!map.has(key)) map.set(key, loader());
    return map.get(key);
  }

  async function fetchDoc(url) {
    await gate();
    const res = await deps.fetchPage(url);
    if (!res?.ok) return { error: describeFetchError(res), code: res?.error, origin: res?.origin };
    return { doc: deps.parseHtml(res.html, url), fetchedAt: res.fetchedAt ?? now(), truncated: !!res.truncated };
  }

  function loadProject(url) {
    return memo(cache.project, url, async () => {
      const r = await fetchDoc(url);
      if (r.error) return r;
      if (!hasProjectStructure(r.doc)) return { error: 'the project page layout was not recognized' };
      return { ...extractProject(r.doc, url), fetchedAt: r.fetchedAt, truncated: r.truncated };
    });
  }

  function loadProfile(url) {
    return memo(cache.profile, url, async () => {
      const r = await fetchDoc(url);
      if (r.error) return r;
      if (!hasProfileStructure(r.doc)) return { error: 'the profile layout was not recognized' };
      return { ...extractProfile(r.doc, url), fetchedAt: r.fetchedAt };
    });
  }

  function loadPortfolio(url) {
    return memo(cache.portfolio, url, async () => {
      const r = await fetchDoc(url);
      if (r.error) return r;
      return { blocks: extractPortfolioBlocks(r.doc), fetchedAt: r.fetchedAt, truncated: r.truncated };
    });
  }

  async function analyzeOne(entry) {
    const limitations = [];
    const findings = [];
    const blockedOrigins = new Set();
    const note = (s) => {
      if (!limitations.includes(s)) limitations.push(s);
    };

    const detail = entry.detail ?? (await loadProject(entry.url));
    if (detail.error) {
      return { flagged: false, findings, limitations: [`This project could not be read: ${detail.error}.`], error: true };
    }
    entry.title = detail.title || entry.title;
    const current = prepare(`${detail.tagline}\n${detail.description}`, detail.title);
    remember(entry.url, current);
    if (current.content.length < 12) note('The description is too short for a meaningful comparison.');
    if (detail.truncated) note('This project page was very long and only partly read.');
    if (!detail.team.length) note('No public team members are listed, so no other projects were checked.');
    if (detail.team.length > L.maxMembers) note(`Only the first ${L.maxMembers} team members were checked.`);

    const generic = genericKeys();
    const seenCandidates = new Set([entry.url]);
    let candidateFetches = 0;

    for (const member of detail.team.slice(0, L.maxMembers)) {
      const profile = await loadProfile(member.profileUrl);
      if (profile.error) {
        note(`${member.name}'s Devpost profile was not checked: ${profile.error}.`);
        continue;
      }
      if (profile.hasMoreProjects) note(`Only the first page of ${member.name}'s Devpost projects was checked.`);

      const ranked = profile.projects
        .filter((p) => !seenCandidates.has(p.url))
        .map((p) => ({ ...p, ...cardLooksRelated(current, p) }))
        .filter((p) => p.related)
        .sort((a, b) => b.score - a.score)
        .slice(0, L.candidatesPerMember);

      for (const card of ranked) {
        seenCandidates.add(card.url);
        if (candidateFetches >= L.candidatesPerProject) {
          note('More possibly related projects exist than this tool checks per project.');
          break;
        }
        candidateFetches++;
        const page = await loadProject(card.url);
        if (page.error) {
          note(`"${card.title}" (${card.url}) was not checked: ${page.error}.`);
          continue;
        }
        const cmp = compare(current, prepare(`${page.tagline}\n${page.description}`, page.title), { generic });
        if (!cmp.flag) continue;
        findings.push({
          kind: 'devpost-project',
          source: { url: card.url, title: page.title || card.title, hackathons: page.hackathons, fetchedAt: page.fetchedAt },
          via: `On ${member.name}'s Devpost profile`,
          reasons: cmp.reasons,
          excerpts: cmp.excerpts,
        });
      }

      const links = profile.links.slice(0, L.portfolioLinksPerMember);
      if (profile.links.length > links.length) note(`Only the first ${links.length} links on ${member.name}'s profile were checked.`);
      for (const link of links) {
        const target = portfolioTarget(link);
        if (target.skip) {
          if (target.host) note(`${target.host} was skipped: ${target.skip}.`);
          continue;
        }
        const site = await loadPortfolio(target.url);
        if (site.error) {
          if (site.code === 'permission') {
            blockedOrigins.add(target.origin);
            pendingOrigins.add(target.origin);
            note(`${target.host} was not checked because you have not allowed Second Look to read it.`);
          } else {
            note(`${target.host} was not checked: ${site.error}.`);
          }
          continue;
        }
        let best = null;
        for (const block of site.blocks) {
          const cmp = compare(current, prepare(block.text, block.title), { generic });
          if (cmp.flag && (!best || cmp.signals.longestSpan > best.cmp.signals.longestSpan)) best = { block, cmp };
        }
        if (best) {
          findings.push({
            kind: 'portfolio',
            source: { url: target.url, title: best.block.title || target.host, fetchedAt: site.fetchedAt },
            via: `Linked from ${member.name}'s Devpost profile`,
            reasons: best.cmp.reasons,
            excerpts: best.cmp.excerpts,
            caution:
              'Personal sites often list a project after the event. This page has no date, so check when the entry first appeared.',
          });
        }
      }
    }

    return { flagged: findings.length > 0, findings, limitations, blockedOrigins: [...blockedOrigins], checkedAt: now() };
  }

  function applyDismissal(entry) {
    const record = deps.getDismissal?.(entry.url);
    const result = entry.result;
    if (!result) return;
    const known = new Set(record?.candidates ?? []);
    result.dismissed = record && result.findings.every((f) => known.has(f.source.url)) ? record : null;
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      await Promise.all(Array.from({ length: L.concurrency }, worker));
    } finally {
      running = false;
      checking = null;
      emit();
    }
    if (queue.length && !stopped && !paused) run();
  }

  async function worker() {
    while (queue.length && !stopped) {
      await gate().catch(() => {});
      if (stopped) break;
      const entry = queue.shift();
      if (!entry) break;
      entry.status = 'checking';
      checking = entry.title || entry.url;
      emit();
      try {
        entry.result = await analyzeOne(entry);
      } catch (err) {
        if (err instanceof Stopped) {
          entry.status = 'queued';
          queue.unshift(entry);
          break;
        }
        entry.result = { flagged: false, findings: [], limitations: ['Something went wrong while checking this project.'], error: true };
      }
      entry.status = 'done';
      applyDismissal(entry);
      deps.onUpdate?.(entry);
    }
  }

  function getState() {
    let done = 0;
    let flagged = 0;
    let dismissed = 0;
    let errors = 0;
    for (const e of entries.values()) {
      if (e.status !== 'done') continue;
      done++;
      if (e.result?.error) errors++;
      if (e.result?.flagged) e.result.dismissed ? dismissed++ : flagged++;
    }
    const status = stopped ? 'stopped' : paused ? 'paused' : running || queue.length ? 'running' : 'done';
    return { status, total: entries.size, done, flagged, dismissed, errors, skipped, checking, pendingOrigins: [...pendingOrigins] };
  }

  return {
    add,
    getState,
    entries: () => [...entries.values()],
    pause() {
      paused = true;
      emit();
    },
    resume() {
      paused = false;
      release();
      emit();
      run();
    },
    stop() {
      stopped = true;
      release();
      emit();
    },
    async recheck() {
      const settled = await Promise.all([...cache.portfolio].map(async ([url, p]) => [url, await p]));
      for (const [url, v] of settled) if (v?.code === 'permission') cache.portfolio.delete(url);
      pendingOrigins.clear();
      for (const e of entries.values()) {
        if (e.status === 'done' && e.result?.blockedOrigins?.length) {
          e.status = 'queued';
          queue.push(e);
        }
      }
      emit();
      run();
    },
    refreshDismissals() {
      for (const e of entries.values()) {
        if (!e.result) continue;
        applyDismissal(e);
        deps.onUpdate?.(e);
      }
      emit();
    },
  };
}

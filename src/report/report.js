import { fill, formatTime, h } from '../content/dom.js';
import { ext } from '../lib/browser.js';

const view = document.getElementById('view');
const el = (tag, props, ...kids) => h(document, tag, props, ...kids);

const END_REASONS = {
  'last-page': 'reached the last page',
  'page-limit': 'hit the 40-page limit',
  'left-gallery': 'the next link left the gallery',
  loop: 'the next link pointed back to a page already checked',
  stopped: 'stopped by you',
};

let current = null;

export function reportText(run) {
  const lines = [
    `Second Look full review: ${run.startUrl}`,
    `Started ${formatTime(run.startedAt)}${run.finishedAt ? `, finished ${formatTime(run.finishedAt)}` : ' (still running)'}`,
    `Pages ${run.pages.length}, projects checked ${run.checked}, flagged ${run.flagged.length}, dismissed ${run.dismissed}, unreadable ${run.errors}`,
    'Flags mark shared wording only. Each one needs a person to look at the source.',
    '',
  ];
  run.flagged.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.title || p.url} (page ${p.page})`, `   ${p.url}`);
    for (const f of p.findings) {
      lines.push(`   matches: ${f.source.title || f.source.url} ${f.source.url}`, `   ${f.via}`);
      for (const r of f.reasons) lines.push(`   - ${r}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

function render(run) {
  current = run;
  if (!run) {
    fill(view,
      el('h1', { text: 'No report yet' }),
      el('p', { class: 'dim', text: 'Start one from the extension menu on a Devpost project gallery: Check every page of this gallery.' }),
    );
    return;
  }
  document.getElementById('host').textContent = new URL(run.startUrl).hostname;
  const running = run.status === 'running';
  const rows = [
    ['Gallery', el('a', { href: run.startUrl, text: run.startUrl })],
    ['Status', running ? 'running, this page updates as it goes' : `finished: ${END_REASONS[run.endReason] ?? run.endReason}`],
    ['Started', formatTime(run.startedAt)],
    run.finishedAt ? ['Finished', formatTime(run.finishedAt)] : null,
    ['Pages', String(run.pages.length)],
    ['Checked', `${run.checked} projects`],
    ['Flagged', String(run.flagged.length), run.flagged.length > 0],
    ['Dismissed', String(run.dismissed)],
    ['Unreadable', String(run.errors)],
  ].filter(Boolean);

  fill(view,
    el('h1', { text: running ? 'Review in progress' : 'Review finished' }),
    el('dl', {}, rows.map(([k, v, hi]) => [el('dt', { text: k }), el('dd', { class: hi ? 'hi' : null }, v)])),
    el('h2', { text: run.flagged.length ? 'Flagged projects' : 'Nothing flagged' }),
    run.flagged.length ? el('ol', {}, run.flagged.map(renderProject)) : null,
    run.pendingOrigins.length
      ? [
          el('h2', { text: 'Not read' }),
          el('p', { class: 'dim', text: 'Team members link to these sites, but you did not allow them. Allow them from the extension menu on a gallery page and run again to include them.' }),
          el('ul', { class: 'plain' }, run.pendingOrigins.map((o) => el('li', { text: o.replace(/^https:\/\//, '') }))),
        ]
      : null,
  );
}

function renderProject(p) {
  return el('li', { class: 'project' },
    el('h3', {}, el('a', { href: p.url, text: p.title || p.url })),
    el('p', { class: 'dim', text: `Gallery page ${p.page}` }),
    p.findings.map((f) =>
      el('div', { class: 'source' },
        el('p', {}, 'Matches ', el('a', { href: f.source.url, text: f.source.title || f.source.url })),
        el('p', { class: 'dim', text: [f.via, f.source.hackathons?.length ? `submitted to ${f.source.hackathons.join(', ')}` : ''].filter(Boolean).join(', ') }),
        el('ul', { class: 'why' }, f.reasons.map((r) => el('li', { text: r }))),
        f.excerpt ? el('mark', { text: f.excerpt }) : null,
      ),
    ),
  );
}

async function load() {
  render(await ext.runtime.sendMessage({ type: 'full-report' }).catch(() => null));
}

const copyLabel = document.querySelector('#copy span');
document.getElementById('copy').addEventListener('click', async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(reportText(current));
    copyLabel.textContent = 'Copied';
  } catch {
    copyLabel.textContent = 'Copy failed';
  }
  setTimeout(() => (copyLabel.textContent = 'Copy as text'), 2000);
});
document.getElementById('print').addEventListener('click', () => window.print());
document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  document.querySelector(`button[data-key="${CSS.escape(ev.key.toLowerCase())}"]`)?.click();
});
ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && 'fullReview' in changes) render(changes.fullReview.newValue ?? null);
});

load();

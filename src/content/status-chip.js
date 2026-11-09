import { h } from './dom.js';
import { CHIP_CSS } from './styles.js';

export function describeState(s, full, total = null) {
  if (!s) return '';
  const page = full?.last ? `Pg ${full.current}/${full.last}  ` : '';
  const flags = `${total ?? s.flagged} flagged`;
  if (s.view) return `Saved results  ${flags}`;
  if (full?.countdown != null) return `${page}${flags}  Next page in ${full.countdown}s`;
  if (full?.finished) return `${page}${flags}  Full review done, report open`;
  if (s.status === 'paused') return `${page}Paused ${s.done}/${s.total}  ${flags}`;
  if (s.status === 'stopped') return `${page}Stopped ${s.done}/${s.total}  ${flags}`;
  if (s.status === 'running') return `${page}Checking ${Math.min(s.done + 1, s.total)}/${s.total}  ${flags}`;
  return `${page}Done ${s.done}/${s.total}  ${flags}`;
}

export function stepIndex(current, total, dir) {
  if (!total) return -1;
  if (current < 0 || current >= total) return dir > 0 ? 0 : total - 1;
  return (current + dir + total) % total;
}

const GAP = 16;
const MAX_LIFT = 240;

// windows that run past the screen's usable area (under a taskbar) put the viewport bottom out of sight
export function bottomOffset({ screenY, outerHeight, availTop, availHeight }) {
  const vals = [screenY, outerHeight, availTop, availHeight];
  if (!vals.every(Number.isFinite) || availHeight <= 0) return GAP;
  const hidden = screenY + outerHeight - (availTop + availHeight);
  return GAP + Math.min(Math.max(hidden, 0), MAX_LIFT);
}

export function navLabel(current, total) {
  return `${current < 0 ? 0 : current + 1}/${total}`;
}

export function createStatusChip(doc, { onPause, onResume, onStop, onAllow, onPrev, onNext }) {
  const host = doc.createElement('second-look-status');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
  const view = doc.defaultView;
  const place = () => {
    const sc = view?.screen;
    if (!sc) return;
    host.style.bottom = `${bottomOffset({ screenY: view.screenY, outerHeight: view.outerHeight, availTop: sc.availTop ?? 0, availHeight: sc.availHeight })}px`;
  };
  // moving a window fires no event, so recheck now and then
  const placeTimer = view?.setInterval(place, 2000);
  view?.addEventListener('resize', place);
  view?.addEventListener('focus', place);
  const root = host.attachShadow({ mode: 'closed' });
  const text = h(doc, 'span', { class: 'text', role: 'status', 'aria-live': 'polite' });
  const toggle = h(doc, 'button', { type: 'button' });
  const stop = h(doc, 'button', { type: 'button', onclick: () => onStop() }, 'Stop');
  const allow = h(doc, 'button', { type: 'button', class: 'allow', hidden: true, onclick: () => onAllow?.() });
  const hide = h(doc, 'button', { type: 'button', 'aria-label': 'Hide this status bar' }, 'Hide');
  const count = h(doc, 'span', { class: 'count', 'aria-live': 'polite' });
  const nav = h(doc, 'span', { class: 'nav', hidden: true },
    count,
    h(doc, 'button', { type: 'button', 'aria-label': 'Previous flagged project', onclick: () => onPrev?.() }, '<'),
    h(doc, 'button', { type: 'button', 'aria-label': 'Next flagged project', onclick: () => onNext?.() }, '>'),
  );
  const bar = h(doc, 'div', { class: 'status' }, h(doc, 'span', { class: 'name', text: 'SECOND LOOK' }), text, nav, allow, toggle, stop, hide);
  hide.addEventListener('click', () => bar.setAttribute('hidden', ''));
  let last = null;
  let full = null;
  let total = null;
  toggle.addEventListener('click', () => (last?.status === 'paused' ? onResume() : onPause()));
  root.append(h(doc, 'style', { text: CHIP_CSS }), bar);
  doc.documentElement.append(host);
  place();

  function paint() {
    if (!last) return;
    text.textContent = describeState(last, full, total);
    const paused = last.status === 'paused';
    toggle.textContent = paused ? 'Resume' : 'Pause';
    const active = last.status === 'running' || paused || full?.countdown != null;
    toggle.hidden = !(last.status === 'running' || paused);
    stop.hidden = !active;
  }

  return {
    update(state) {
      last = state;
      paint();
    },
    setPending(n) {
      allow.hidden = !n;
      allow.textContent = `Allow ${n} site${n === 1 ? '' : 's'}`;
    },
    setNav(current, n) {
      total = n;
      nav.hidden = !n;
      count.textContent = navLabel(current, n);
      count.title = `Flag ${current < 0 ? 0 : current + 1} of ${n}, across every page checked in this gallery`;
      paint();
    },
    setFull(info) {
      full = info;
      paint();
    },
    show() {
      bar.removeAttribute('hidden');
    },
    remove() {
      view?.clearInterval(placeTimer);
      view?.removeEventListener('resize', place);
      view?.removeEventListener('focus', place);
      host.remove();
    },
  };
}

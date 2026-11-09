import { parseHttpsUrl } from '../lib/url.js';

export function h(doc, tag, props = {}, ...children) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'href') {
      const safe = parseHttpsUrl(v);
      if (safe) {
        el.href = safe.href;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      }
    } else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'string' ? doc.createTextNode(c) : c);
  }
  return el;
}

export function fill(parent, ...nodes) {
  parent.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false));
}

export function formatTime(ms) {
  if (!ms) return 'unknown time';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

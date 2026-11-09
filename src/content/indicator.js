import { formatTime, h } from './dom.js';
import { INDICATOR_CSS } from './styles.js';

export const DISCLAIMER =
  'Shared wording, not a verdict. Teams reuse their own write-ups and some events allow resubmissions, so open the source before deciding.';

export function createIndicators(doc, { onDismiss, onHide, onChange }) {
  const mounted = new Map();

  function mount(anchor, placement) {
    const host = doc.createElement('second-look-indicator');
    const root = host.attachShadow({ mode: 'closed' });
    root.append(h(doc, 'style', { text: INDICATOR_CSS }));
    if (placement === 'header') {
      host.style.cssText = 'display:block;text-align:center;margin:16px 0 0;';
      anchor.after(host);
    } else {
      host.style.cssText = 'position:absolute;top:-14px;right:20px;z-index:3;';
      const view = doc.defaultView;
      if (view && view.getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
      anchor.prepend(host);
    }
    const record = { host, root };
    mounted.set(anchor, record);
    return record;
  }

  function anchorFor(el, placement) {
    if (placement !== 'header') return el;
    return el.querySelector?.('#app-title') ?? el;
  }

  function render(entry) {
    const r = entry.result;
    const visible = !!(r?.flagged && !r.dismissed && !r.hidden);
    for (const el of entry.elements) {
      const anchor = anchorFor(el, entry.placement);
      let m = mounted.get(anchor);
      if (!visible) {
        if (m) {
          m.host.remove();
          mounted.delete(anchor);
        }
        continue;
      }
      if (!m) m = mount(anchor, entry.placement);
      fill(m, entry);
    }
    onChange?.();
  }

  function fill(m, entry) {
    m.url = entry.url;
    const { root } = m;
    for (const n of [...root.childNodes]) if (n.nodeName !== 'STYLE') n.remove();
    const r = entry.result;
    const name = entry.title || entry.url;
    const count = r.findings.length;
    const dialog = h(doc, 'dialog', { 'aria-label': `Second Look: ${name}` });
    const big = entry.placement === 'header';
    const sources = `${count} matching ${count === 1 ? 'source' : 'sources'}`;
    const button = h(doc, 'button', {
      class: big ? 'flag big' : 'flag',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-label': `Review ${name}: similar text found in ${count} other ${count === 1 ? 'page' : 'pages'}`,
      onclick: (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        open(dialog);
      },
    },
    h(doc, 'span', { class: 'pole', 'aria-hidden': 'true' }),
    h(doc, 'span', { class: 'cloth' },
      'CHECK AGAIN',
      !big && count > 1 ? h(doc, 'b', { text: String(count) }) : null,
      big ? h(doc, 'small', { text: sources }) : null,
    ));

    const note = h(doc, 'textarea', { id: 'sl-note', maxlength: 500, rows: 2 });
    const close = () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
      button.focus();
    };
    const hide = () => {
      close();
      onHide(entry);
    };
    const dismiss = () => {
      close();
      onDismiss(entry, note.value);
    };

    dialog.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
        return;
      }
      if (ev.target === note || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k === 'h') hide();
      else if (k === 'd') dismiss();
    });
    dialog.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ev.target === dialog) close();
    });

    const key = (letter, label, action) =>
      h(doc, 'button', { type: 'button', onclick: action }, h(doc, 'kbd', { text: letter }), label);

    dialog.append(
      h(doc, 'div', { class: 'screen' },
        h(doc, 'div', { class: 'bar' }, h(doc, 'span', { text: 'EVIDENCE' }), h(doc, 'span', { text: name })),
        h(doc, 'div', { class: 'body' },
          h(doc, 'p', { class: 'lede', text: DISCLAIMER }),
          r.findings.map((f) => renderFinding(f, name)),
          r.limitations.length
            ? [h(doc, 'h4', { text: 'Not checked' }), h(doc, 'ul', { class: 'gaps' }, r.limitations.map((t) => h(doc, 'li', { text: t })))]
            : null,
        ),
        h(doc, 'div', { class: 'note' }, h(doc, 'label', { for: 'sl-note', text: 'Note to self, saved with a dismissal (stays on this computer)' }), note),
        h(doc, 'div', { class: 'keys' },
          key('Esc', 'Close', close),
          key('H', 'Hide', hide),
          key('D', 'Dismiss', dismiss),
          h(doc, 'span', { class: 'own', text: 'Only you see this' }),
        ),
      ),
    );
    if (m.current) button.classList.add('current');
    m.button = button;
    root.append(button, dialog);
  }

  function list() {
    return [...mounted.keys()]
      .filter((a) => a.isConnected)
      .sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
  }

  function goTo(anchor) {
    const target = mounted.get(anchor);
    if (!target) return;
    for (const m of mounted.values()) {
      m.current = m === target;
      m.button?.classList.toggle('current', m.current);
    }
    const reduce = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    anchor.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    target.button?.focus({ preventScroll: true });
  }

  function renderFinding(f, title) {
    const src = f.source;
    const words = (t) => t.replace(/\.\.\.$/, '').split(' ').length;
    return h(doc, 'section', { class: 'source' },
      h(doc, 'h3', {}, h(doc, 'a', { href: src.url, text: src.title || src.url })),
      h(doc, 'p', { class: 'meta', text: `${f.via}, read ${formatTime(src.fetchedAt)}` }),
      src.hackathons?.length ? h(doc, 'p', { class: 'meta', text: `Submitted to ${src.hackathons.join(', ')}` }) : null,
      h(doc, 'ul', { class: 'why' }, f.reasons.map((t) => h(doc, 'li', { text: t }))),
      f.excerpts.length
        ? h(doc, 'p', { class: 'same' }, 'Word for word in ', h(doc, 'b', { text: title }), ' and ', h(doc, 'b', { text: src.title || 'the source' }), ':')
        : null,
      f.excerpts.map((t) => h(doc, 'mark', {}, h(doc, 'span', { text: `${words(t)}${t.endsWith('...') ? '+' : ''} WORDS` }), t)),
      f.caution ? h(doc, 'p', { class: 'warn', text: f.caution }) : null,
    );
  }

  function open(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.querySelector('.keys button')?.focus();
  }

  function removeAll() {
    for (const m of mounted.values()) m.host.remove();
    mounted.clear();
    onChange?.();
  }

  return { render, removeAll, list, goTo, urlOf: (anchor) => mounted.get(anchor)?.url ?? null, _rootFor: (anchor) => mounted.get(anchor)?.root ?? null };
}

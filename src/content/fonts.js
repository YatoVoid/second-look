import { ext } from '../lib/browser.js';

const FACES = [
  ['SL VT323', 'fonts/vt323-400.woff2', '400'],
  ['SL Plex Mono', 'fonts/plex-mono-400.woff2', '400'],
  ['SL Plex Mono', 'fonts/plex-mono-600.woff2', '600'],
];

let loaded = false;

// @font-face is ignored inside shadow roots, so register on the document with prefixed names
export function registerFonts(doc) {
  if (loaded || !doc.fonts || typeof FontFace !== 'function') return;
  loaded = true;
  for (const [family, path, weight] of FACES) {
    const face = new FontFace(family, `url("${ext.runtime.getURL(path)}")`, { weight, display: 'swap' });
    doc.fonts.add(face);
    face.load().catch(() => {});
  }
}

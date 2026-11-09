import { collapse, isContentWord, tokenize } from './text.js';

export const THRESHOLDS = Object.freeze({
  shingle: 6,
  minShingleContentWords: 3,
  minContentWords: 25,
  shortTextSpan: 15,
  longSpan: 20,
  multiSpanWords: 8,
  multiSpanCount: 3,
  containment: 0.2,
  cosine: 0.55,
  title: 0.7,
  maxExcerpts: 5,
  excerptChars: 240,
});

export function prepare(text, title = '') {
  const n = THRESHOLDS.shingle;
  const tokens = tokenize(text);
  const content = tokens.filter(isContentWord);
  const tf = new Map();
  for (const w of content) tf.set(w, (tf.get(w) ?? 0) + 1);
  const shingles = new Map();
  for (let i = 0; i + n <= tokens.length; i++) {
    const win = tokens.slice(i, i + n);
    if (win.filter(isContentWord).length < THRESHOLDS.minShingleContentWords) continue;
    const key = win.join(' ');
    if (!shingles.has(key)) shingles.set(key, i);
  }
  return { title: collapse(title), titleKey: tokenize(title).join(''), tokens, content, tf, shingles };
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i + 2 <= s.length; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

export function titleSimilarity(a, b) {
  if (a.length < 2 || b.length < 2) return 0;
  if (a === b) return 1;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  for (const [g, c] of ga) inter += Math.min(c, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

export function cosine(tfA, tfB) {
  if (!tfA.size || !tfB.size) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [w, c] of tfA) {
    na += c * c;
    dot += c * (tfB.get(w) ?? 0);
  }
  for (const c of tfB.values()) nb += c * c;
  return dot / Math.sqrt(na * nb);
}

export function sharedSpans(a, b, generic = new Set()) {
  const n = THRESHOLDS.shingle;
  const hits = [];
  for (const [key, i] of a.shingles) {
    if (b.shingles.has(key) && !generic.has(key)) hits.push(i);
  }
  hits.sort((x, y) => x - y);
  const spans = [];
  for (const i of hits) {
    const last = spans.at(-1);
    if (last && i <= last.end) last.end = Math.max(last.end, i + n);
    else spans.push({ start: i, end: i + n });
  }
  return {
    sharedKeys: hits.length,
    spans: spans.map((s) => ({ words: s.end - s.start, text: a.tokens.slice(s.start, s.end).join(' ') })),
  };
}

function excerpt(text) {
  const max = THRESHOLDS.excerptChars;
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}...` : text;
}

export function compare(current, candidate, { generic } = {}) {
  const T = THRESHOLDS;
  const { spans, sharedKeys } = sharedSpans(current, candidate, generic);
  const longest = spans.reduce((m, s) => Math.max(m, s.words), 0);
  const enoughText = current.content.length >= T.minContentWords && candidate.content.length >= T.minContentWords;
  const smaller = Math.min(current.shingles.size, candidate.shingles.size);
  const containment = smaller ? sharedKeys / smaller : 0;
  const vocab = cosine(current.tf, candidate.tf);
  const title = titleSimilarity(current.titleKey, candidate.titleKey);

  const reasons = [];
  const phraseHit = enoughText
    ? longest >= T.longSpan || spans.filter((s) => s.words >= T.multiSpanWords).length >= T.multiSpanCount
    : longest >= T.shortTextSpan;
  if (phraseHit) {
    reasons.push(
      spans.length === 1
        ? `${longest} words in a row are identical.`
        : `${spans.length} identical passages, the longest ${longest} words.`,
    );
  }
  const overlapHit = enoughText && containment >= T.containment;
  if (overlapHit) {
    reasons.push(
      `${Math.round(containment * 100)}% of the shorter text's 6-word phrases also appear in the other.`,
    );
  }
  const topicalHit = enoughText && vocab >= T.cosine && title >= T.title;
  if (topicalHit) {
    reasons.push(
      `Close titles ("${current.title}", "${candidate.title}") and mostly the same vocabulary.`,
    );
  }

  const flag = phraseHit || overlapHit || topicalHit;
  if (flag && title >= T.title && !topicalHit) {
    reasons.push(`The titles are close too ("${current.title}", "${candidate.title}").`);
  }

  return {
    flag,
    reasons,
    excerpts: [...spans].sort((x, y) => y.words - x.words).slice(0, T.maxExcerpts).map((s) => excerpt(s.text)),
    signals: { longestSpan: longest, spanCount: spans.length, containment, vocab, title, enoughText },
  };
}

export function cardLooksRelated(current, card) {
  const cardPrep = prepare(card.tagline ?? '', card.title ?? '');
  const title = titleSimilarity(current.titleKey, cardPrep.titleKey);
  const words = new Set(cardPrep.content);
  if (!words.size) return { related: title >= 0.5, score: title };
  const currentWords = new Set(current.content);
  let covered = 0;
  for (const w of words) if (currentWords.has(w)) covered++;
  const coverage = covered / words.size;
  const score = Math.max(title, coverage);
  return { related: title >= 0.5 || (coverage >= 0.5 && words.size >= 3), score };
}

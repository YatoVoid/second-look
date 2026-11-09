const STOPWORDS = new Set(`
a about above after again against all also am an and any are aren't as at be because been before
being below between both but by can can't cannot could couldn't did didn't do does doesn't doing
don't down during each few for from further had hadn't has hasn't have haven't having he her here
hers herself him himself his how i i'm if in into is isn't it it's its itself just let's me more
most my myself no nor not now of off on once only or other our ours ourselves out over own same
she should so some such than that that's the their theirs them themselves then there there's these
they they're this those through to too under until up us very via was wasn't we we're we've were
weren't what what's when where which while who whom why will with won't would you you're your yours
yourself also able use used using uses make makes made get gets got one two three new well like
many much every within without across around into onto per lot lots way ways thing things really
`.trim().split(/\s+/));

const TEMPLATE_HEADINGS = [
  /^inspiration$/,
  /^about the project$/,
  /^what it does$/,
  /^how (we|i) built it$/,
  /^challenges (we|i) ran into$/,
  /^challenges$/,
  /^accomplishments that (we're|we are|i'm|i am) proud of$/,
  /^what (we|i) learned$/,
  /^what's next( for\b.*)?$/,
  /^built with$/,
  /^try it out$/,
];

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase();
}

export function tokenize(s) {
  return normalize(s).match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

export function isContentWord(w) {
  return w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w);
}

export function isTemplateHeading(text) {
  const t = tokenize(text).join(' ');
  return TEMPLATE_HEADINGS.some((re) => re.test(t));
}

export function collapse(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

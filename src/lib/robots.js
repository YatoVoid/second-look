export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  const rules = groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules);
  return { rules };
}

function matchLength(pattern, path) {
  if (pattern === '') return -1;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    `^${body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`,
  );
  return re.test(path) ? pattern.length : -1;
}

export function isAllowed(robots, path) {
  if (!robots) return true;
  if (robots.disallowAll) return false;
  let best = { len: -1, allow: true };
  for (const r of robots.rules) {
    const len = matchLength(r.path, path);
    if (len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best.len < 0 ? true : best.allow;
}

export const DISALLOW_ALL = Object.freeze({ rules: [], disallowAll: true });

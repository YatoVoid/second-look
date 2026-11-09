const KEY = 'dismissals';
const MAX_REASON = 500;
const MAX_RECORDS = 2000;

export async function loadDismissals(storage) {
  const got = await storage.get(KEY);
  const value = got?.[KEY];
  return value && typeof value === 'object' ? value : {};
}

export function makeDismissal({ reason, candidates, at }) {
  return {
    reason: String(reason ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_REASON),
    candidates: [...new Set(candidates)].filter((c) => typeof c === 'string').slice(0, 50),
    at,
  };
}

export async function saveDismissal(storage, url, record) {
  const all = await loadDismissals(storage);
  all[url] = record;
  const keys = Object.keys(all);
  if (keys.length > MAX_RECORDS) {
    keys.sort((a, b) => (all[a].at ?? 0) - (all[b].at ?? 0));
    for (const k of keys.slice(0, keys.length - MAX_RECORDS)) delete all[k];
  }
  await storage.set({ [KEY]: all });
  return all;
}

export async function removeDismissal(storage, url) {
  const all = await loadDismissals(storage);
  delete all[url];
  await storage.set({ [KEY]: all });
  return all;
}

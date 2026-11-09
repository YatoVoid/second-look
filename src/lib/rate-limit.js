const MAX_SLOWDOWN = 8;

export function createScheduler({
  intervalFor = () => 1000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const lastStart = new Map();
  const notBefore = new Map();
  const slowdown = new Map();
  const tails = new Map();

  const gap = (origin) => intervalFor(origin) * (slowdown.get(origin) ?? 1);

  function schedule(origin, task) {
    const prev = tails.get(origin) ?? Promise.resolve();
    const run = prev
      .catch(() => {})
      .then(async () => {
        const at = Math.max((lastStart.get(origin) ?? -Infinity) + gap(origin), notBefore.get(origin) ?? -Infinity);
        const wait = at - now();
        if (wait > 0) await sleep(wait);
        lastStart.set(origin, now());
        return task();
      });
    tails.set(origin, run);
    return run;
  }

  function penalize(origin, delayMs) {
    notBefore.set(origin, now() + delayMs);
    slowdown.set(origin, Math.min((slowdown.get(origin) ?? 1) * 2, MAX_SLOWDOWN));
  }

  return { schedule, penalize, slowdownFor: (origin) => slowdown.get(origin) ?? 1 };
}

// content scripts can't be modules, so load the real entry point with import()
(() => {
  const existing = globalThis.__secondLook;
  if (existing) {
    existing.wake?.();
    return;
  }
  globalThis.__secondLook = { loading: true };
  const api = globalThis.browser ?? globalThis.chrome;
  import(api.runtime.getURL('content/main.js'))
    .then((m) => m.boot())
    .catch((err) => console.warn('Second Look could not start:', err));
})();

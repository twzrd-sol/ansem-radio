/** Refresh visible pages and catch up when returning from a wallet or another tab. */
export function watchVisible(refresh: () => Promise<unknown>, intervalMs = 60_000) {
  let alive = true;
  let running = false;
  const tick = async () => {
    if (!alive || running || document.visibilityState === "hidden") return;
    running = true;
    try { await refresh(); } finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pageshow", tick);
  return () => {
    alive = false;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", tick);
    window.removeEventListener("pageshow", tick);
  };
}

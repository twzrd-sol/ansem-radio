import { useSyncExternalStore } from "react";

export const FOLLOW_KEY = "radiolan-hub:following:v1";
const LEGACY_KEY = "radiolan-hub:watching";
const EMPTY: readonly string[] = [];
type StoragePort = Pick<Storage, "getItem" | "setItem">;
const clean = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((s): s is string => typeof s === "string" && /^[a-z0-9_-]{1,80}$/.test(s)))].slice(0, 500) : [];

/** A browser watchlist. It never writes to the hub API or Twitch. Blocked storage falls back to page memory. */
export function createFollowStore(storage: StoragePort | null) {
  let slugs: readonly string[] = EMPTY;
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      const raw = storage?.getItem(FOLLOW_KEY);
      if (raw !== null && raw !== undefined) {
        const parsed = JSON.parse(raw) as { version?: number; slugs?: unknown };
        return parsed?.version === 1 ? clean(parsed.slugs) : [];
      }
      return clean(JSON.parse(storage?.getItem(LEGACY_KEY) ?? "[]"));
    } catch { return []; }
  };
  slugs = read();
  const publish = (next: readonly string[]) => {
    if (next.join("\n") === slugs.join("\n")) return;
    slugs = next;
    listeners.forEach((listener) => listener());
  };
  return {
    snapshot: () => slugs,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload: () => publish(read()),
    toggle: (slug: string) => {
      if (clean([slug]).length === 0) return;
      const next = slugs.includes(slug) ? slugs.filter((s) => s !== slug) : clean([...slugs, slug]);
      try { storage?.setItem(FOLLOW_KEY, JSON.stringify({ version: 1, slugs: next })); } catch { /* page memory */ }
      publish(next);
    },
    /** Merge a one-shot import into this browser's watchlist. The method result counts new valid slugs. */
    importSlugs: (values: readonly string[]) => {
      const existing = new Set(slugs);
      const next = clean([...slugs, ...clean(values)]);
      const added = next.filter((slug) => !existing.has(slug)).length;
      try { storage?.setItem(FOLLOW_KEY, JSON.stringify({ version: 1, slugs: next })); } catch { /* page memory */ }
      publish(next);
      return added;
    },
  };
}

let browserStore: ReturnType<typeof createFollowStore> | undefined;
let subscribers = 0;
function store() {
  if (!browserStore) {
    let storage: StoragePort | null = null;
    try { storage = window.localStorage; } catch { /* unavailable */ }
    browserStore = createFollowStore(storage);
  }
  return browserStore;
}
const changed = (event: StorageEvent) => {
  if (event.key === FOLLOW_KEY || event.key === LEGACY_KEY || event.key === null) store().reload();
};
const subscribe = (listener: () => void) => {
  const unsubscribe = store().subscribe(listener);
  if (subscribers++ === 0) window.addEventListener("storage", changed);
  return () => {
    unsubscribe();
    if (--subscribers === 0) window.removeEventListener("storage", changed);
  };
};
export function useFollowing() {
  const slugs = useSyncExternalStore(subscribe, () => store().snapshot(), () => EMPTY);
  return { slugs, toggle: (slug: string) => store().toggle(slug), importSlugs: (values: readonly string[]) => store().importSlugs(values) };
}

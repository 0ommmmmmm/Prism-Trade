// localStorage helpers + layout persistence.
const J = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export const KEYS = {
  count: "td.count",
  panes: "td.panes",
  watchlist: "td.watchlist",
  favorites: "td.favorites",
  recents: "td.recents",
  layouts: "td.layouts",
  activeLayout: "td.activeLayout",
  watchOpen: "td.watchOpen",
  sync: "td.sync",
};

export const store = J;

export function loadLayouts() { return J.get(KEYS.layouts, {}); }
export function saveLayout(name, snapshot) {
  const all = loadLayouts();
  all[name] = { ...snapshot, savedAt: Date.now() };
  J.set(KEYS.layouts, all);
  J.set(KEYS.activeLayout, name);
}
export function deleteLayout(name) {
  const all = loadLayouts(); delete all[name]; J.set(KEYS.layouts, all);
}

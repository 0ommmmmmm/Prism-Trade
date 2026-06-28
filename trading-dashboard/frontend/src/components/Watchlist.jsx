import React, { useMemo, useState } from "react";
import { store, KEYS } from "../lib/storage";

const CATEGORIES = ["All", "Favorites", "Recent", "Crypto", "Stocks", "Indices"];

// Map a symbol to a category using source metadata + heuristics.
function categorize(sym, source) {
  if (source === "hyperliquid") return "Crypto";
  if (sym?.startsWith("^")) return "Indices";
  return "Stocks";
}

export default function Watchlist({
  open, setOpen, sources, onActivate, onOpenInNew, onReplaceActive, activePaneCfg,
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [menu, setMenu] = useState(null);
  const [favs, setFavs] = useState(() => store.get(KEYS.favorites, []));
  const [recents, setRecents] = useState(() => store.get(KEYS.recents, []));
  const [items, setItems] = useState(() => store.get(KEYS.watchlist, null));

  // Build default watchlist from registered sources once they load
  React.useEffect(() => {
    if (items || !sources) return;
    const init = [];
    for (const s of sources.sources) {
      for (const sym of sources.meta[s].symbols || []) {
        init.push({ id: `${s}:${sym}`, source: s, symbol: sym });
      }
    }
    setItems(init);
  }, [sources, items]);
  React.useEffect(() => { if (items) store.set(KEYS.watchlist, items); }, [items]);
  React.useEffect(() => { store.set(KEYS.favorites, favs); }, [favs]);
  React.useEffect(() => { store.set(KEYS.recents, recents); }, [recents]);

  const list = useMemo(() => {
    if (!items) return [];
    let l = items;
    if (cat === "Favorites") l = l.filter((i) => favs.includes(i.id));
    else if (cat === "Recent") l = recents.map((id) => items.find((i) => i.id === id)).filter(Boolean);
    else if (cat !== "All") l = l.filter((i) => categorize(i.symbol, i.source) === cat);
    if (q) l = l.filter((i) => i.symbol.toLowerCase().includes(q.toLowerCase()) || i.source.includes(q.toLowerCase()));
    return l;
  }, [items, cat, q, favs, recents]);

  function activate(it) {
    setRecents((r) => [it.id, ...r.filter((x) => x !== it.id)].slice(0, 20));
    onActivate?.(it);
  }
  function toggleFav(id) { setFavs((f) => f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]); }
  function remove(id) { setItems((it) => it.filter((x) => x.id !== id)); }
  function addManual() {
    const sym = prompt("Symbol (e.g. BTC, TCS.NS, ^NSEI):"); if (!sym) return;
    const src = prompt(`Source (${sources?.sources.join(" / ")}):`, sources?.sources[0]); if (!src) return;
    const id = `${src}:${sym}`;
    setItems((it) => it.find((x) => x.id === id) ? it : [{ id, source: src, symbol: sym }, ...it]);
  }

  // drag reorder
  const dragId = React.useRef(null);
  function onDragStart(e, id) { dragId.current = id; e.dataTransfer.effectAllowed = "move"; }
  function onDragOver(e) { e.preventDefault(); }
  function onDrop(e, overId) {
    e.preventDefault();
    const from = dragId.current; dragId.current = null;
    if (!from || from === overId) return;
    setItems((arr) => {
      const a = arr.slice();
      const fi = a.findIndex((x) => x.id === from);
      const ti = a.findIndex((x) => x.id === overId);
      if (fi < 0 || ti < 0) return arr;
      const [m] = a.splice(fi, 1); a.splice(ti, 0, m);
      return a;
    });
  }

  if (!open) {
    return (
      <div className="watchlist collapsed">
        <button className="wl-toggle" title="Open watchlist" onClick={() => setOpen(true)}>☰</button>
      </div>
    );
  }
  return (
    <div className="watchlist" onClick={() => setMenu(null)}>
      <div className="wl-head">
        <strong>Watchlist</strong>
        <button className="wl-toggle" title="Collapse" onClick={() => setOpen(false)}>«</button>
      </div>
      <input
        className="wl-search"
        placeholder="Search…  (Ctrl+K)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="wl-cats">
        {CATEGORIES.map((c) => (
          <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div className="wl-list">
        {list.map((it) => (
          <div
            key={it.id}
            className="wl-item"
            draggable
            onDragStart={(e) => onDragStart(e, it.id)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, it.id)}
            onDoubleClick={() => activate(it)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, it }); }}
          >
            <span className="wl-star" onClick={(e) => { e.stopPropagation(); toggleFav(it.id); }}>
              {favs.includes(it.id) ? "★" : "☆"}
            </span>
            <span className="wl-sym">{it.symbol}</span>
            <span className="wl-src">{it.source}</span>
          </div>
        ))}
        {!list.length && <div className="wl-empty">No symbols</div>}
      </div>
      <button className="wl-add" onClick={addManual}>+ Add symbol</button>

      {menu && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => { activate(menu.it); setMenu(null); }}>Open (active pane)</div>
          <div className="ctx-item" onClick={() => { onReplaceActive?.(menu.it); setMenu(null); }}>Replace active pane</div>
          <div className="ctx-item" onClick={() => { onOpenInNew?.(menu.it); setMenu(null); }}>Open in new pane</div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={() => { toggleFav(menu.it.id); setMenu(null); }}>
            {favs.includes(menu.it.id) ? "Remove favorite" : "Add favorite"}
          </div>
          <div className="ctx-item danger" onClick={() => { remove(menu.it.id); setMenu(null); }}>Remove</div>
        </div>
      )}
    </div>
  );
}

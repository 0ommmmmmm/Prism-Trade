import React, { useEffect, useMemo, useRef, useState } from "react";
import ChartPane from "./components/ChartPane";
import Watchlist from "./components/Watchlist";
import Toolbar from "./components/Toolbar";
import LayoutMenu from "./components/LayoutMenu";
import CommandPalette from "./components/CommandPalette";
import { fetchSources } from "./lib/api";
import { store, KEYS, loadLayouts, saveLayout } from "./lib/storage";
import { useShortcuts } from "./lib/shortcuts";

const COUNT_OPTIONS = [1, 2, 4, 6, 8];

function defaultPane(sources, i = 0) {
  const src = sources?.sources?.[i % (sources?.sources?.length || 1)] || "hyperliquid";
  const meta = sources?.meta?.[src];
  return {
    source: src,
    symbol: meta?.symbols?.[0] || "",
    interval: meta?.timeframes?.[0] || "1m",
    chartType: "candles",
    indicators: [],
    drawings: [],
  };
}

export default function App() {
  const [sources, setSources] = useState(null);
  const [count, setCount] = useState(() => {
    const v = parseInt(store.get(KEYS.count, 4), 10);
    return COUNT_OPTIONS.includes(v) ? v : 4;
  });
  const [panes, setPanes] = useState(() => store.get(KEYS.panes, []));
  const [activeIdx, setActiveIdx] = useState(0);
  const [tool, setTool] = useState("cursor");
  const [magnet, setMagnet] = useState(false);
  const [watchOpen, setWatchOpen] = useState(() => store.get(KEYS.watchOpen, true));
  const [showLayouts, setShowLayouts] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const toolApiRef = useRef({});

  useEffect(() => { fetchSources().then(setSources).catch(console.error); }, []);
  useEffect(() => {
    if (!sources) return;
    setPanes((cur) => {
      const next = cur.map((p) => ({
        chartType: "candles", indicators: [], drawings: [], ...p,
      }));
      while (next.length < count) next.push(defaultPane(sources, next.length));
      next.length = count;
      return next;
    });
  }, [count, sources]);

  useEffect(() => { store.set(KEYS.count, count); }, [count]);
  useEffect(() => { if (panes.length) store.set(KEYS.panes, panes); }, [panes]);
  useEffect(() => { store.set(KEYS.watchOpen, watchOpen); }, [watchOpen]);
  useEffect(() => { if (activeIdx >= count) setActiveIdx(0); }, [count, activeIdx]);

  // autosave layout every 5s
  useEffect(() => {
    const t = setInterval(() => { saveLayout("_autosave", { count, panes }); }, 5000);
    return () => clearInterval(t);
  }, [count, panes]);

  const updatePane = (i, cfg) => setPanes((p) => p.map((x, idx) => (idx === i ? cfg : x)));
  function activatePane(i) { setActiveIdx(i); }

  function onWatchActivate(it) {
    const cfg = panes[activeIdx]; if (!cfg) return;
    const meta = sources?.meta?.[it.source];
    updatePane(activeIdx, { ...cfg, source: it.source, symbol: it.symbol, interval: meta?.timeframes?.includes(cfg.interval) ? cfg.interval : meta?.timeframes?.[0] || cfg.interval });
  }
  function onOpenInNew(it) {
    if (count >= 8) return alert("Max 8 panels.");
    const next = COUNT_OPTIONS.find((n) => n > count) || 8;
    setCount(next);
    const meta = sources?.meta?.[it.source];
    setPanes((p) => {
      const arr = [...p];
      arr.push({ source: it.source, symbol: it.symbol, interval: meta?.timeframes?.[0] || "1m", chartType: "candles", indicators: [], drawings: [] });
      while (arr.length < next) arr.push(defaultPane(sources, arr.length));
      arr.length = next; return arr;
    });
    setActiveIdx(next - 1);
  }

  useShortcuts(useMemo(() => ({
    palette: () => setShowPalette(true),
    save: () => setShowLayouts(true),
    undo: () => toolApiRef.current?.undo?.(),
    redo: () => toolApiRef.current?.redo?.(),
    delete: () => toolApiRef.current?.del?.(),
    cursor: () => setTool("cursor"),
    cross: () => setTool("cross"),
    trend: () => setTool("trend"),
    hline: () => setTool("hline"),
    vline: () => setTool("vline"),
    rect: () => setTool("rect"),
    fib: () => setTool("fib"),
    measure: () => setTool("measure"),
  }), []));

  // Command palette items
  const paletteItems = useMemo(() => {
    const items = [];
    if (sources) {
      for (const s of sources.sources) {
        for (const sym of sources.meta[s].symbols || []) {
          items.push({ id: `sym:${s}:${sym}`, label: `${sym}`, hint: s, action: () => onWatchActivate({ source: s, symbol: sym }) });
        }
      }
    }
    for (const n of COUNT_OPTIONS) items.push({ id: `cnt:${n}`, label: `Layout: ${n} panels`, hint: "count", action: () => setCount(n) });
    items.push({ id: "cmd:save", label: "Save layout", hint: "Ctrl+S", action: () => setShowLayouts(true) });
    items.push({ id: "cmd:wl", label: watchOpen ? "Hide watchlist" : "Show watchlist", hint: "", action: () => setWatchOpen(!watchOpen) });
    return items;
  }, [sources, watchOpen]);

  const currentSnapshot = { count, panes };

  return (
    <div className="app">
      <div className="topbar">
        <h1>⚡ PRISM</h1>
        <label>Charts:</label>
        <select value={count} onChange={(e) => setCount(parseInt(e.target.value, 10))}>
          {COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className="mini-btn" onClick={() => setShowLayouts(true)} title="Layouts (Ctrl+S)">💾 Layouts</button>
        <button className="mini-btn" onClick={() => setShowPalette(true)} title="Command palette (Ctrl+K)">⌘K</button>
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11 }}>
          {sources ? `${sources.sources.length} sources · active #${activeIdx + 1}` : "loading…"}
        </span>
      </div>
      <div className="body">
        <Watchlist
          open={watchOpen}
          setOpen={setWatchOpen}
          sources={sources}
          onActivate={onWatchActivate}
          onOpenInNew={onOpenInNew}
          onReplaceActive={onWatchActivate}
          activePaneCfg={panes[activeIdx]}
        />
        <Toolbar
          tool={tool} setTool={setTool}
          magnet={magnet} setMagnet={setMagnet}
          onUndo={() => toolApiRef.current?.undo?.()}
          onRedo={() => toolApiRef.current?.redo?.()}
          onDelete={() => toolApiRef.current?.del?.()}
        />
        <div className={`grid n${count}`}>
          {panes.slice(0, count).map((cfg, i) => {
            const wrapped = (next) => updatePane(i, next);
            wrapped.activate = () => activatePane(i);
            return (
              <ChartPane
                key={i}
                paneId={i}
                sources={sources}
                config={cfg}
                onChange={wrapped}
                active={i === activeIdx}
                tool={tool}
                setTool={setTool}
                magnet={magnet}
                toolApiRef={i === activeIdx ? toolApiRef : { current: {} }}
              />
            );
          })}
        </div>
      </div>

      {showLayouts && (
        <div className="dlg-bg" onClick={() => setShowLayouts(false)}>
          <LayoutMenu
            snapshot={currentSnapshot}
            onLoad={(name, l) => { setCount(l.count); setPanes(l.panes); }}
            onClose={() => setShowLayouts(false)}
          />
        </div>
      )}
      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        items={paletteItems}
        onPick={(it) => it.action?.()}
      />
    </div>
  );
}

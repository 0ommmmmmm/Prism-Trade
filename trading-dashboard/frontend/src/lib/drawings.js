// Lightweight drawing engine layered on top of lightweight-charts.
// Strategy: convert two anchor points (logical index + price) to pixels each
// frame, render onto a transparent <canvas> overlay. Survives zoom/pan because
// we re-project on every chart range change and on resize.

import { nanoid } from "./id";

export const TOOLS = [
  { id: "cursor",  label: "Cursor",          key: " " },
  { id: "cross",   label: "Crosshair",       key: "c" },
  { id: "trend",   label: "Trendline",       key: "t" },
  { id: "hline",   label: "Horizontal Line", key: "h" },
  { id: "vline",   label: "Vertical Line",   key: "v" },
  { id: "ray",     label: "Ray" },
  { id: "rect",    label: "Rectangle",       key: "r" },
  { id: "fib",     label: "Fib Retracement", key: "f" },
  { id: "text",    label: "Text" },
  { id: "measure", label: "Measure",         key: "m" },
];

const HIT = 6;

export function createDrawingLayer({ container, chart, mainSeries, getState, setState, getTool, setTool }) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:3;";
  container.style.position = "relative";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let dragNew = null;     // { type, p1, p2 }
  let dragMove = null;    // { id, handle, start }
  let hover = null;
  let selectedId = null;
  let dpr = window.devicePixelRatio || 1;
  let cursor = null;
  let magnet = false;

  function isNavTool() {
    const tool = getTool();
    return tool === "cursor" || tool === "cross";
  }

  function syncPointerEvents() {
    canvas.style.pointerEvents = isNavTool() && !dragNew && !dragMove ? "none" : "auto";
    if (isNavTool() && !dragNew && !dragMove) {
      container.style.cursor = hover ? "grab" : "";
    } else {
      container.style.cursor = "";
    }
  }

  function resize() {
    const r = container.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  // ---- coordinate helpers ------------------------------------------------
  function toPx(p) {
    if (!p) return null;
    const x = chart.timeScale().logicalToCoordinate(p.logical);
    const y = mainSeries.priceToCoordinate(p.price);
    if (x == null || y == null) return null;
    return { x, y };
  }
  function fromPx(x, y, snap = false) {
    const logical = chart.timeScale().coordinateToLogical(x);
    let price = mainSeries.coordinateToPrice(y);
    if (logical == null || price == null) return null;
    if (snap || magnet) {
      // snap to nearest candle index
      const li = Math.round(logical);
      const xx = chart.timeScale().logicalToCoordinate(li);
      const pp = mainSeries.coordinateToPrice(y);
      return { logical: li, price: pp != null ? pp : price };
    }
    return { logical, price };
  }

  // ---- rendering ---------------------------------------------------------
  function strokeShape(d, isHover, isSel) {
    ctx.lineWidth = d.width || 1.5;
    ctx.strokeStyle = d.color || "#4f8cff";
    ctx.fillStyle = (d.color || "#4f8cff") + "22";
    const a = toPx(d.p1), b = toPx(d.p2);
    if (d.type === "hline") {
      const y = a?.y; if (y == null) return;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width / dpr, y); ctx.stroke();
      handle(0, y); handle(canvas.width / dpr, y);
    } else if (d.type === "vline") {
      const x = a?.x; if (x == null) return;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height / dpr); ctx.stroke();
    } else if (d.type === "trend" || d.type === "ray") {
      if (!a || !b) return;
      let x2 = b.x, y2 = b.y;
      if (d.type === "ray") {
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = 5000 / Math.max(1, Math.hypot(dx, dy));
        x2 = a.x + dx * t; y2 = a.y + dy * t;
      }
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(x2, y2); ctx.stroke();
      handle(a.x, a.y, isSel); handle(b.x, b.y, isSel);
    } else if (d.type === "rect") {
      if (!a || !b) return;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
      handle(a.x, a.y, isSel); handle(b.x, b.y, isSel);
    } else if (d.type === "measure") {
      if (!a || !b) return;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.setLineDash([]);
      const dp = d.p2.price - d.p1.price;
      const pct = (dp / d.p1.price) * 100;
      const bars = Math.round(d.p2.logical - d.p1.logical);
      const txt = `${dp >= 0 ? "+" : ""}${dp.toFixed(precision(d.p1.price))}  ${pct.toFixed(2)}%  ${bars} bars`;
      drawLabel(txt, b.x + 6, b.y - 6, dp >= 0 ? "#26a69a" : "#ef5350");
    } else if (d.type === "fib") {
      if (!a || !b) return;
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const colors = ["#7b8593", "#bb6bd9", "#4f8cff", "#f5a623", "#26a69a", "#ef5350", "#7b8593"];
      for (let i = 0; i < levels.length; i++) {
        const p = d.p1.price + (d.p2.price - d.p1.price) * levels[i];
        const y = mainSeries.priceToCoordinate(p);
        if (y == null) continue;
        ctx.strokeStyle = colors[i]; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.min(a.x, b.x), y); ctx.lineTo(Math.max(a.x, b.x), y); ctx.stroke();
        drawLabel(`${levels[i]}  ${p.toFixed(precision(p))}`, Math.max(a.x, b.x) + 4, y + 3, colors[i]);
      }
      handle(a.x, a.y, isSel); handle(b.x, b.y, isSel);
    } else if (d.type === "text") {
      if (!a) return;
      drawLabel(d.text || "Text", a.x, a.y, d.color || "#d8dee9", true);
    }
    if (isHover && !isSel) { ctx.strokeStyle = "#ffffff44"; ctx.lineWidth = 0.5; }
  }

  function handle(x, y, on) {
    ctx.fillStyle = on ? "#4f8cff" : "#d8dee9";
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  function drawLabel(text, x, y, color, box = false) {
    ctx.font = "11px -apple-system,Segoe UI,Roboto,sans-serif";
    const w = ctx.measureText(text).width + 8;
    if (box) {
      ctx.fillStyle = "#161b24"; ctx.fillRect(x, y - 12, w, 16);
      ctx.strokeStyle = color; ctx.strokeRect(x, y - 12, w, 16);
    }
    ctx.fillStyle = color; ctx.fillText(text, x + 4, y);
  }
  function precision(p) { return p >= 1000 ? 2 : p >= 1 ? 3 : 5; }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = getState();
    for (const d of s.drawings) {
      if (d.hidden) continue;
      strokeShape(d, hover === d.id, selectedId === d.id);
    }
    if (dragNew) strokeShape(dragNew, false, true);
    if (magnet && cursor) {
      ctx.strokeStyle = "#4f8cff66"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 6, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ---- hit-testing -------------------------------------------------------
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const x = ax + t * dx, y = ay + t * dy;
    return Math.hypot(px - x, py - y);
  }
  function hitTest(x, y) {
    const s = getState();
    for (let i = s.drawings.length - 1; i >= 0; i--) {
      const d = s.drawings[i]; if (d.hidden || d.locked) continue;
      const a = toPx(d.p1), b = toPx(d.p2);
      if (d.type === "hline" && a && Math.abs(y - a.y) < HIT) return { id: d.id, handle: "body" };
      if (d.type === "vline" && a && Math.abs(x - a.x) < HIT) return { id: d.id, handle: "body" };
      if ((d.type === "trend" || d.type === "ray") && a && b) {
        if (Math.hypot(x - a.x, y - a.y) < HIT) return { id: d.id, handle: "p1" };
        if (Math.hypot(x - b.x, y - b.y) < HIT) return { id: d.id, handle: "p2" };
        if (distToSeg(x, y, a.x, a.y, b.x, b.y) < HIT) return { id: d.id, handle: "body" };
      }
      if ((d.type === "rect" || d.type === "fib" || d.type === "measure") && a && b) {
        if (Math.hypot(x - a.x, y - a.y) < HIT) return { id: d.id, handle: "p1" };
        if (Math.hypot(x - b.x, y - b.y) < HIT) return { id: d.id, handle: "p2" };
        const xl = Math.min(a.x, b.x), xr = Math.max(a.x, b.x);
        const yt = Math.min(a.y, b.y), yb = Math.max(a.y, b.y);
        if (x >= xl && x <= xr && y >= yt && y <= yb) return { id: d.id, handle: "body" };
      }
      if (d.type === "text" && a && Math.hypot(x - a.x, y - a.y) < 12) return { id: d.id, handle: "body" };
    }
    return null;
  }

  // ---- input -------------------------------------------------------------
  function localXY(e) {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function beginDrawingDrag(x, y, h) {
    const s = getState();
    const d = s.drawings.find((q) => q.id === h.id);
    if (!d) return;
    selectedId = h.id;
    dragMove = { id: h.id, handle: h.handle, start: { x, y, p1: { ...d.p1 }, p2: d.p2 ? { ...d.p2 } : null } };
    syncPointerEvents();
    canvas.style.cursor = "grabbing";
    render();
  }

  function onContainerMouseMove(e) {
    if (!isNavTool() || dragNew || dragMove) return;
    const { x, y } = localXY(e);
    cursor = { x, y };
    const h = hitTest(x, y);
    const nextHover = h?.id || null;
    if (nextHover !== hover) {
      hover = nextHover;
      render();
    }
    syncPointerEvents();
    if (magnet) render();
  }

  function onContainerMouseDown(e) {
    if (!isNavTool() || dragNew || dragMove) return;
    const { x, y } = localXY(e);
    const h = hitTest(x, y);
    if (!h) return;
    e.preventDefault();
    e.stopPropagation();
    beginDrawingDrag(x, y, h);
  }

  function onContainerMouseLeave() {
    if (!isNavTool() || dragMove) return;
    hover = null;
    syncPointerEvents();
    render();
  }

  container.addEventListener("mousemove", onContainerMouseMove, { capture: true, passive: true });
  container.addEventListener("mousedown", onContainerMouseDown, { capture: true });
  container.addEventListener("mouseleave", onContainerMouseLeave);

  canvas.addEventListener("mousedown", (e) => {
    const { x, y } = localXY(e);
    const tool = getTool();
    if (tool === "cursor" || tool === "cross") {
      const h = hitTest(x, y);
      selectedId = h?.id || null;
      if (h) beginDrawingDrag(x, y, h);
      else render();
      return;
    }
    const p = fromPx(x, y);
    if (!p) return;
    if (tool === "hline") {
      pushDrawing({ type: "hline", p1: p, color: "#4f8cff", width: 1.5 });
      setTool("cursor"); return;
    }
    if (tool === "vline") {
      pushDrawing({ type: "vline", p1: p, color: "#4f8cff", width: 1.5 });
      setTool("cursor"); return;
    }
    if (tool === "text") {
      const t = prompt("Text:"); if (!t) return;
      pushDrawing({ type: "text", p1: p, text: t, color: "#d8dee9" });
      setTool("cursor"); return;
    }
    dragNew = { id: "_temp", type: tool === "ray" ? "ray" : tool, p1: p, p2: p, color: "#4f8cff", width: 1.5 };
    syncPointerEvents();
    canvas.style.cursor = "crosshair";
  });

  canvas.addEventListener("mousemove", (e) => {
    const { x, y } = localXY(e);
    cursor = { x, y };
    if (dragNew) {
      const p = fromPx(x, y);
      if (p) dragNew.p2 = p;
      render(); return;
    }
    if (dragMove) {
      const s = getState();
      const idx = s.drawings.findIndex((q) => q.id === dragMove.id);
      if (idx < 0) return;
      const d = { ...s.drawings[idx] };
      const startP = fromPx(dragMove.start.x, dragMove.start.y);
      const nowP = fromPx(x, y);
      if (!startP || !nowP) return;
      const dL = nowP.logical - startP.logical;
      const dP = nowP.price - startP.price;
      if (dragMove.handle === "p1") d.p1 = nowP;
      else if (dragMove.handle === "p2") d.p2 = nowP;
      else {
        d.p1 = { logical: dragMove.start.p1.logical + dL, price: dragMove.start.p1.price + dP };
        if (dragMove.start.p2) d.p2 = { logical: dragMove.start.p2.logical + dL, price: dragMove.start.p2.price + dP };
      }
      const next = s.drawings.slice(); next[idx] = d;
      setState({ ...s, drawings: next }, /*record*/ false);
      render(); return;
    }
    const h = hitTest(x, y);
    hover = h?.id || null;
    canvas.style.cursor = isNavTool() ? (h ? "grab" : "default") : "crosshair";
    syncPointerEvents();
    if (magnet) render();
  });

  function finishPointerUp() {
    if (dragNew) {
      const d = { ...dragNew, id: nanoid() };
      pushDrawing(d);
      dragNew = null;
      setTool("cursor");
    }
    if (dragMove) {
      commit();
      dragMove = null;
      canvas.style.cursor = "default";
    }
    syncPointerEvents();
  }

  canvas.addEventListener("mouseup", finishPointerUp);
  window.addEventListener("mouseup", finishPointerUp);

  canvas.addEventListener("dblclick", (e) => {
    const { x, y } = localXY(e);
    const h = hitTest(x, y); if (!h) return;
    const s = getState();
    const d = s.drawings.find((q) => q.id === h.id); if (!d) return;
    const color = prompt("Color (hex or name):", d.color || "#4f8cff"); if (!color) return;
    const next = s.drawings.map((q) => (q.id === d.id ? { ...q, color } : q));
    setState({ ...s, drawings: next });
  });

  function pushDrawing(d) {
    const s = getState();
    setState({ ...s, drawings: [...s.drawings, { id: d.id || nanoid(), ...d }] });
  }
  function commit() {
    const s = getState();
    setState({ ...s, drawings: s.drawings.slice() }); // bump record
  }

  // public API ---------------------------------------------
  const api = {
    render, resize,
    refreshTool: () => { syncPointerEvents(); render(); },
    setMagnet: (v) => { magnet = v; render(); },
    deleteSelected: () => {
      if (!selectedId) return false;
      const s = getState();
      setState({ ...s, drawings: s.drawings.filter((d) => d.id !== selectedId) });
      selectedId = null; render();
      return true;
    },
    clear: () => { selectedId = null; render(); },
    destroy: () => {
      ro?.disconnect();
      container.removeEventListener("mousemove", onContainerMouseMove, { capture: true });
      container.removeEventListener("mousedown", onContainerMouseDown, { capture: true });
      container.removeEventListener("mouseleave", onContainerMouseLeave);
      window.removeEventListener("mouseup", finishPointerUp);
      canvas.remove();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(render);
    },
  };

  chart.timeScale().subscribeVisibleLogicalRangeChange(render);
  const ro = new ResizeObserver(resize); ro.observe(container);
  resize();
  syncPointerEvents();
  return api;
}

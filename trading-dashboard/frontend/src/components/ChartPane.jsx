import React, { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import { fetchCandles, fetchQuote, openStream } from "../lib/api";
import { buildSeriesSpec, CHART_TYPES } from "../lib/chartTypes";
import { INDICATORS } from "../lib/indicators";
import { createDrawingLayer } from "../lib/drawings";
import IndicatorMenu from "./IndicatorMenu";

const POLL_MS = 3000;
const SUB_MINUTE_SEC = { "10s": 10, "15s": 15 };
const RIGHT_OFFSET = 8;
const BAR_SPACING = 8;
const MIN_BAR_SPACING = 2;
const LIVE_EDGE_TOLERANCE = 2;

function bucketStart(ts, seconds) {
  return Math.floor(ts / seconds) * seconds;
}

function isSubMinute(interval) {
  return interval in SUB_MINUTE_SEC;
}

function chartOptions(secondsVisible) {
  return {
    layout: { background: { color: "#11151c" }, textColor: "#d8dee9" },
    grid: { vertLines: { color: "#1f2632" }, horzLines: { color: "#1f2632" } },
    timeScale: {
      borderColor: "#1f2632",
      timeVisible: true,
      secondsVisible,
      rightOffset: RIGHT_OFFSET,
      barSpacing: BAR_SPACING,
      minBarSpacing: MIN_BAR_SPACING,
      fixLeftEdge: false,
      fixRightEdge: false,
      lockVisibleTimeRangeOnResize: false,
      shiftVisibleRangeOnNewBar: true,
    },
    rightPriceScale: { borderColor: "#1f2632" },
    crosshair: { mode: CrosshairMode.Normal },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: true,
    },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: true,
      axisDoubleClickReset: true,
    },
    kineticScroll: {
      mouse: true,
      touch: true,
    },
    autoSize: true,
  };
}

function lastPoint(data) {
  return data.length ? data[data.length - 1] : null;
}

export default function ChartPane({
  paneId, sources, config, onChange, active, tool, setTool, magnet,
  toolApiRef,
}) {
  const { source, symbol, interval, chartType = "candles", indicators = [], drawings = [] } = config;
  const wrapRef = useRef(null);
  const mainRef = useRef(null);
  const subRef = useRef(null);
  const chartRef = useRef(null);
  const subChartRef = useRef(null);
  const mainSeriesRef = useRef(null);
  const overlaySeriesRef = useRef([]);   // indicator overlay series on main
  const subSeriesRef = useRef([]);
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  const lastPriceRef = useRef(null);
  const candlesRef = useRef([]);
  const drawApiRef = useRef(null);
  const drawingsRef = useRef(drawings);
  const histRef = useRef({ past: [], future: [] });
  const autoFollowRef = useRef(true);
  const ignoreRangeRef = useRef(false);
  const syncingRangeRef = useRef(false);
  const [tick, setTick] = useState({ price: null, dir: 0, prev: null });
  const [autoFollow, setAutoFollow] = useState(true);
  const [showInd, setShowInd] = useState(false);

  const hasSub = indicators.some((i) => INDICATORS[i.id]?.pane === "sub");
  const subHeight = hasSub ? Math.max(...indicators.filter((i) => INDICATORS[i.id]?.pane === "sub").map((i) => INDICATORS[i.id].height || 110)) : 0;

  const subMinute = isSubMinute(interval);
  const bucketSec = SUB_MINUTE_SEC[interval];

  function setAutoFollowMode(next) {
    if (autoFollowRef.current === next) return;
    autoFollowRef.current = next;
    setAutoFollow(next);
    chartRef.current?.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: next } });
    subChartRef.current?.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: next } });
  }

  function isAtLiveEdge() {
    const pos = chartRef.current?.timeScale().scrollPosition?.();
    return pos == null || pos <= RIGHT_OFFSET + LIVE_EDGE_TOLERANCE;
  }

  function goToLive() {
    setAutoFollowMode(true);
    ignoreRangeRef.current = true;
    chartRef.current?.timeScale().scrollToRealTime();
    subChartRef.current?.timeScale().scrollToRealTime();
    requestAnimationFrame(() => { ignoreRangeRef.current = false; });
  }

  // Mount charts (main + optional sub)
  useEffect(() => {
    const chart = createChart(mainRef.current, chartOptions(subMinute));
    chartRef.current = chart;
    const onVisibleRange = () => {
      if (ignoreRangeRef.current) return;
      setAutoFollowMode(isAtLiveEdge());
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRange);

    drawApiRef.current = createDrawingLayer({
      container: mainRef.current,
      chart,
      // mainSeries set after first build
      mainSeries: { priceToCoordinate: () => null, coordinateToPrice: () => null },
      getState: () => ({ drawings: drawingsRef.current }),
      setState: (s) => {
        const prev = drawingsRef.current;
        if (prev !== s.drawings) {
          histRef.current.past.push(prev);
          if (histRef.current.past.length > 50) histRef.current.past.shift();
          histRef.current.future = [];
        }
        drawingsRef.current = s.drawings;
        onChangeRef.current?.({ drawings: s.drawings });
      },
      getTool: () => toolRef.current,
      setTool: (t) => setToolRef.current?.(t),
    });

    return () => {
      drawApiRef.current?.destroy?.();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRange);
      chart.remove();
      if (subChartRef.current) { subChartRef.current.remove(); subChartRef.current = null; }
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible: subMinute } });
    subChartRef.current?.applyOptions({ timeScale: { secondsVisible: false } });
  }, [subMinute]);

  // Keep refs current
  const onChangeRef = useRef();
  const toolRef = useRef(tool);
  const setToolRef = useRef(setTool);
  useEffect(() => { onChangeRef.current = (patch) => onChange({ ...config, ...patch }); });
  useEffect(() => { toolRef.current = active ? tool : "cursor"; drawApiRef.current?.refreshTool?.(); }, [tool, active]);
  useEffect(() => { setToolRef.current = setTool; }, [setTool]);
  useEffect(() => { drawingsRef.current = drawings; drawApiRef.current?.render?.(); }, [drawings]);
  useEffect(() => { drawApiRef.current?.setMagnet?.(!!magnet && active); }, [magnet, active]);

  // Expose imperative API to parent for toolbar actions on the active pane
  useEffect(() => {
    if (!active) return;
    toolApiRef.current = {
      undo: () => {
        const h = histRef.current; if (!h.past.length) return;
        h.future.push(drawingsRef.current);
        const prev = h.past.pop();
        drawingsRef.current = prev;
        onChangeRef.current?.({ drawings: prev });
      },
      redo: () => {
        const h = histRef.current; if (!h.future.length) return;
        h.past.push(drawingsRef.current);
        const next = h.future.pop();
        drawingsRef.current = next;
        onChangeRef.current?.({ drawings: next });
      },
      del: () => drawApiRef.current?.deleteSelected?.(),
    };
  }, [active]);

  // ---- (re)build main series whenever chartType changes ----
  function buildMain() {
    const chart = chartRef.current; if (!chart) return;
    if (mainSeriesRef.current) { chart.removeSeries(mainSeriesRef.current); mainSeriesRef.current = null; }
    const spec = buildSeriesSpec(chartType, candlesRef.current);
    let s;
    if (spec.kind === "candle") s = chart.addCandlestickSeries(spec.options);
    else if (spec.kind === "bar") s = chart.addBarSeries(spec.options);
    else if (spec.kind === "line") s = chart.addLineSeries(spec.options);
    else if (spec.kind === "area") s = chart.addAreaSeries(spec.options);
    else if (spec.kind === "baseline") s = chart.addBaselineSeries(spec.options);
    s.setData(spec.data);
    mainSeriesRef.current = s;
    // patch drawing layer's main series so price <-> coord still works
    if (drawApiRef.current) {
      drawApiRef.current._main = s; // not used; mainSeries is captured by closure
    }
    // rebuild closure-captured mainSeries by recreating drawing layer references
    // (we re-create the layer cheaply only on first build; afterwards we patch via prototype trick below)
  }

  function updateMainSeriesFromBuffer() {
    const ms = mainSeriesRef.current;
    if (!ms) return;
    const spec = buildSeriesSpec(chartType, candlesRef.current);
    const point = lastPoint(spec.data);
    if (point) ms.update(point);
  }

  // we want drawings to always use the latest mainSeries; rebuild layer when series changes
  function rebuildDrawingLayer() {
    drawApiRef.current?.destroy?.();
    drawApiRef.current = createDrawingLayer({
      container: mainRef.current,
      chart: chartRef.current,
      mainSeries: mainSeriesRef.current,
      getState: () => ({ drawings: drawingsRef.current }),
      setState: (s) => {
        const prev = drawingsRef.current;
        if (prev !== s.drawings) {
          histRef.current.past.push(prev);
          if (histRef.current.past.length > 50) histRef.current.past.shift();
          histRef.current.future = [];
        }
        drawingsRef.current = s.drawings;
        onChangeRef.current?.({ drawings: s.drawings });
      },
      getTool: () => toolRef.current,
      setTool: (t) => setToolRef.current?.(t),
    });
    drawApiRef.current.setMagnet(!!magnet && active);
  }

  // build/refresh indicator overlays
  function rebuildIndicators() {
    const chart = chartRef.current; if (!chart) return;
    for (const s of overlaySeriesRef.current) chart.removeSeries(s);
    overlaySeriesRef.current = [];
    if (subChartRef.current) {
      for (const s of subSeriesRef.current) subChartRef.current.removeSeries(s);
      subSeriesRef.current = [];
    }

    for (const ind of indicators) {
      const def = INDICATORS[ind.id]; if (!def) continue;
      const specs = def.compute(candlesRef.current, ind.params);
      if (def.pane === "overlay") {
        for (const sp of specs) {
          const s = chart.addLineSeries({ color: sp.color, lineWidth: sp.lineWidth, lineStyle: sp.lineStyle, priceLineVisible: false, lastValueVisible: false, title: sp.title });
          s.setData(sp.data);
          overlaySeriesRef.current.push(s);
        }
      }
    }

    if (!hasSub) {
      if (subChartRef.current) { subChartRef.current.remove(); subChartRef.current = null; }
      return;
    }
    if (!subChartRef.current) {
      subChartRef.current = createChart(subRef.current, chartOptions(false));
      // sync time scales
      chartRef.current.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (!r || syncingRangeRef.current) return;
        syncingRangeRef.current = true;
        subChartRef.current?.timeScale().setVisibleLogicalRange(r);
        syncingRangeRef.current = false;
      });
      subChartRef.current.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (!r || syncingRangeRef.current) return;
        syncingRangeRef.current = true;
        chartRef.current?.timeScale().setVisibleLogicalRange(r);
        syncingRangeRef.current = false;
      });
    }
    for (const ind of indicators) {
      const def = INDICATORS[ind.id]; if (!def || def.pane !== "sub") continue;
      const specs = def.compute(candlesRef.current, ind.params);
      for (const sp of specs) {
        let s;
        if (sp.type === "histogram") s = subChartRef.current.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        else s = subChartRef.current.addLineSeries({ color: sp.color, lineWidth: sp.lineWidth, priceLineVisible: false, lastValueVisible: false, title: sp.title });
        s.setData(sp.data);
        if (sp.levels) {
          for (const lv of sp.levels) s.createPriceLine({ price: lv, color: "#7b8593", lineStyle: 2, lineWidth: 1 });
        }
        subSeriesRef.current.push(s);
      }
    }
  }

  function updateIndicatorsFromBuffer() {
    let overlayIdx = 0;
    let subIdx = 0;
    for (const ind of indicators) {
      const def = INDICATORS[ind.id]; if (!def) continue;
      const specs = def.compute(candlesRef.current, ind.params);
      if (def.pane === "overlay") {
        for (const sp of specs) {
          const point = lastPoint(sp.data);
          if (point) overlaySeriesRef.current[overlayIdx]?.update(point);
          overlayIdx += 1;
        }
      } else if (def.pane === "sub") {
        for (const sp of specs) {
          const point = lastPoint(sp.data);
          if (point) subSeriesRef.current[subIdx]?.update(point);
          subIdx += 1;
        }
      }
    }
  }

  // Initial build whenever chartType changes
  useEffect(() => {
    if (!chartRef.current) return;
    buildMain();
    rebuildDrawingLayer();
    rebuildIndicators();
    // eslint-disable-next-line
  }, [chartType]);

  useEffect(() => {
    rebuildIndicators();
    // eslint-disable-next-line
  }, [JSON.stringify(indicators), hasSub]);

  // Load history & wire live updates when symbol/source/interval changes
  useEffect(() => {
    let cancelled = false;
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!symbol) return;
    setAutoFollowMode(true);

    (async () => {
      try {
        const candles = await fetchCandles(source, symbol, interval);
        if (cancelled) return;
        candlesRef.current = candles;
        buildMain();
        rebuildDrawingLayer();
        rebuildIndicators();
        if (candles.length) {
          const p = candles[candles.length - 1].close;
          lastPriceRef.current = p;
          setTick({ price: p, dir: 0, prev: p });
        }
        if (candles.length) {
          ignoreRangeRef.current = true;
          chartRef.current?.timeScale().fitContent();
          chartRef.current?.timeScale().scrollToRealTime();
          subChartRef.current?.timeScale().fitContent();
          subChartRef.current?.timeScale().scrollToRealTime();
          requestAnimationFrame(() => { ignoreRangeRef.current = false; });
        }
      } catch (e) { console.error(e); }
    })();

    if (source === "hyperliquid" && !subMinute) {
      wsRef.current = openStream({
        source, symbol, interval,
        onCandle: (c) => {
          // update underlying buffer
          const buf = candlesRef.current;
          if (buf.length && buf[buf.length - 1].time === c.time) buf[buf.length - 1] = c;
          else buf.push(c);
          // update main series quickly using update()
          updateMainSeriesFromBuffer();
          updateTick(c.close);
          throttleUpdateIndicators();
        },
        onError: (e) => console.warn("stream", e),
      });
    } else {
      pollRef.current = setInterval(async () => {
        const p = await fetchQuote(source, symbol);
        if (p != null) {
          if (subMinute) updateSubMinuteBar(p);
          updateTick(p);
        }
      }, subMinute ? bucketSec * 1000 : POLL_MS);
    }
    return () => {
      cancelled = true;
      if (wsRef.current) wsRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line
  }, [source, symbol, interval]);

  const throttleTimer = useRef(0);
  function throttleUpdateIndicators() {
    if (throttleTimer.current) return;
    throttleTimer.current = setTimeout(() => { throttleTimer.current = 0; updateIndicatorsFromBuffer(); }, 750);
  }

  function updateSubMinuteBar(price) {
    const now = Math.floor(Date.now() / 1000);
    const t = bucketStart(now, bucketSec);
    const buf = candlesRef.current;
    const last = buf[buf.length - 1];
    let c;
    if (last && last.time === t) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      c = last;
    } else {
      c = { time: t, open: price, high: price, low: price, close: price, volume: 0 };
      buf.push(c);
    }
    updateMainSeriesFromBuffer();
    throttleUpdateIndicators();
  }

  function updateTick(price) {
    const prev = lastPriceRef.current;
    const dir = prev == null ? 0 : price > prev ? 1 : price < prev ? -1 : 0;
    lastPriceRef.current = price;
    setTick({ price, dir, prev });
    setTimeout(() => setTick((t) => (t.price === price ? { ...t, dir: 0 } : t)), 600);
  }

  const meta = sources?.meta?.[source];
  const symbols = meta?.symbols || [];
  const timeframes = meta?.timeframes || [];
  const delta = tick.prev != null && tick.price != null ? tick.price - tick.prev : 0;
  const flashCls = tick.dir > 0 ? "up" : tick.dir < 0 ? "down" : "";

  return (
    <div className={`pane ${active ? "active" : ""}`} onMouseDown={() => onChange.activate?.()} onClick={(e) => onChange.activate?.()}>
      <div className="pane-head">
        <select value={source} onChange={(e) => {
          const ns = e.target.value;
          const nm = sources?.meta?.[ns];
          onChange({ ...config, source: ns, symbol: nm?.symbols?.[0] || "", interval: nm?.timeframes?.[0] || "1m" });
        }}>
          {(sources?.sources || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={symbol} onChange={(e) => onChange({ ...config, symbol: e.target.value })}>
          {symbols.includes(symbol) ? null : <option value={symbol}>{symbol}</option>}
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={interval} onChange={(e) => onChange({ ...config, interval: e.target.value })}>
          {timeframes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={chartType} onChange={(e) => onChange({ ...config, chartType: e.target.value })} title="Chart type">
          {Object.entries(CHART_TYPES).map(([id, def]) => <option key={id} value={id}>{def.label}</option>)}
        </select>
        <button className="mini-btn" onClick={(e) => { e.stopPropagation(); setShowInd(true); }}>ƒx {indicators.length || ""}</button>
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11 }}>#{paneId + 1}</span>
      </div>
      <div className={`ticker ${flashCls}`}>
        <span className="sym">{symbol}</span>
        <span>
          <span className="price">{tick.price != null ? formatPrice(tick.price) : "—"}</span>
          {tick.prev != null && tick.price != null && (
            <span className={`delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(precisionFor(tick.price))}
            </span>
          )}
        </span>
      </div>
      <div className="chart-wrap" ref={wrapRef}>
        <div className="chart" ref={mainRef} />
        {hasSub && <div className="chart sub" style={{ height: subHeight }} ref={subRef} />}
        {!autoFollow && (
          <button
            className="go-live"
            onClick={(e) => { e.stopPropagation(); goToLive(); }}
            title="Return to realtime"
          >
            Go to Live
          </button>
        )}
      </div>
      {showInd && (
        <div className="dlg-bg" onClick={() => setShowInd(false)}>
          <IndicatorMenu
            list={indicators}
            onChange={(next) => onChange({ ...config, indicators: next })}
            onClose={() => setShowInd(false)}
          />
        </div>
      )}
    </div>
  );
}

function precisionFor(p) { if (p >= 1000) return 2; if (p >= 1) return 3; return 5; }
function formatPrice(p) {
  return p.toLocaleString(undefined, { minimumFractionDigits: precisionFor(p), maximumFractionDigits: precisionFor(p) });
}

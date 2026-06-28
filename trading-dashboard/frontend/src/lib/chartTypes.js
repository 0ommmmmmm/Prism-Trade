// Chart-type adapters. Given candles, produce { seriesType, data, options }.

function heikinAshi(c) {
  const out = [];
  let prevOpen = null, prevClose = null;
  for (const k of c) {
    const haClose = (k.open + k.high + k.low + k.close) / 4;
    const haOpen = prevOpen == null ? (k.open + k.close) / 2 : (prevOpen + prevClose) / 2;
    const haHigh = Math.max(k.high, haOpen, haClose);
    const haLow = Math.min(k.low, haOpen, haClose);
    out.push({ time: k.time, open: haOpen, high: haHigh, low: haLow, close: haClose });
    prevOpen = haOpen; prevClose = haClose;
  }
  return out;
}

export const CHART_TYPES = {
  candles:   { label: "Candles",        series: "candle" },
  hollow:    { label: "Hollow Candles", series: "candle", hollow: true },
  bars:      { label: "Bars",           series: "bar" },
  line:      { label: "Line",           series: "line" },
  area:      { label: "Area",           series: "area" },
  baseline:  { label: "Baseline",       series: "baseline" },
  heikin:    { label: "Heikin Ashi",    series: "candle", transform: heikinAshi },
  step:      { label: "Step Line",      series: "line", stepLine: true },
};

export function buildSeriesSpec(typeId, candles) {
  const def = CHART_TYPES[typeId] || CHART_TYPES.candles;
  const data = def.transform ? def.transform(candles) : candles;
  if (def.series === "candle") {
    return {
      kind: "candle",
      data,
      options: def.hollow
        ? {
            upColor: "rgba(0,0,0,0)", downColor: "#ef5350",
            borderUpColor: "#26a69a", borderDownColor: "#ef5350",
            wickUpColor: "#26a69a", wickDownColor: "#ef5350",
          }
        : {
            upColor: "#26a69a", downColor: "#ef5350",
            borderUpColor: "#26a69a", borderDownColor: "#ef5350",
            wickUpColor: "#26a69a", wickDownColor: "#ef5350",
          },
    };
  }
  if (def.series === "bar") {
    return { kind: "bar", data, options: { upColor: "#26a69a", downColor: "#ef5350" } };
  }
  // line/area/baseline expect {time,value}
  const linePts = data.map((k) => ({ time: k.time, value: k.close }));
  if (def.series === "line") {
    return { kind: "line", data: linePts, options: { color: "#4f8cff", lineWidth: 2, ...(def.stepLine ? { lineType: 2 } : {}) } };
  }
  if (def.series === "area") {
    return { kind: "area", data: linePts, options: { lineColor: "#4f8cff", topColor: "rgba(79,140,255,0.4)", bottomColor: "rgba(79,140,255,0.02)", lineWidth: 2 } };
  }
  if (def.series === "baseline") {
    const base = linePts.length ? linePts[0].value : 0;
    return {
      kind: "baseline",
      data: linePts,
      options: {
        baseValue: { type: "price", price: base },
        topLineColor: "#26a69a", topFillColor1: "rgba(38,166,154,0.4)", topFillColor2: "rgba(38,166,154,0.02)",
        bottomLineColor: "#ef5350", bottomFillColor1: "rgba(239,83,80,0.4)", bottomFillColor2: "rgba(239,83,80,0.02)",
      },
    };
  }
  return { kind: "candle", data, options: {} };
}

export function chartTypeIds() { return Object.keys(CHART_TYPES); }

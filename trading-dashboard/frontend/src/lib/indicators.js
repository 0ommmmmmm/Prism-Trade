// Pure functions: input = candles [{time,open,high,low,close,volume}], output = lightweight-charts line data.
// Add a new indicator in ONE place: register it in INDICATORS below.

const lineAt = (time, value) => ({ time, value });

function sma(candles, period = 20, src = "close") {
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i][src];
    if (i >= period) sum -= candles[i - period][src];
    if (i >= period - 1) out.push(lineAt(candles[i].time, sum / period));
  }
  return out;
}

function ema(candles, period = 20, src = "close") {
  const out = [];
  if (!candles.length) return out;
  const k = 2 / (period + 1);
  let prev = candles[0][src];
  for (let i = 0; i < candles.length; i++) {
    const v = candles[i][src];
    prev = i === 0 ? v : v * k + prev * (1 - k);
    if (i >= period - 1) out.push(lineAt(candles[i].time, prev));
  }
  return out;
}

function vwap(candles) {
  const out = [];
  let cumPV = 0, cumV = 0, day = null;
  for (const c of candles) {
    const d = new Date(c.time * 1000).toISOString().slice(0, 10);
    if (d !== day) { cumPV = 0; cumV = 0; day = d; }
    const tp = (c.high + c.low + c.close) / 3;
    const v = c.volume || 1;
    cumPV += tp * v; cumV += v;
    out.push(lineAt(c.time, cumPV / cumV));
  }
  return out;
}

function bollinger(candles, period = 20, mult = 2) {
  const mid = sma(candles, period);
  const upper = [], lower = [];
  for (let i = period - 1; i < candles.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += candles[j].close;
    const mean = s / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (candles[j].close - mean) ** 2;
    const sd = Math.sqrt(sq / period);
    upper.push(lineAt(candles[i].time, mean + mult * sd));
    lower.push(lineAt(candles[i].time, mean - mult * sd));
  }
  return { mid, upper, lower };
}

function rsi(candles, period = 14) {
  const out = [];
  if (candles.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out.push(lineAt(candles[period].time, 100 - 100 / (1 + (loss === 0 ? 100 : gain / loss))));
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out.push(lineAt(candles[i].time, 100 - 100 / (1 + (loss === 0 ? 100 : gain / loss))));
  }
  return out;
}

function macd(candles, fast = 12, slow = 26, signal = 9) {
  const eFast = ema(candles, fast);
  const eSlow = ema(candles, slow);
  const map = new Map(eFast.map((p) => [p.time, p.value]));
  const macdLine = eSlow.map((p) => lineAt(p.time, (map.get(p.time) ?? p.value) - p.value));
  // signal = EMA of macd
  const sigCandles = macdLine.map((p) => ({ time: p.time, close: p.value }));
  const sigLine = ema(sigCandles, signal);
  const sigMap = new Map(sigLine.map((p) => [p.time, p.value]));
  const hist = macdLine
    .filter((p) => sigMap.has(p.time))
    .map((p) => ({ time: p.time, value: p.value - sigMap.get(p.time), color: p.value >= sigMap.get(p.time) ? "rgba(38,166,154,0.6)" : "rgba(239,83,80,0.6)" }));
  return { macd: macdLine, signal: sigLine, hist };
}

function atr(candles, period = 14) {
  const out = [];
  if (candles.length < 2) return out;
  let prev = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    prev = i <= period ? (prev * (i - 1) + tr) / i : (prev * (period - 1) + tr) / period;
    if (i >= period) out.push(lineAt(c.time, prev));
  }
  return out;
}

function stochastic(candles, period = 14, k = 3) {
  const out = [];
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low < lo) lo = candles[j].low;
    }
    const v = hi === lo ? 50 : ((candles[i].close - lo) / (hi - lo)) * 100;
    out.push(lineAt(candles[i].time, v));
  }
  // %K smoothing
  const smooth = [];
  for (let i = k - 1; i < out.length; i++) {
    let s = 0;
    for (let j = i - k + 1; j <= i; j++) s += out[j].value;
    smooth.push(lineAt(out[i].time, s / k));
  }
  return smooth;
}

function obv(candles) {
  const out = [];
  let v = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i > 0) {
      if (candles[i].close > candles[i - 1].close) v += candles[i].volume || 0;
      else if (candles[i].close < candles[i - 1].close) v -= candles[i].volume || 0;
    }
    out.push(lineAt(candles[i].time, v));
  }
  return out;
}

// Registry: id -> { label, pane: 'overlay' | 'sub', defaults, compute -> series specs }
export const INDICATORS = {
  sma: {
    label: "SMA", pane: "overlay",
    defaults: { period: 20, color: "#4f8cff", width: 2 },
    compute: (c, p) => [{ type: "line", data: sma(c, p.period), color: p.color, lineWidth: p.width, title: `SMA ${p.period}` }],
  },
  ema: {
    label: "EMA", pane: "overlay",
    defaults: { period: 20, color: "#f5a623", width: 2 },
    compute: (c, p) => [{ type: "line", data: ema(c, p.period), color: p.color, lineWidth: p.width, title: `EMA ${p.period}` }],
  },
  vwap: {
    label: "VWAP", pane: "overlay",
    defaults: { color: "#bb6bd9", width: 2 },
    compute: (c, p) => [{ type: "line", data: vwap(c), color: p.color, lineWidth: p.width, title: "VWAP" }],
  },
  bb: {
    label: "Bollinger Bands", pane: "overlay",
    defaults: { period: 20, mult: 2, color: "#7b8593", width: 1 },
    compute: (c, p) => {
      const b = bollinger(c, p.period, p.mult);
      return [
        { type: "line", data: b.upper, color: p.color, lineWidth: p.width, title: "BB up" },
        { type: "line", data: b.mid, color: p.color, lineWidth: p.width, lineStyle: 2, title: "BB mid" },
        { type: "line", data: b.lower, color: p.color, lineWidth: p.width, title: "BB lo" },
      ];
    },
  },
  rsi: {
    label: "RSI", pane: "sub", height: 110,
    defaults: { period: 14, color: "#4f8cff", width: 2 },
    compute: (c, p) => [{ type: "line", data: rsi(c, p.period), color: p.color, lineWidth: p.width, title: `RSI ${p.period}`, levels: [30, 70] }],
  },
  macd: {
    label: "MACD", pane: "sub", height: 130,
    defaults: { fast: 12, slow: 26, signal: 9 },
    compute: (c, p) => {
      const m = macd(c, p.fast, p.slow, p.signal);
      return [
        { type: "histogram", data: m.hist, title: "MACD hist" },
        { type: "line", data: m.macd, color: "#4f8cff", lineWidth: 2, title: "MACD" },
        { type: "line", data: m.signal, color: "#f5a623", lineWidth: 2, title: "signal" },
      ];
    },
  },
  atr: {
    label: "ATR", pane: "sub", height: 100,
    defaults: { period: 14, color: "#bb6bd9", width: 2 },
    compute: (c, p) => [{ type: "line", data: atr(c, p.period), color: p.color, lineWidth: p.width, title: `ATR ${p.period}` }],
  },
  stoch: {
    label: "Stochastic", pane: "sub", height: 110,
    defaults: { period: 14, k: 3, color: "#26a69a", width: 2 },
    compute: (c, p) => [{ type: "line", data: stochastic(c, p.period, p.k), color: p.color, lineWidth: p.width, title: `Stoch ${p.period}`, levels: [20, 80] }],
  },
  obv: {
    label: "OBV", pane: "sub", height: 110,
    defaults: { color: "#7b8593", width: 2 },
    compute: (c, p) => [{ type: "line", data: obv(c), color: p.color, lineWidth: p.width, title: "OBV" }],
  },
};

export function indicatorIds() {
  return Object.keys(INDICATORS);
}

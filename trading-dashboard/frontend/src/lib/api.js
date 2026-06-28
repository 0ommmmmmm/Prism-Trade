const BASE = ""; // same origin via Vite proxy

export async function fetchSources() {
  const r = await fetch(`${BASE}/api/sources`);
  return r.json();
}

export async function fetchCandles(source, symbol, interval, limit = 500) {
  const url = `${BASE}/api/candles?source=${source}&symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`candles ${r.status}`);
  return (await r.json()).candles || [];
}

export async function fetchQuote(source, symbol) {
  const r = await fetch(
    `${BASE}/api/quote?source=${source}&symbol=${encodeURIComponent(symbol)}`
  );
  if (!r.ok) return null;
  return (await r.json()).price;
}

// Live WebSocket bridge for push-capable sources (Hyperliquid).
export function openStream({ source, symbol, interval, onCandle, onError }) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws/stream`);
  ws.onopen = () => ws.send(JSON.stringify({ source, symbol, interval }));
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.error) onError?.(msg.error);
      else onCandle(msg);
    } catch {}
  };
  ws.onerror = (e) => onError?.(e);
  return ws;
}

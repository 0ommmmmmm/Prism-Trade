"""
Pluggable data-source layer.

Add a new broker/exchange in ONE place:
    1. Subclass `DataSource`.
    2. Implement `candles()` and (optionally) `quote()` / `stream()`.
    3. Decorate the class with `@register("name")`.

The Flask app discovers sources via `get_source(name)` — no other files
need to change to add Alpaca / Binance / Zerodha / Polygon / etc.
"""
from __future__ import annotations

import asyncio
import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, asdict
from typing import AsyncIterator, Callable, Dict, List, Optional

import requests


# ---------- shared types ----------------------------------------------------
SUB_MINUTE_SECONDS = {"10s": 10, "15s": 15}


def expand_sub_minute(candles: List[Candle], bar_seconds: int) -> List[Candle]:
    """Synthesize sub-minute bars from 1m candles (Yahoo/Hyperliquid have no native 10s/15s)."""
    if bar_seconds <= 0 or 60 % bar_seconds != 0:
        return candles
    out: List[Candle] = []
    bars_per_minute = 60 // bar_seconds
    for c in candles:
        for i in range(bars_per_minute):
            t = c.time + i * bar_seconds
            o = c.open + (c.close - c.open) * (i / bars_per_minute)
            cl = c.open + (c.close - c.open) * ((i + 1) / bars_per_minute)
            h = max(o, cl, min(c.high, max(o, cl)))
            l = min(o, cl, max(c.low, min(o, cl)))
            vol = (c.volume or 0) / bars_per_minute
            out.append(Candle(time=t, open=o, high=h, low=l, close=cl, volume=vol))
    return out


def _yf_scalar(row, col: str) -> float:
    val = row[col]
    if hasattr(val, "iloc"):
        val = val.iloc[0]
    return float(val)


@dataclass
class Candle:
    time: int          # unix seconds (lightweight-charts format)
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


# ---------- registry --------------------------------------------------------
_REGISTRY: Dict[str, "DataSource"] = {}


def register(name: str) -> Callable:
    def deco(cls):
        _REGISTRY[name] = cls()
        cls._source_name = name
        return cls
    return deco


def get_source(name: str) -> "DataSource":
    if name not in _REGISTRY:
        raise KeyError(f"Unknown data source: {name}. Available: {list(_REGISTRY)}")
    return _REGISTRY[name]


def list_sources() -> List[str]:
    return list(_REGISTRY)


# ---------- base class ------------------------------------------------------
class DataSource(ABC):
    """All data sources implement this contract."""

    #: human-friendly default symbol list shown in the dropdown
    default_symbols: List[str] = []
    #: timeframes this source supports (label -> source-specific code)
    timeframes: Dict[str, str] = {}

    @abstractmethod
    def candles(self, symbol: str, interval: str, limit: int = 500) -> List[Candle]:
        """Return historical candles (oldest -> newest)."""

    def quote(self, symbol: str) -> Optional[float]:
        """Return last traded price (used for polling sources)."""
        candles = self.candles(symbol, list(self.timeframes.values())[0], limit=2)
        return candles[-1].close if candles else None

    async def stream(self, symbol: str, interval: str) -> AsyncIterator[Candle]:
        """Async generator of live candles. Override for true push sources."""
        # default: do nothing, app will fall back to polling /api/quote
        if False:
            yield  # pragma: no cover


# =========================================================================
# yfinance  (Indian equities + anything Yahoo carries)
# =========================================================================
@register("yfinance")
class YFinanceSource(DataSource):
    default_symbols = [
        "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS",
        "ICICIBANK.NS", "SBIN.NS", "TATAMOTORS.NS", "ADANIENT.NS",
        "^NSEI", "^BSESN",
    ]
    timeframes = {
        "10s": "10s", "15s": "15s",
        "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
        "1h": "60m", "1D": "1d", "1W": "1wk",
    }

    _period_for = {
        "1m": "5d", "5m": "5d", "15m": "5d", "30m": "1mo",
        "60m": "1mo", "1d": "1y", "1wk": "5y",
    }

    def _download(self, symbol: str, interval: str, limit: int = 500) -> List[Candle]:
        import yfinance as yf
        period = self._period_for.get(interval, "1mo")
        df = yf.download(
            symbol, period=period, interval=interval,
            progress=False, auto_adjust=False, threads=False,
        )
        # yfinance 1m often fails with period=1d; retry with a longer window.
        if (df is None or df.empty) and interval == "1m" and period != "5d":
            df = yf.download(
                symbol, period="5d", interval=interval,
                progress=False, auto_adjust=False, threads=False,
            )
        if df is None or df.empty:
            return []
        if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
            df.columns = df.columns.get_level_values(0)
        out: List[Candle] = []
        for ts, row in df.tail(limit).iterrows():
            try:
                out.append(Candle(
                    time=int(ts.timestamp()),
                    open=_yf_scalar(row, "Open"),
                    high=_yf_scalar(row, "High"),
                    low=_yf_scalar(row, "Low"),
                    close=_yf_scalar(row, "Close"),
                    volume=float(_yf_scalar(row, "Volume")) if "Volume" in row.index else 0.0,
                ))
            except (ValueError, TypeError, KeyError):
                continue
        return out

    def candles(self, symbol: str, interval: str, limit: int = 500) -> List[Candle]:
        if interval in SUB_MINUTE_SECONDS:
            base = self._download(symbol, "1m", limit=min(limit // 6 + 10, 500))
            return expand_sub_minute(base, SUB_MINUTE_SECONDS[interval])[-limit:]
        return self._download(symbol, interval, limit=limit)

    def quote(self, symbol: str) -> Optional[float]:
        import yfinance as yf
        try:
            t = yf.Ticker(symbol)
            fi = getattr(t, "fast_info", None)
            if fi and getattr(fi, "last_price", None):
                return float(fi.last_price)
        except Exception:
            pass
        candles = self.candles(symbol, "1m", limit=2)
        return candles[-1].close if candles else None


# =========================================================================
# Hyperliquid  (perp DEX — REST for history, WS for live)
# =========================================================================
@register("hyperliquid")
class HyperliquidSource(DataSource):
    default_symbols = ["BTC", "ETH", "SOL", "ARB", "DOGE", "AVAX", "LINK", "MATIC"]
    timeframes = {
        "10s": "10s", "15s": "15s",
        "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h",
        "4h": "4h", "1D": "1d",
    }
    REST = "https://api.hyperliquid.xyz/info"
    WS = "wss://api.hyperliquid.xyz/ws"

    def _fetch_candles(self, symbol: str, interval: str, limit: int = 500) -> List[Candle]:
        ms_per = {
            "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000,
            "4h": 14_400_000, "1d": 86_400_000,
        }.get(interval, 60_000)
        end = int(time.time() * 1000)
        start = end - ms_per * limit
        body = {
            "type": "candleSnapshot",
            "req": {"coin": symbol, "interval": interval, "startTime": start, "endTime": end},
        }
        r = requests.post(self.REST, json=body, timeout=10)
        r.raise_for_status()
        data = r.json() or []
        return [
            Candle(
                time=int(c["t"]) // 1000,
                open=float(c["o"]),
                high=float(c["h"]),
                low=float(c["l"]),
                close=float(c["c"]),
                volume=float(c.get("v", 0)),
            )
            for c in data
        ]

    def candles(self, symbol: str, interval: str, limit: int = 500) -> List[Candle]:
        if interval in SUB_MINUTE_SECONDS:
            base = self._fetch_candles(symbol, "1m", limit=min(limit // 6 + 10, 500))
            return expand_sub_minute(base, SUB_MINUTE_SECONDS[interval])[-limit:]
        return self._fetch_candles(symbol, interval, limit=limit)

    def quote(self, symbol: str) -> Optional[float]:
        try:
            r = requests.post(self.REST, json={"type": "allMids"}, timeout=5)
            r.raise_for_status()
            mids = r.json() or {}
            v = mids.get(symbol)
            return float(v) if v is not None else None
        except Exception:
            return None

    async def stream(self, symbol: str, interval: str) -> AsyncIterator[Candle]:
        import websockets
        sub = {
            "method": "subscribe",
            "subscription": {"type": "candle", "coin": symbol, "interval": interval},
        }
        async with websockets.connect(self.WS, ping_interval=20) as ws:
            await ws.send(json.dumps(sub))
            while True:
                raw = await ws.recv()
                msg = json.loads(raw)
                if msg.get("channel") != "candle":
                    continue
                c = msg.get("data") or {}
                if not c:
                    continue
                yield Candle(
                    time=int(c["t"]) // 1000,
                    open=float(c["o"]),
                    high=float(c["h"]),
                    low=float(c["l"]),
                    close=float(c["c"]),
                    volume=float(c.get("v", 0)),
                )


# ----- convenience for the Flask layer --------------------------------------
def source_metadata() -> dict:
    return {
        name: {
            "symbols": src.default_symbols,
            "timeframes": list(src.timeframes.keys()),
        }
        for name, src in _REGISTRY.items()
    }

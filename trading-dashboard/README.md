# Trading Dashboard

Local-only, multi-pane trading dashboard. Lightweight Charts + React frontend, Flask backend, plug-and-play data sources (Hyperliquid live WS, yfinance for Indian equities). No API keys required.

## Quick start

### 1. Backend (Flask)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
python app.py
```
Runs on `http://127.0.0.1:5001` (port 5001 avoids macOS AirPlay using 5000; override with `PORT=...`).

### 2. Frontend (Vite + React)
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`. Vite proxies `/api` and `/ws` to Flask.

## Features
- Top selector for **1 / 2 / 4 / 6 / 8** charts; auto grid (1, 1×2, 2×2, 3×2, 4×2). Selection persists in `localStorage`.
- Each pane has independent **source / symbol / timeframe** dropdowns and remembers its config across refreshes.
- **Ticker strip** above every chart flashes green on upticks, red on downticks.
- **Hyperliquid**: real-time candles via WebSocket bridge (`/ws/stream`).
- **yfinance**: REST candles + 3 s quote polling for live tick flashes (Yahoo doesn't expose a public push stream).

## Adding a new data source
Open `backend/data_source.py` and drop in one class:

```python
@register("binance")
class BinanceSource(DataSource):
    default_symbols = ["BTCUSDT", "ETHUSDT"]
    timeframes = {"1m": "1m", "5m": "5m", "1h": "1h", "1D": "1d"}

    def candles(self, symbol, interval, limit=500):
        # call Binance REST, return [Candle(...)]
        ...

    async def stream(self, symbol, interval):
        # yield Candle(...) from Binance WS
        ...
```

That's it — the new source appears in every pane's source dropdown automatically. Same recipe works for Alpaca, Zerodha, Polygon, etc.

## File layout
```
trading-dashboard/
├── backend/
│   ├── app.py              # Flask + WS bridge
│   ├── data_source.py      # ← pluggable sources live here
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── styles.css
        ├── components/ChartPane.jsx
        └── lib/api.js
```

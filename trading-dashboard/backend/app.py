"""
Local Flask server: REST for historical candles + quote polling,
WebSocket bridge to Hyperliquid for real-time pushes.

Run:
    pip install -r requirements.txt
    python app.py
"""
import asyncio
import json
import threading

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sock import Sock

from data_source import get_source, list_sources, source_metadata

app = Flask(__name__)
CORS(app)
sock = Sock(app)


# ---------- REST ------------------------------------------------------------
@app.get("/api/sources")
def sources():
    return jsonify({"sources": list_sources(), "meta": source_metadata()})


@app.get("/api/candles")
def candles():
    source = request.args.get("source", "yfinance")
    symbol = request.args.get("symbol", "")
    interval = request.args.get("interval", "1m")
    limit = int(request.args.get("limit", 500))
    if not symbol:
        return jsonify({"error": "symbol required"}), 400
    try:
        src = get_source(source)
        # translate UI label -> source-specific code if needed
        iv = src.timeframes.get(interval, interval)
        data = [c.to_dict() for c in src.candles(symbol, iv, limit=limit)]
        return jsonify({"candles": data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/quote")
def quote():
    source = request.args.get("source", "yfinance")
    symbol = request.args.get("symbol", "")
    if not symbol:
        return jsonify({"error": "symbol required"}), 400
    try:
        price = get_source(source).quote(symbol)
        return jsonify({"price": price})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------- WebSocket bridge (Hyperliquid + any stream() source) ------------
@sock.route("/ws/stream")
def ws_stream(ws):
    """
    Client protocol:
        send {"source":"hyperliquid","symbol":"BTC","interval":"1m"}
        receives {"t":..., "o":..., "h":..., "l":..., "c":..., "v":...}
    Re-send a new subscription message to switch symbol/interval.
    """
    loop = asyncio.new_event_loop()
    stop_event = threading.Event()
    current_task = {"task": None}

    def run_loop():
        asyncio.set_event_loop(loop)
        loop.run_forever()

    t = threading.Thread(target=run_loop, daemon=True)
    t.start()

    async def pump(source, symbol, interval):
        try:
            src = get_source(source)
            iv = src.timeframes.get(interval, interval)
            async for candle in src.stream(symbol, iv):
                if stop_event.is_set():
                    break
                try:
                    ws.send(json.dumps(candle.to_dict()))
                except Exception:
                    stop_event.set()
                    break
        except Exception as e:
            try:
                ws.send(json.dumps({"error": str(e)}))
            except Exception:
                pass

    try:
        while not stop_event.is_set():
            raw = ws.receive(timeout=60)
            if raw is None:
                continue
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            # cancel any existing pump, start a new one
            if current_task["task"] is not None:
                loop.call_soon_threadsafe(current_task["task"].cancel)
            fut = asyncio.run_coroutine_threadsafe(
                pump(msg.get("source", "hyperliquid"),
                     msg["symbol"], msg.get("interval", "1m")),
                loop,
            )
            current_task["task"] = asyncio.run_coroutine_threadsafe(
                asyncio.sleep(0), loop  # placeholder
            )
            # Track the actual coroutine via the future's underlying task
            current_task["task"] = fut
    finally:
        stop_event.set()
        loop.call_soon_threadsafe(loop.stop)


if __name__ == "__main__":
    import os

    # Default to 5001 — macOS AirPlay Receiver often occupies 5000.
    port = int(os.environ.get("PORT", 5001))
    # threaded=True so REST + multiple WS clients don't block each other
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)

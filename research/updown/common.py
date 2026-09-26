"""Shared constants/helpers for the backfill scripts (period, coins, polite HTTP)."""
import json, os, random, time, urllib.error, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DATA = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(DATA, "raw")
os.makedirs(RAW, exist_ok=True)

COINS = ["btc", "eth", "sol", "xrp", "doge", "hype", "bnb"]
SYM = {"btc": "BTCUSDT", "eth": "ETHUSDT", "sol": "SOLUSDT", "xrp": "XRPUSDT",
       "doge": "DOGEUSDT", "hype": "HYPEUSDT", "bnb": "BNBUSDT"}
WORD = {"btc": "bitcoin", "eth": "ethereum", "sol": "solana", "xrp": "xrp",
        "doge": "dogecoin", "hype": "hype", "bnb": "bnb"}

# Period frozen at first run: 672 completed hours (hour end <= run time).
_PERIOD_FILE = os.path.join(DATA, "period.json")
if os.path.exists(_PERIOD_FILE):
    _p = json.load(open(_PERIOD_FILE))
else:
    _end = int(time.time()) // 3600 * 3600 - 3600
    _p = {"first_hour_start": _end - 671 * 3600, "last_hour_start": _end, "n_hours": 672,
          "frozen_at_utc": datetime.now(timezone.utc).isoformat()}
    json.dump(_p, open(_PERIOD_FILE, "w"), indent=1)
FIRST_H, LAST_H = _p["first_hour_start"], _p["last_hour_start"]
HOURS = list(range(FIRST_H, LAST_H + 3600, 3600))
ET = ZoneInfo("America/New_York")


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def slug1h(coin, hs):
    d = datetime.fromtimestamp(hs, ET)
    h = d.hour % 12 or 12
    return f"{WORD[coin]}-up-or-down-{d.strftime('%B').lower()}-{d.day}-{d.year}-{h}{'am' if d.hour < 12 else 'pm'}-et"


def slug15(coin, ws):
    return f"{coin}-updown-15m-{ws}"


def slug5(coin, ws):
    return f"{coin}-updown-5m-{ws}"


UA = {"User-Agent": "Mozilla/5.0 (research backfill)", "Content-Type": "application/json"}


def http_json(url, body=None, tries=7, timeout=40):
    """GET (or POST JSON) with retry + exponential backoff on 429/5xx/network errors."""
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA, data=json.dumps(body).encode() if body is not None else None)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code == 429 or e.code >= 500:
                time.sleep(min(30, 1.5 * 2 ** i) + random.random())
                continue
            raise RuntimeError(f"{last} for {url[:160]}: {e.read()[:200]!r}")
        except Exception as e:  # network / timeout / JSON
            last = repr(e)[:160]
            time.sleep(min(30, 1.0 * 2 ** i) + random.random())
    raise RuntimeError(f"giving up after {tries} tries ({last}): {url[:160]}")

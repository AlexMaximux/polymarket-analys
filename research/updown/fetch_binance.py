"""Step 1: Binance klines. 1m for the period (+1h margin each side) and 1h for the period + 8 days before.
Output: klines_1m_<coin>.parquet, klines_1h_<coin>.parquet with open_time_s, open, high, low, close, volume.

HYPE: its Polymarket 1H markets resolve on Binance USD-M FUTURES HYPEUSDT (resolutionSource
https://www.binance.com/en/futures/HYPEUSDT), and spot HYPEUSDT only has data from 2026-09-24 11:00 UTC.
So klines_*_hype.parquet come from fapi.binance.com (perpetual); the spot series for the overlap is kept
separately as klines_*_hype_spot.parquet. All other coins use spot api.binance.com (their resolution source)."""
import os
from concurrent.futures import ThreadPoolExecutor
import pandas as pd
from common import COINS, SYM, DATA, FIRST_H, LAST_H, http_json, iso

SPOT = "https://api.binance.com/api/v3/klines"
FUT = "https://fapi.binance.com/fapi/v1/klines"
SOURCE = {c: SPOT for c in COINS} | {"hype": FUT}


def klines(base, sym, interval, start_s, end_s):
    """All klines with open_time in [start_s, end_s)."""
    out, cur = [], start_s * 1000
    while cur < end_s * 1000:
        d = http_json(f"{base}?symbol={sym}&interval={interval}&startTime={cur}&endTime={end_s * 1000 - 1}&limit=1000")
        if not d:
            break
        out += d
        cur = int(d[-1][0]) + 1
        if len(d) < 1000:
            break
    df = pd.DataFrame([[int(k[0]) // 1000, *map(float, k[1:6])] for k in out],
                      columns=["open_time_s", "open", "high", "low", "close", "volume"])
    return df.drop_duplicates("open_time_s").sort_values("open_time_s").reset_index(drop=True)


def job(args):
    coin, base, suffix = args
    sym = SYM[coin]
    m1 = klines(base, sym, "1m", FIRST_H - 3600, LAST_H + 7200)
    h1 = klines(base, sym, "1h", FIRST_H - 8 * 86400, LAST_H + 3600)
    m1.to_parquet(os.path.join(DATA, f"klines_1m_{coin}{suffix}.parquet"), index=False)
    h1.to_parquet(os.path.join(DATA, f"klines_1h_{coin}{suffix}.parquet"), index=False)
    gaps = int((m1.open_time_s.diff().dropna() != 60).sum()) if len(m1) else -1
    src = "futures" if base == FUT else "spot"
    return (f"{coin}{suffix} ({src}): 1m {len(m1)} rows [{iso(m1.open_time_s.min())} .. {iso(m1.open_time_s.max())}] "
            f"gaps={gaps}; 1h {len(h1)} rows [{iso(h1.open_time_s.min())} .. {iso(h1.open_time_s.max())}]")


if __name__ == "__main__":
    print("period hours", iso(FIRST_H), "->", iso(LAST_H))
    jobs = [(c, SOURCE[c], "") for c in COINS] + [("hype", SPOT, "_spot")]
    with ThreadPoolExecutor(4) as ex:
        for msg in ex.map(job, jobs):
            print(msg, flush=True)

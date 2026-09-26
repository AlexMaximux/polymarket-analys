"""Steps 2-3: Polymarket 1H / 15m / 5m Up-or-Down markets for every coin-hour of the period.

A) Gamma: resolve every slug via the multi-slug events query (/events?limit=100&slug=a&slug=b..., 100 slugs per
   request; fallback per-slug for any miss) -> pm_markets.parquet (tokens, final outcomePrices, fees, status).
B) CLOB: POST /batch-prices-history (max 20 tokens per request, fidelity=1) for the Up AND Down tokens of every
   market of an hour, window [hour_start-900, hour_start+3720] ->
   pm_1h_history.parquet (coin, hour_start, t, p)                 Up token
   pm_15m_history.parquet (coin, hour_start, window_start, t, p)  Up token
   pm_5m_history.parquet (coin, hour_start, window_start, t, p)   Up token
   pm_down_history.parquet (kind, coin, hour_start, window_start, t, p)  Down token of all three kinds
Concurrency <= 8 requests; retries with backoff on 429/5xx (common.http_json)."""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import pandas as pd
from common import COINS, DATA, RAW, HOURS, http_json, slug1h, slug15, slug5, iso

WORKERS = 8
GAMMA = "https://gamma-api.polymarket.com/events"


def ts_of(s):
    if not s:
        return None
    try:
        s = s.strip().replace(" ", "T").replace("Z", "+00:00")
        if s.endswith("+00"):
            s += ":00"
        return int(datetime.fromisoformat(s).timestamp())
    except Exception:
        return None


def all_slugs():
    out = []
    for hs in HOURS:
        for c in COINS:
            out.append(("1h", c, hs, hs, 3600, slug1h(c, hs)))
            out += [("15m", c, hs, hs + 900 * k, 900, slug15(c, hs + 900 * k)) for k in range(4)]
            out += [("5m", c, hs, hs + 300 * k, 300, slug5(c, hs + 300 * k)) for k in range(12)]
    return out


def extract(e):
    m = e["markets"][0]
    outcomes = json.loads(m.get("outcomes") or "[]")
    toks = json.loads(m.get("clobTokenIds") or "[]")
    prices = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
    if outcomes and [o.lower() for o in outcomes] == ["down", "up"]:  # never observed, but be safe
        toks, prices = toks[::-1], prices[::-1]
    elif outcomes and [o.lower() for o in outcomes] != ["up", "down"]:
        raise ValueError(f"unexpected outcomes {outcomes} for {e['slug']}")
    up = prices[0] if prices else None
    return {
        "slug": e["slug"], "event_id": e.get("id"), "market_id": m.get("id"), "condition_id": m.get("conditionId"),
        "token_up": toks[0] if toks else None, "token_down": toks[1] if len(toks) > 1 else None,
        "outcome_price_up": up, "outcome_price_down": prices[1] if len(prices) > 1 else None,
        "pm_outcome_up": (1.0 if up > 0.5 else 0.0 if up < 0.5 else float("nan")) if up is not None else float("nan"),
        "closed": bool(m.get("closed")), "uma_status": m.get("umaResolutionStatus"),
        "event_start_ts": ts_of(m.get("eventStartTime")), "end_ts": ts_of(m.get("endDate")),
        "created_ts": ts_of(m.get("createdAt")), "closed_ts": ts_of(m.get("closedTime")),
        "volume": float(m.get("volumeNum") or m.get("volume") or 0),
        "fees_enabled": m.get("feesEnabled"), "fee_type": m.get("feeType"),
        "taker_base_fee": m.get("takerBaseFee"), "maker_base_fee": m.get("makerBaseFee"),
        "fee_schedule": json.dumps(m.get("feeSchedule")) if m.get("feeSchedule") is not None else None,
        "tick_size": m.get("orderPriceMinTickSize"), "min_order_size": m.get("orderMinSize"),
        "resolution_source": e.get("resolutionSource") or m.get("resolutionSource"),
    }


def gamma_batch(slugs):
    q = "&".join(f"slug={s}" for s in slugs)
    r = http_json(f"{GAMMA}?limit={len(slugs)}&{q}")
    return {e["slug"]: extract(e) for e in r if e.get("markets")}


def phase_gamma():
    todo = all_slugs()
    by_kind = {}
    for row in todo:
        by_kind.setdefault(row[0], []).append(row[5])
    batches = [v[i:i + 100] for v in by_kind.values() for i in range(0, len(v), 100)]
    found = {}
    t0 = time.time()
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(gamma_batch, b) for b in batches]
        for i, f in enumerate(as_completed(futs)):
            found.update(f.result())
            if i % 100 == 0:
                print(f"  gamma {i}/{len(batches)} batches, {len(found)} found, {time.time() - t0:.0f}s", flush=True)
    miss = [r[5] for r in todo if r[5] not in found]
    print(f"gamma: {len(found)}/{len(todo)} found in batches; retrying {len(miss)} per-slug", flush=True)
    for s in miss:
        r = http_json(f"{GAMMA}?slug={s}")
        if r and r[0].get("markets"):
            found[s] = extract(r[0])
    rows = []
    for kind, c, hs, ws, dur, s in todo:
        base = {"kind": kind, "coin": c, "hour_start": hs, "window_start": ws, "window_end": ws + dur, "slug": s}
        rows.append(base | (found.get(s) or {"token_up": None}))
    df = pd.DataFrame(rows)
    df["found"] = df.token_up.notna()
    df.to_parquet(os.path.join(DATA, "pm_markets.parquet"), index=False)
    print(df.groupby(["kind", "coin"]).found.agg(["sum", "count"]).to_string(), flush=True)
    bad = df[df.found & (df.event_start_ts != df.window_start)]
    print("eventStartTime != expected window start:", len(bad), bad.slug.head().tolist())
    return df


def hist_hour(hs, toks):
    """toks: list of (token, kind, coin, window_start, side). Returns list of point rows."""
    out, fails = [], []
    for i in range(0, len(toks), 20):
        chunk = toks[i:i + 20]
        body = {"markets": [t[0] for t in chunk], "start_ts": hs - 900, "end_ts": hs + 3720, "fidelity": 1}
        try:
            r = http_json("https://clob.polymarket.com/batch-prices-history", body)
        except Exception as e:
            fails.append((hs, i, repr(e)[:200]))
            continue
        h = r.get("history") or {}
        for tok, kind, coin, ws, side in chunk:
            for p in h.get(tok) or []:
                out.append((kind, coin, hs, ws, side, int(p["t"]), float(p["p"])))
    return out, fails


def phase_history(mk):
    mk = mk[mk.found]
    jobs = {}
    for r in mk.itertuples():
        jobs.setdefault(r.hour_start, []).append((r.token_up, r.kind, r.coin, r.window_start, "up"))
        jobs.setdefault(r.hour_start, []).append((r.token_down, r.kind, r.coin, r.window_start, "down"))
    rows, fails = [], []
    t0 = time.time()
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(hist_hour, hs, toks): hs for hs, toks in jobs.items()}
        for i, f in enumerate(as_completed(futs)):
            o, fl = f.result()
            rows += o; fails += fl
            if i % 50 == 0:
                print(f"  history {i}/{len(jobs)} hours, {len(rows)} pts, {time.time() - t0:.0f}s", flush=True)
    # one retry pass for failed chunks, sequential
    for hs, i, err in list(fails):
        toks = jobs[hs][i:i + 20]
        o, fl = hist_hour(hs, toks)
        if not fl:
            rows += o; fails.remove((hs, i, err))
    print(f"history: {len(rows)} points, failed chunks: {len(fails)} {fails[:3]}", flush=True)
    df = pd.DataFrame(rows, columns=["kind", "coin", "hour_start", "window_start", "side", "t", "p"])
    df = df.drop_duplicates(["kind", "coin", "window_start", "side", "t"]).sort_values(["kind", "coin", "window_start", "side", "t"])
    up = df[df.side == "up"]
    up[up.kind == "1h"][["coin", "hour_start", "t", "p"]].to_parquet(os.path.join(DATA, "pm_1h_history.parquet"), index=False)
    up[up.kind == "15m"][["coin", "hour_start", "window_start", "t", "p"]].to_parquet(os.path.join(DATA, "pm_15m_history.parquet"), index=False)
    up[up.kind == "5m"][["coin", "hour_start", "window_start", "t", "p"]].to_parquet(os.path.join(DATA, "pm_5m_history.parquet"), index=False)
    df[df.side == "down"][["kind", "coin", "hour_start", "window_start", "t", "p"]].to_parquet(os.path.join(DATA, "pm_down_history.parquet"), index=False)
    json.dump(fails, open(os.path.join(RAW, "history_failed_chunks.json"), "w"))
    return df


if __name__ == "__main__":
    t0 = time.time()
    if "--history-only" in sys.argv and os.path.exists(os.path.join(DATA, "pm_markets.parquet")):
        mk = pd.read_parquet(os.path.join(DATA, "pm_markets.parquet"))
    else:
        mk = phase_gamma()
    print(f"gamma phase done {time.time() - t0:.0f}s", flush=True)
    h = phase_history(mk)
    print(h.groupby(["kind", "side"]).size().to_string())
    print(f"total {time.time() - t0:.0f}s")

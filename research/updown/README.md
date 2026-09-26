# Up/Down historical backfill

This pipeline rebuilds the dataset behind the September 2026 Up/Down research. The findings are in [REPORT.md](REPORT.md).

For 7 coins (btc, eth, sol, xrp, doge, hype, bnb) and a 672-hour window, it fetches:

- Binance 1m and 1h candles;
- every Polymarket 1H, 15m and 5m Up/Down market;
- the 1-minute CLOB price history of those markets, for both Up and Down tokens.

It then joins everything into one grid, `backfill.parquet`. The grid has one row per coin, hour and minute (t = 1..59), and every feature in it was observable at that minute. A fresh run re-targets the window at "now", so the research can be repeated as more data accumulates.

The scripts are copies of the research run's scripts. Only two things were changed, to make them portable:

- a comment in `build_grid.py`;
- in `validate.py`, the live-snapshot check is now optional (see step 4).

## Setup

```bash
cd research/updown
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

`requirements.txt` lists numpy, scipy, pandas and pyarrow. The copied scripts need nothing else: no scikit-learn, no LightGBM and no API keys.

## Running

Run the scripts in this order from this directory. Each one writes into this directory.

```bash
.venv/bin/python fetch_binance.py | tee fetch_binance.log   # 1. Binance klines
.venv/bin/python fetch_pm.py      | tee fetch_pm.log        # 2-3. Gamma markets + CLOB price history
.venv/bin/python build_grid.py    | tee build_grid.log      # 4. backfill.parquet
.venv/bin/python validate.py      | tee validate.log        # 5. checks -> validation.json
.venv/bin/python sanity.py        | tee sanity.log          # extra sanity numbers (fees, ties, Brier)
```

| step | script | writes |
|---|---|---|
| 1 | `fetch_binance.py` | `klines_1m_<coin>.parquet`: the period ±1-2 h. `klines_1h_<coin>.parquet`: the period plus the 8 days before it, used for the 168-hour sigma. `klines_{1m,1h}_hype_spot.parquet`: kept for comparison only. |
| 2-3 | `fetch_pm.py` | `pm_markets.parquet`: one row per slug, with tokens, final outcome, fees and status. `pm_1h_history.parquet`, `pm_15m_history.parquet` and `pm_5m_history.parquet`: Up token. `pm_down_history.parquet`: Down token. `raw/history_failed_chunks.json`. `--history-only` reuses an existing `pm_markets.parquet`. |
| 4 | `build_grid.py` | `backfill.parquet`. The script also asserts that its vectorised fair values match the scalar reference `models()`. |
| 5 | `validate.py` | `validation.json`, covering outcome agreement, price-vs-live checks, staleness and fair-value sanity. |
| - | `sanity.py` | prints only |

**Period.** The first script to run creates `period.json`, which freezes the window at the 672 most recent completed hours. Every later script reads that same file. To re-target the window at "now", delete `period.json` before step 1, never between steps. Every run overwrites the previous outputs.

**Custom period.** To fetch another window, for example the 2026-07-31..08-28 holdout, write `period.json` by hand. It needs `first_hour_start` and `last_hour_start` (unix seconds, on the hour); `n_hours` and `frozen_at_utc` are informational only. The holdout was 1785535200..1787950800.

One limit applies to older windows. Spot HYPEUSDT only exists from 2026-09-24 11:00 UTC. If Binance returns no spot rows for the window, the `hype_spot` job in `fetch_binance.py` writes empty files. Its log line then raises `ValueError`, after the other coins are written.

**Live-snapshot check (optional).** Checks (b) and (d) in `validate.py` compare the backfill with live `/api/updown` snapshots. The file they need is `bt_dataset.json`: a JSON list with `coin, ts, t, s0, st, sigma1h, market_up, p15, p5` and `new.base_no_drift` per snapshot. It was built once from Jev collector snapshots, and that one-off builder is not in the repo. The script looks for `bt_dataset.json` in this directory, or at the path given in `BT_DATASET=/path/to/file`. If the file is absent, (b) and (d) print "skipped" and the other checks still run. With the original file, the ported script reproduces the original `validation.json` byte for byte.

**Runtime and size.** The fetches take about 4 minutes; `fetch_pm.py` took 174 s in the reference run. Outputs total about 75 MB. All of them are git-ignored.

## APIs used and politeness

All endpoints are public and need no keys. The User-Agent is `Mozilla/5.0 (research backfill)`.

| API | endpoint | use |
|---|---|---|
| Binance spot | `api.binance.com/api/v3/klines` (limit 1000) | all coins except hype |
| Binance USD-M futures | `fapi.binance.com/fapi/v1/klines` | hype, whose 1H markets resolve on futures HYPEUSDT |
| Polymarket Gamma | `gamma-api.polymarket.com/events?limit=100&slug=a&slug=b...` | 100 slugs per request, with a per-slug fallback for misses |
| Polymarket CLOB | `POST clob.polymarket.com/batch-prices-history` (fidelity=1) | at most 20 tokens per request; window [hour_start-900, hour_start+3720] |

A full run makes about 800 Gamma requests and about 8,000 CLOB requests. Concurrency is at most 8 requests to Polymarket and 4 threads for Binance. `common.http_json` retries up to 7 times on HTTP 429, 5xx and network errors, with exponential backoff (capped at 30 s) plus jitter. Keep these limits if you edit the scripts.

## backfill.parquet

There is one row per `(coin, hour_start, t)`, with decision time `ts = hour_start + 60*t` for `t = 1..59`. The reference run had 277,536 rows: 7 coins x 672 hours x 59 minutes.

**Features.** All of these are observable at or before `ts`.

| column | meaning |
|---|---|
| `coin`, `hour_start`, `ts`, `t` | coin; UTC hour start in unix s (the market hour, and the cluster key for standard errors); decision time; minutes into the hour |
| `day_utc`, `hod_et` | day of hour_start (use it for walk-forward splits); hour of day in America/New_York |
| `w15_start`, `w5_start` | start of the current 15m and 5m windows |
| `tau15`, `tau5`, `tau60` | minutes left in the 15m window, the 5m window and the hour |
| `price_src` | `binance_spot`, or `binance_futures` for hype |
| `s0`, `st`, `sa`, `sa5` | Binance price at the hour open (equals the 1h candle open), at ts (close of the 1m bar opening at ts-60), and at the 15m and 5m window opens |
| `xt`, `y15`, `y5` | ln(st/s0), ln(st/sa), ln(st/sa5) |
| `sigma1h`, `sigma_n` | sample stdev of ln(close/open) over the 168 1h candles before the hour, and the number of candles used (always 168) |
| `p1h`, `p15`, `p5` (+ `_age_s`) | last Up-token CLOB point <= ts for the 1H market and for the current 15m and 5m markets, with its age in seconds |
| `p1h_dn` (+ `_age_s`) | 1 - last 1H Down-token point <= ts |
| `base_fair`, `fair_15m`, `fair_5m`, `fair_joint` | the four fair values from `models()` (see the next section) |

**Shifted-decision-time columns.** These are *not* observable at ts. `p1h_snap`, `p15_snap` and `p5_snap` are the first point in (ts, ts+60], and each has a matching `_snap_lag_s` (median lag 14 s). Use them as the fill reference for a decision at ts. Alternatively, move the decision time to `ts + lag` and use them as inputs.

**Labels.** Never use these as features.

- `outcome_up`: Binance 1h close >= open. This is the 1H resolution rule; hype uses futures, and ties count as Up.
- `pm_outcome_up`, `pm_uma_status`: from the market's final outcome prices.
- `ret_1h`, `bn_open_1h`, `bn_close_1h`
- `pm15_outcome_up`, `pm5_outcome_up`: these markets resolve on the Chainlink 60-s TWAP, so Binance is only a proxy for them.

**Caveats for any backtest on this grid:**

1. **The price at ts is stale.** It is a CLOB *midpoint* snapshot, taken about once a minute at about 12-16 s past the minute, so at ts it is about 46 s old. Comparing any spot-aware model with `p1h` therefore hands the model a free edge. Use `p1h_snap` as the fill reference.
2. **Midpoints are not executable prices.** There is no historical spread or depth. Never book P&L at the mid. Add at least the per-coin half-spread plus the taker fee of 0.07·p·(1-p) per share (makers pay 0). REPORT.md has per-coin costs. HYPE 1H books are about 33c wide.
3. **Outcomes of different coins in the same hour are strongly correlated.** Cluster standard errors on `hour_start` and split walk-forward on `day_utc`.
4. **Known holes in the reference run:**
   - 4 missing 1H markets: 2026-09-05 16:00 UTC for btc, eth, sol and xrp.
   - One dead sol hour.
   - A CLOB history outage on 2026-09-01 23:00 UTC, minutes 1-36.
   - `validation.json -> c_staleness` lists every stale or missing hour.

**Reference results** (2026-08-28 22:00 .. 2026-09-25 21:00 UTC). Use these to sanity-check a re-run:

- Binance and Polymarket 1H outcomes agree on 4700/4700 coin-hours.
- Brier score on 276,579 rows: `p1h` 0.1630, `p1h_snap` 0.1595, `base_fair` 0.1607, `fair_15m` 0.245, `fair_5m` 0.291.
- Up base rate 0.521.

## The fair-value columns use the pre-fix live formulas

`build_grid.py` computes `base_fair`, `fair_15m`, `fair_5m` and `fair_joint` with an exact copy of the `models()` that `src/app/api/updown/route.ts` used before commit b7a6e92. That version has two known problems:

- `sigma1h` is the 7-day sigma (168 hourly candles);
- the 15m, 5m and joint models extrapolate the market-implied drift over the rest of the hour (`mu * tau60`).

The research found both to be wrong (see REPORT.md). The live route now uses two fixed formulas, reproduced below, which must be computed separately to use them on the grid. They come from the research helper `rules_lib.py`. That file is not copied here because it imports a helper module that hard-codes the research scratch paths.

**rv60 sigma.** This is the trailing-60-minute realized vol in hourly units: `sqrt(60 · mean(ln(close/open)²))` over the 1m bars fully closed by ts (open_time in [ts-3600, ts-60]). It needs at least 45 bars; keep the [0.002, 0.2] clip. Live falls back to the 7-day sigma when fewer bars are available.

```python
def rv60_table(klines_dir, coins):
    """trailing-60-min realized vol (per-hour units) from 1m bars fully closed by ts (open_time in [ts-3600, ts-60])."""
    out = []
    for c in coins:
        k1 = pd.read_parquet(f"{klines_dir}/klines_1m_{c}.parquet").sort_values("open_time_s")
        r2 = pd.Series((np.log(k1.close / k1.open) ** 2).to_numpy(), index=k1.open_time_s.to_numpy())
        roll = r2.rolling(60, min_periods=45).mean() * 60
        out.append(pd.DataFrame({"coin": c, "ts": r2.index + 60, "rv60": np.sqrt(roll.to_numpy())}))
    return pd.concat(out, ignore_index=True)

# g = g.merge(rv60_table(".", COINS), on=["coin", "ts"], how="left")
```

**Window-limited drift.** The 15m-implied drift is applied only until its own window ends:

- `f15_win = Φ((x_t − y15 + z15·σm·√τ15) / (σm·√τ60))`
- `z15 = Φ⁻¹(p15)` and `σm = σ1h/√60`

The live 5m model is the same with `y5`, `z5` and `τ5`. The joint model applies its solved drift over `τ15`.

```python
def fair_window(sig1h, t, xt, y15, p15):
    """calib2.py: base and the 15m drift applied only over its own window (f15_win)."""
    sig = np.clip(sig1h, 0.002, 0.2); sm = sig / np.sqrt(60)
    tau15 = 15 - (t - 15 * np.floor(t / 15)); tau60 = 60 - t
    ok15 = np.isfinite(p15) & (p15 > 0.0005) & (p15 < 0.9995)
    z15 = norm.ppf(np.where(ok15, p15, 0.5))
    base = norm.cdf(xt / (sm * np.sqrt(tau60)))
    f15w = np.where(ok15, norm.cdf((xt - y15 + z15 * sm * np.sqrt(tau15)) / (sm * np.sqrt(tau60))), np.nan)
    return base, f15w

# base_rv, f15_win_rv = fair_window(g.rv60.fillna(g.sigma1h).to_numpy(), g.t.to_numpy(), g.xt.to_numpy(),
#                                   g.y15.to_numpy(), g.p15.to_numpy())
# (the research evaluated them at t + p1h_snap_lag_s/60 with p15_snap, i.e. at the next snapshot; see caveat 1)
```

## Loading the grid

```python
import sys, pandas as pd
sys.path.insert(0, "research/updown")
from build_grid import models_vec          # vectorised pre-fix models(): returns base, f15, f5, fjoint
g = pd.read_parquet("research/updown/backfill.parquet")
g = g[g.p1h.notna() & (g.p1h_age_s <= 120) & g.outcome_up.notna()]
# buy Up at the next snapshot, cost c per share: pnl = outcome_up - p1h_snap - c
# cluster key: g.hour_start ; walk-forward key: g.day_utc
```

## Executable prices going forward

The grid only has midpoints. Two sources now record executable prices:

- Since commit 5ab43c3, the alerts worker appends one tick per coin per minute to `ticks/updown-YYYY-MM-DD.jsonl` at the repo root. Each tick has the 1H and 15m top of book, spot, the sigmas and all fair values.
- Jev snapshots store the same book fields (commit 7c1764f).

Use these for any test at the ask or bid.

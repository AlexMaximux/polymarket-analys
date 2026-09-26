"""Step 4: main grid backfill.parquet -- one row per (coin, hour_start, m=1..59), decision time ts = hour_start+60m.
Every feature uses only data observable at or before ts; label columns are prefixed/documented in README."""
import math, os
import numpy as np
import pandas as pd
from scipy.stats import norm
from common import COINS, DATA, HOURS, ET

# ---------------- scalar reference: models() as in src/app/api/updown/route.ts BEFORE commit b7a6e92 ----------------
# (168-hour sigma1h, 15m/5m/joint drift extrapolated over tau60). Kept as-is so the grid stays comparable with the
# research results; the current live formulas (rv60 sigma, window-limited drift) are quoted in README.md.
def models(t, sigma1h, s0, sa, sa5, st, p15, p5):
    res = {"model_15m": None, "model_5m": None, "base_no_drift": None, "joint_solve": None}
    sigma1h = min(max(sigma1h, 0.002), 0.2)
    sm = sigma1h / math.sqrt(60)
    a = 15 * math.floor(t / 15); tau15 = 15 - (t - a); tau60 = 60 - t
    a5 = 5 * math.floor(t / 5); tau5 = 5 - (t - a5)
    xt = math.log(st / s0)
    y = math.log(st / sa)
    y5 = math.log(st / sa5)
    ok = lambda p: p is not None and 0.0005 < p < 0.9995
    if ok(p15):
        mu = (norm.ppf(p15) * sm * math.sqrt(tau15) - y) / tau15 if tau15 > 0.01 else 0
        res["model_15m"] = norm.cdf((xt + mu * tau60) / (sm * math.sqrt(tau60)))
    if ok(p5):
        mu5 = (norm.ppf(p5) * sm * math.sqrt(tau5) - y5) / tau5 if tau5 > 0.01 else 0
        res["model_5m"] = norm.cdf((xt + mu5 * tau60) / (sm * math.sqrt(tau60)))
    res["base_no_drift"] = norm.cdf(xt / (sigma1h * math.sqrt((60 - t) / 60)))
    if ok(p5) and ok(p15):
        aq, bq = norm.ppf(p5), norm.ppf(p15)
        den = bq * tau5 * math.sqrt(tau15) - aq * tau15 * math.sqrt(tau5)
        if abs(den) > 1e-9:
            smj = (y * tau5 - y5 * tau15) / den
            muj = (aq * smj * math.sqrt(tau5) - y5) / tau5 if tau5 > 0.01 else 0
            if smj > 0:
                res["joint_solve"] = norm.cdf((xt + muj * tau60) / (smj * math.sqrt(tau60)))
    return res


def models_vec(t, sigma1h, s0, sa, sa5, st, p15, p5):
    """Vectorised twin of models(); verified against the scalar copy below."""
    t = np.asarray(t, float)
    sig = np.clip(sigma1h, 0.002, 0.2)
    sm = sig / math.sqrt(60)
    tau15 = 15 - (t - 15 * np.floor(t / 15)); tau60 = 60 - t
    tau5 = 5 - (t - 5 * np.floor(t / 5))
    xt, y, y5 = np.log(st / s0), np.log(st / sa), np.log(st / sa5)
    ok15 = np.isfinite(p15) & (p15 > 0.0005) & (p15 < 0.9995)
    ok5 = np.isfinite(p5) & (p5 > 0.0005) & (p5 < 0.9995)
    with np.errstate(all="ignore"):
        q15, q5 = norm.ppf(np.where(ok15, p15, 0.5)), norm.ppf(np.where(ok5, p5, 0.5))
        mu = np.where(tau15 > 0.01, (q15 * sm * np.sqrt(tau15) - y) / tau15, 0.0)
        f15 = np.where(ok15, norm.cdf((xt + mu * tau60) / (sm * np.sqrt(tau60))), np.nan)
        mu5 = np.where(tau5 > 0.01, (q5 * sm * np.sqrt(tau5) - y5) / tau5, 0.0)
        f5 = np.where(ok5, norm.cdf((xt + mu5 * tau60) / (sm * np.sqrt(tau60))), np.nan)
        base = norm.cdf(xt / (sig * np.sqrt((60 - t) / 60)))
        den = q15 * tau5 * np.sqrt(tau15) - q5 * tau15 * np.sqrt(tau5)
        smj = (y * tau5 - y5 * tau15) / den
        muj = np.where(tau5 > 0.01, (q5 * smj * np.sqrt(tau5) - y5) / tau5, 0.0)
        fj = norm.cdf((xt + muj * tau60) / (smj * np.sqrt(tau60)))
        fj = np.where(ok15 & ok5 & (np.abs(den) > 1e-9) & (smj > 0), fj, np.nan)
    return base, f15, f5, fj


def asof(grid, hist, by, prefix):
    """Last history point with t <= ts for each grid row, matched on `by` keys. Adds <prefix>, <prefix>_age_s."""
    h = hist.rename(columns={"t": "_t", "p": prefix}).sort_values("_t")
    g = pd.merge_asof(grid.sort_values("ts"), h[by + ["_t", prefix]], left_on="ts", right_on="_t",
                      by=by, direction="backward", allow_exact_matches=True)
    g[f"{prefix}_age_s"] = g.ts - g._t
    return g.drop(columns="_t")


def snap(grid, hist, by, prefix):
    """First history point with ts < t <= ts+60 (the next ~1/min CLOB snapshot, usually ~12-16 s after ts).
    NOT observable at ts -- only usable if the decision time is shifted to ts + <prefix>_snap_lag_s."""
    h = hist.rename(columns={"t": "_t", "p": f"{prefix}_snap"}).sort_values("_t")
    g = pd.merge_asof(grid.sort_values("ts"), h[by + ["_t", f"{prefix}_snap"]], left_on="ts", right_on="_t",
                      by=by, direction="forward", allow_exact_matches=False, tolerance=60)
    g[f"{prefix}_snap_lag_s"] = (g._t - g.ts).astype(float)
    return g.drop(columns="_t")


def main():
    mk = pd.read_parquet(os.path.join(DATA, "pm_markets.parquet"))
    h1 = pd.read_parquet(os.path.join(DATA, "pm_1h_history.parquet"))
    h15 = pd.read_parquet(os.path.join(DATA, "pm_15m_history.parquet"))
    h5 = pd.read_parquet(os.path.join(DATA, "pm_5m_history.parquet"))
    hd = pd.read_parquet(os.path.join(DATA, "pm_down_history.parquet"))

    parts = []
    for coin in COINS:
        k1 = pd.read_parquet(os.path.join(DATA, f"klines_1m_{coin}.parquet")).set_index("open_time_s")
        kh = pd.read_parquet(os.path.join(DATA, f"klines_1h_{coin}.parquet")).set_index("open_time_s")
        lr = np.log(kh.close / kh.open)
        rows = []
        for hs in HOURS:
            prev = lr.loc[hs - 168 * 3600: hs - 1]
            sig = float(prev.std(ddof=1)) if len(prev) >= 2 else np.nan
            h_open = kh.open.get(hs, np.nan); h_close = kh.close.get(hs, np.nan)
            for m in range(1, 60):
                ts = hs + 60 * m
                w15 = hs + 900 * (m // 15); w5 = hs + 300 * (m // 5)
                rows.append((coin, hs, ts, m, w15, w5, sig, len(prev), h_open, h_close))
        g = pd.DataFrame(rows, columns=["coin", "hour_start", "ts", "t", "w15_start", "w5_start", "sigma1h",
                                        "sigma_n", "bn_open_1h", "bn_close_1h"])
        g["s0"] = k1.open.reindex(g.hour_start).to_numpy()
        g["sa"] = k1.open.reindex(g.w15_start).to_numpy()
        g["sa5"] = k1.open.reindex(g.w5_start).to_numpy()
        g["st"] = k1.close.reindex(g.ts - 60).to_numpy()
        parts.append(g)
    g = pd.concat(parts, ignore_index=True)

    # Polymarket prices: last point <= ts (Up token), and 1 - Down token for comparison / freshness
    g = asof(g, h1, ["coin", "hour_start"], "p1h")
    g = asof(g, h15.rename(columns={"window_start": "w15_start"}), ["coin", "w15_start"], "p15")
    g = asof(g, h5.rename(columns={"window_start": "w5_start"}), ["coin", "w5_start"], "p5")
    d = hd.assign(p=1 - hd.p)
    g = asof(g, d[d.kind == "1h"][["coin", "hour_start", "t", "p"]], ["coin", "hour_start"], "p1h_dn")
    # history window starts at hour_start-900: older points are simply absent (age NaN) -- flag rather than guess
    for c in ("p1h", "p15", "p5", "p1h_dn"):
        g[f"{c}_age_s"] = g[f"{c}_age_s"].astype(float)
    # next snapshot after ts (decision-time-shifted variant; see README)
    g = snap(g, h1, ["coin", "hour_start"], "p1h")
    g = snap(g, h15.rename(columns={"window_start": "w15_start"}), ["coin", "w15_start"], "p15")
    g = snap(g, h5.rename(columns={"window_start": "w5_start"}), ["coin", "w5_start"], "p5")

    # outcomes / market metadata
    mk1 = mk[mk.kind == "1h"][["coin", "hour_start", "pm_outcome_up", "uma_status"]].rename(columns={"uma_status": "pm_uma_status"})
    g = g.merge(mk1, on=["coin", "hour_start"], how="left")
    m15 = mk[mk.kind == "15m"][["coin", "window_start", "pm_outcome_up"]].rename(columns={"window_start": "w15_start", "pm_outcome_up": "pm15_outcome_up"})
    m5 = mk[mk.kind == "5m"][["coin", "window_start", "pm_outcome_up"]].rename(columns={"window_start": "w5_start", "pm_outcome_up": "pm5_outcome_up"})
    g = g.merge(m15, on=["coin", "w15_start"], how="left").merge(m5, on=["coin", "w5_start"], how="left")
    g["outcome_up"] = np.where(g.bn_close_1h.notna(), (g.bn_close_1h >= g.bn_open_1h).astype(float), np.nan)
    g["ret_1h"] = np.log(g.bn_close_1h / g.bn_open_1h)

    # derived inputs + fair values
    g["xt"] = np.log(g.st / g.s0); g["y15"] = np.log(g.st / g.sa); g["y5"] = np.log(g.st / g.sa5)
    g["tau15"] = 15 - (g.t - 15 * (g.t // 15)); g["tau5"] = 5 - (g.t - 5 * (g.t // 5)); g["tau60"] = 60 - g.t
    base, f15, f5, fj = models_vec(g.t.to_numpy(), g.sigma1h.to_numpy(), g.s0.to_numpy(), g.sa.to_numpy(),
                                   g.sa5.to_numpy(), g.st.to_numpy(), g.p15.to_numpy(), g.p5.to_numpy())
    g["base_fair"], g["fair_15m"], g["fair_5m"], g["fair_joint"] = base, f15, f5, fj

    # verify vectorised == scalar replica on a random sample
    rng = np.random.default_rng(0)
    idx = rng.choice(len(g), 20000, replace=False)
    worst = 0.0
    for i in idx:
        r = g.iloc[i]
        if not np.isfinite([r.s0, r.sa, r.sa5, r.st, r.sigma1h]).all():
            continue
        s = models(float(r.t), r.sigma1h, r.s0, r.sa, r.sa5, r.st,
                   None if pd.isna(r.p15) else float(r.p15), None if pd.isna(r.p5) else float(r.p5))
        for a, b in ((s["base_no_drift"], r.base_fair), (s["model_15m"], r.fair_15m), (s["model_5m"], r.fair_5m), (s["joint_solve"], r.fair_joint)):
            if (a is None) != pd.isna(b):
                raise AssertionError(f"None-mismatch row {i}: {a} vs {b}")
            if a is not None:
                worst = max(worst, abs(a - b))
    print(f"vectorised vs scalar models(): max |diff| on {len(idx)} sampled rows = {worst:.2e}")
    assert worst < 1e-9

    dt = pd.to_datetime(g.hour_start, unit="s", utc=True)
    g["day_utc"] = dt.dt.strftime("%Y-%m-%d")
    g["hod_et"] = dt.dt.tz_convert(ET).dt.hour.astype("int8")
    g["price_src"] = np.where(g.coin == "hype", "binance_futures", "binance_spot")

    cols = ["coin", "hour_start", "ts", "t", "day_utc", "hod_et", "w15_start", "w5_start", "tau15", "tau5", "tau60",
            "price_src", "s0", "st", "sa", "sa5", "xt", "y15", "y5", "sigma1h", "sigma_n",
            "p1h", "p1h_age_s", "p1h_dn", "p1h_dn_age_s", "p15", "p15_age_s", "p5", "p5_age_s",
            "base_fair", "fair_15m", "fair_5m", "fair_joint",
            "p1h_snap", "p1h_snap_lag_s", "p15_snap", "p15_snap_lag_s", "p5_snap", "p5_snap_lag_s",
            "outcome_up", "pm_outcome_up", "pm_uma_status", "ret_1h", "bn_open_1h", "bn_close_1h",
            "pm15_outcome_up", "pm5_outcome_up"]
    g = g[cols].sort_values(["hour_start", "coin", "t"]).reset_index(drop=True)
    g["t"] = g.t.astype("int16")
    g.to_parquet(os.path.join(DATA, "backfill.parquet"), index=False)
    print("rows", len(g), "coin-hours", g.groupby(["coin", "hour_start"]).ngroups)
    print(g.isna().mean().round(4)[lambda s: s > 0].to_string())


if __name__ == "__main__":
    main()

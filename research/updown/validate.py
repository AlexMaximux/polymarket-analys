"""Step 5: validation of backfill.parquet. Prints a report and writes validation.json."""
import json, math, os
import numpy as np
import pandas as pd
from common import DATA, COINS, iso

# Optional live-snapshot file for checks (b) and (d): a JSON list of live /api/updown snapshots (keys coin, ts, t,
# s0, st, sigma1h, market_up, p15, p5 and new.base_no_drift). Default: bt_dataset.json next to this script;
# override with BT_DATASET=/path/to/file. When the file is absent, (b) and (d) are skipped with a message.
BT = os.environ.get("BT_DATASET") or os.path.join(DATA, "bt_dataset.json")
HAVE_BT = os.path.exists(BT)
out = {}

g = pd.read_parquet(os.path.join(DATA, "backfill.parquet"))
mk = pd.read_parquet(os.path.join(DATA, "pm_markets.parquet"))
h1 = pd.read_parquet(os.path.join(DATA, "pm_1h_history.parquet"))
h15 = pd.read_parquet(os.path.join(DATA, "pm_15m_history.parquet"))
h5 = pd.read_parquet(os.path.join(DATA, "pm_5m_history.parquet"))
hd = pd.read_parquet(os.path.join(DATA, "pm_down_history.parquet"))

# ---------------- coverage ----------------
cov = []
for c in COINS:
    m = mk[mk.coin == c]
    row = {"coin": c}
    for k in ("1h", "15m", "5m"):
        mm = m[m.kind == k]
        row[f"{k}_markets_found"] = int(mm.found.sum()); row[f"{k}_markets_expected"] = len(mm)
    gc = g[g.coin == c]
    row["hours"] = int(gc.groupby("hour_start").p1h.apply(lambda s: s.notna().any()).sum())
    row["first_hour_utc"] = iso(gc.hour_start.min()); row["last_hour_utc"] = iso(gc.hour_start.max())
    row["missing_1h_slugs"] = mk[(mk.coin == c) & (mk.kind == "1h") & ~mk.found].slug.tolist()
    cov.append(row)
out["coverage"] = cov
print(pd.DataFrame(cov).drop(columns="missing_1h_slugs").to_string())
print("missing 1h markets:", mk[(mk.kind == "1h") & ~mk.found].slug.tolist())

# ---------------- (a) outcome agreement ----------------
hh = g.drop_duplicates(["coin", "hour_start"])[["coin", "hour_start", "outcome_up", "pm_outcome_up", "pm_uma_status", "ret_1h", "bn_open_1h", "bn_close_1h"]]
both = hh.dropna(subset=["outcome_up", "pm_outcome_up"])
agree = (both.outcome_up == both.pm_outcome_up)
dis = both[~agree]
out["a_outcome_agreement"] = {"coin_hours_compared": len(both), "agree": int(agree.sum()), "share": float(agree.mean()),
                              "by_coin": both.assign(a=agree).groupby("coin").a.mean().round(4).to_dict(),
                              "uma_status_counts": hh.pm_uma_status.value_counts(dropna=False).to_dict(),
                              "disagreements": [{"coin": r.coin, "hour_utc": iso(r.hour_start), "bn_open": r.bn_open_1h, "bn_close": r.bn_close_1h,
                                                 "pm_outcome_up": r.pm_outcome_up, "uma": r.pm_uma_status} for r in dis.itertuples()]}
print(f"(a) outcome_up vs pm_outcome_up: {agree.sum()}/{len(both)} agree ({agree.mean():.4%}); disagreements:")
print(dis.to_string() if len(dis) else "   none")
# HYPE: spot vs futures resolution check on the overlap
sp = pd.read_parquet(os.path.join(DATA, "klines_1h_hype_spot.parquet")).set_index("open_time_s")
hy = hh[(hh.coin == "hype") & hh.hour_start.isin(sp.index)].dropna(subset=["pm_outcome_up"])
sp_up = (sp.close >= sp.open).astype(float).reindex(hy.hour_start).to_numpy()
out["a_hype_spot_vs_futures"] = {"hours": len(hy), "futures_agree": float((hy.outcome_up == hy.pm_outcome_up).mean()),
                                 "spot_agree": float((sp_up == hy.pm_outcome_up.to_numpy()).mean())}
print("   HYPE overlap hours with spot:", out["a_hype_spot_vs_futures"])
# 15m / 5m: Polymarket outcome vs Binance 1m open->close proxy (resolution is Chainlink, so expect < 100%)
for k, dur in (("15m", 900), ("5m", 300)):
    mm = mk[(mk.kind == k) & mk.found].copy()
    agr = []
    for c in COINS:
        k1 = pd.read_parquet(os.path.join(DATA, f"klines_1m_{c}.parquet")).set_index("open_time_s")
        x = mm[mm.coin == c]
        o = k1.open.reindex(x.window_start).to_numpy(); cl = k1.close.reindex(x.window_end - 60).to_numpy()
        bn = (cl >= o).astype(float)
        ok = np.isfinite(x.pm_outcome_up.to_numpy()) & np.isfinite(o) & np.isfinite(cl)
        agr.append((c, float((bn[ok] == x.pm_outcome_up.to_numpy()[ok]).mean()), int(ok.sum())))
    out[f"a_{k}_pm_vs_binance_proxy"] = {c: {"agree": a, "n": n} for c, a, n in agr}
    print(f"   {k} PM outcome vs Binance-1m proxy agreement:", {c: round(a, 3) for c, a, n in agr})

# ---------------- (b) prices-history vs live CLOB midpoints ----------------
if HAVE_BT:
    bt = pd.DataFrame(json.load(open(BT)))
    bt["hs"] = (bt.ts // 3600 * 3600).astype(int)
    bt["ts_i"] = np.floor(bt.ts).astype(int)
    bt["w15"] = bt.hs + 900 * ((bt.ts - bt.hs) // 900).astype(int)
    bt["w5"] = bt.hs + 300 * ((bt.ts - bt.hs) // 300).astype(int)


    def point_lookup(hist, key_cols, bt_keys, ts):
        """For each bt row: last point <= ts, first point >= ts, and nearest point."""
        H = {k: (v.t.to_numpy(), v.p.to_numpy()) for k, v in hist.groupby(key_cols)}
        prev, nxt, near, age = [], [], [], []
        for key, t in zip(bt_keys, ts):
            tt, pp = H.get(key, (np.array([]), np.array([])))
            i = np.searchsorted(tt, t, side="right") - 1
            j = np.searchsorted(tt, t, side="left")
            pv = pp[i] if i >= 0 else np.nan; nx = pp[j] if j < len(tt) else np.nan
            prev.append(pv); nxt.append(nx); age.append(t - tt[i] if i >= 0 else np.nan)
            if i >= 0 and j < len(tt):
                near.append(pv if (t - tt[i]) <= (tt[j] - t) else nx)
            else:
                near.append(pv if i >= 0 else nx)
        return np.array(prev), np.array(nxt), np.array(near), np.array(age)


    def stats(diff):
        d = np.abs(np.asarray(diff, float)); d = d[np.isfinite(d)]
        return {"n": int(len(d)), "median_abs": float(np.median(d)) if len(d) else None, "mean_abs": float(d.mean()) if len(d) else None,
                "share_within_0.5c": float((d <= 0.005 + 1e-9).mean()) if len(d) else None,
                "share_within_1c": float((d <= 0.01 + 1e-9).mean()) if len(d) else None,
                "share_within_2c": float((d <= 0.02 + 1e-9).mean()) if len(d) else None}


    h1s = h1.sort_values("t"); h15s = h15.sort_values("t"); h5s = h5.sort_values("t")
    res_b = {}
    for name, hist, keys, col in (("p1h", h1s, ["coin", "hour_start"], "market_up"),
                                  ("p15", h15s, ["coin", "window_start"], "p15"),
                                  ("p5", h5s, ["coin", "window_start"], "p5")):
        kcol = {"p1h": "hs", "p15": "w15", "p5": "w5"}[name]
        live = bt[col].astype(float).to_numpy()
        pv, nx, nr, age = point_lookup(hist, keys, list(zip(bt.coin, bt[kcol])), bt.ts.to_numpy())
        res_b[name] = {"last_point_le_ts": stats(pv - live), "next_point_ge_ts": stats(nx - live), "nearest_point": stats(nr - live),
                       "bias_mean(hist-live)": float(np.nanmean(pv - live)), "median_age_s": float(np.nanmedian(age))}
    # Down-token (1 - p_down) for the 1H market
    d1 = hd[hd.kind == "1h"].sort_values("t")
    pv, nx, nr, age = point_lookup(d1, ["coin", "hour_start"], list(zip(bt.coin, bt.hs)), bt.ts.to_numpy())
    res_b["p1h_from_down_token"] = {"last_point_le_ts": stats((1 - pv) - bt.market_up.to_numpy())}
    # grid rows at the nearest minute <= ts (t>=1 only)
    bt["m"] = ((bt.ts - bt.hs) // 60).astype(int)
    gj = bt[bt.m >= 1].merge(g[["coin", "hour_start", "t", "p1h", "p15", "p5", "base_fair", "s0", "sigma1h", "st"]],
                             left_on=["coin", "hs", "m"], right_on=["coin", "hour_start", "t"], how="inner", suffixes=("_bt", "_g"))
    res_b["grid_minute_floor"] = {"rows": len(gj), "p1h": stats(gj.p1h - gj.market_up), "p15": stats(gj.p15_g - gj.p15_bt),
                                  "p5": stats(gj.p5_g - gj.p5_bt)}
    # midpoint vs last-trade diagnostics: half-tick share inside the 0.01-tick zone
    allp = pd.concat([h1.p, h15.p, h5.p]).to_numpy()
    mid_zone = allp[(allp > 0.04) & (allp < 0.96)]
    half = np.isclose((mid_zone * 1000) % 10, 5, atol=1e-6)
    res_b["half_tick_share_(p in 0.04..0.96)"] = float(half.mean())
    # Up vs Down points at (nearly) the same second: p_up + p_down
    u = h1[["coin", "hour_start", "t", "p"]]; dd = d1[["coin", "hour_start", "t", "p"]]
    mm_ = pd.merge_asof(u.sort_values("t"), dd.sort_values("t").rename(columns={"p": "pd", "t": "td"}), left_on="t", right_on="td",
                        by=["coin", "hour_start"], direction="nearest", tolerance=2)
    mm_ = mm_.dropna(subset=["pd"])
    s = (mm_.p + mm_.pd).to_numpy()
    res_b["up_plus_down_within_2s"] = {"n": int(len(s)), "share_exactly_1(±1e-6)": float(np.isclose(s, 1, atol=1e-6).mean()) if len(s) else None,
                                       "median_abs_dev": float(np.median(np.abs(s - 1))) if len(s) else None}
    uu = h1.sort_values(["coin", "hour_start", "t"])
    lag = (uu.t % 60).value_counts(normalize=True).head(5).round(3).to_dict()
    res_b["up_point_second_of_minute_top5"] = {int(k): v for k, v in lag.items()}
    dl = d1.t % 60
    res_b["down_point_second_of_minute_top5"] = {int(k): v for k, v in dl.value_counts(normalize=True).head(5).round(3).to_dict().items()}
    # label-timing curve: |history point - live midpoint| vs signed offset (t_point - live ts), 5 s bins
    H1 = {k: v for k, v in h1.groupby(["coin", "hour_start"])}
    recs = []
    for x in bt.itertuples():
        v = H1.get((x.coin, x.hs))
        if v is not None:
            w = v[(v.t >= x.ts - 60) & (v.t <= x.ts + 60)]
            recs += [(t - x.ts, abs(p - x.market_up)) for t, p in zip(w.t, w.p)]
    tc = pd.DataFrame(recs, columns=["off", "err"])
    tc["bin"] = (tc.off // 5 * 5).astype(int)
    curve = tc.groupby("bin").err.agg(median="median", n="count")
    curve["share_exact"] = tc.groupby("bin").err.apply(lambda e: float((e < 1e-6).mean()))
    res_b["timing_curve_5s_bins"] = {int(k): {"median_abs": round(float(r["median"]), 4), "share_exact": round(float(r.share_exact), 3), "n": int(r.n)}
                                     for k, r in curve.iterrows()}
    out["b_prices_vs_live"] = res_b
    print("(b)", json.dumps(res_b, indent=1))
else:
    print(f"(b) skipped: live-snapshot file {BT} not found (set BT_DATASET to enable)")

# ---------------- (c) staleness ----------------
res_c = {}
for c in ("p1h", "p15", "p5", "p1h_dn"):
    a = g[f"{c}_age_s"]
    res_c[c] = {"missing_share": float(a.isna().mean()), "stale_gt_120s_share": float((a > 120).mean()),
                "stale_gt_120s_share_of_present": float((a[a.notna()] > 120).mean()),
                "age_quantiles_s": {q: float(a.quantile(q)) for q in (0.5, 0.9, 0.99)}}
fresh = np.fmin(g.p1h_age_s, g.p1h_dn_age_s)
res_c["p1h_or_dn_fresher_gt_120s_share"] = float((fresh > 120).mean())
res_c["p1h_or_dn_fresher_median_age_s"] = float(np.nanmedian(fresh))
res_c["p1h_stale_by_coin"] = g.groupby("coin").p1h_age_s.apply(lambda a: float((a > 120).mean())).round(4).to_dict()
res_c["stale_or_missing_p1h_by_hour_utc"] = {iso(k): int(v) for k, v in
                                             g[(g.p1h_age_s > 120) | g.p1h.isna()].groupby("hour_start").size().items()}
for c in ("p1h", "p15", "p5"):
    a = g[f"{c}_snap_lag_s"]
    res_c[f"{c}_snap"] = {"missing_share": float(a.isna().mean()), "lag_quantiles_s": {q: float(a.quantile(q)) for q in (0.01, 0.5, 0.99)}}
out["c_staleness"] = res_c
print("(c)", json.dumps(res_c, indent=1))

# ---------------- (d) base_fair sanity vs bt 'new' ----------------
if HAVE_BT:
    gj["bt_base"] = [r["base_no_drift"] for r in gj.new]
    res_d = {}
    for lab, sub in (("non_hype", gj[gj.coin != "hype"]), ("hype", gj[gj.coin == "hype"])):
        res_d[lab] = {"rows": len(sub),
                      "base_fair_grid_minute_vs_bt": stats(sub.base_fair - sub.bt_base),
                      "corr": float(np.corrcoef(sub.base_fair, sub.bt_base)[0, 1]) if len(sub) > 2 else None,
                      "s0_exact_match_share": float(np.isclose(sub.s0_g, sub.s0_bt, rtol=0, atol=1e-9).mean()),
                      "sigma1h_max_abs_diff": float(np.abs(sub.sigma1h_g - sub.sigma1h_bt).max()),
                      "s0_median_rel_diff": float(np.median(np.abs(sub.s0_g / sub.s0_bt - 1)))}
    # exact recomputation: grid s0/sigma with bt's exact fractional t and bt's st -> should equal bt base to rounding
    from scipy.stats import norm
    nh = gj[gj.coin != "hype"]
    exact = norm.cdf(np.log(nh.st_bt / nh.s0_g) / (np.clip(nh.sigma1h_g, 0.002, 0.2) * np.sqrt((60 - nh.t_bt) / 60)))
    res_d["non_hype_recomputed_with_bt_t_and_st"] = stats(exact - nh.bt_base)
    out["d_base_fair_sanity"] = res_d
    print("(d)", json.dumps(res_d, indent=1))
else:
    print(f"(d) skipped: live-snapshot file {BT} not found (set BT_DATASET to enable)")

json.dump(out, open(os.path.join(DATA, "validation.json"), "w"), indent=1, default=str)
print("wrote validation.json")

"""Extra sanity numbers for the README: s0 vs 1h open, ties, fee fields, Brier of prices / fair values."""
import os
import numpy as np
import pandas as pd
from common import DATA

g = pd.read_parquet(os.path.join(DATA, "backfill.parquet"))
mk = pd.read_parquet(os.path.join(DATA, "pm_markets.parquet"))
hh = g.drop_duplicates(["coin", "hour_start"])
print("s0 == Binance 1h open:", float(np.isclose(hh.s0, hh.bn_open_1h, rtol=0, atol=0).mean()))
print("ties close==open:", int((hh.bn_close_1h == hh.bn_open_1h).sum()), "of", len(hh))
print("outcome_up base rate:", round(hh.outcome_up.mean(), 4))
print("sigma_n distinct:", hh.sigma_n.unique())
print("fees by kind:")
print(mk[mk.found].groupby("kind")[["fees_enabled", "fee_type", "taker_base_fee", "maker_base_fee", "tick_size"]]
      .agg(lambda s: s.astype(str).value_counts().head(3).to_dict()).to_string())
print(mk[mk.found].fee_schedule.astype(str).value_counts().head(3).to_string())
print("1h volume median by coin:", mk[(mk.kind == "1h") & mk.found].groupby("coin").volume.median().round(0).to_dict())
ok = g.dropna(subset=["p1h", "base_fair", "fair_15m", "fair_5m", "outcome_up"])
ok = ok[ok.p1h_age_s <= 120]
y = ok.outcome_up
for c in ("p1h", "base_fair", "fair_15m", "fair_5m"):
    print(f"Brier {c}: {((ok[c] - y) ** 2).mean():.4f}  (rows {len(ok)})")
j = ok.dropna(subset=["fair_joint"])
print(f"Brier fair_joint {((j.fair_joint - j.outcome_up) ** 2).mean():.4f} vs p1h same rows {((j.p1h - j.outcome_up) ** 2).mean():.4f} (rows {len(j)})")

# Up/Down signal research — September 2026

This report asks whether the Up/Down signals in this app (the UP/DOWN alert and the Jev
BULLISH/BEARISH alert) can predict Polymarket's hourly crypto Up/Down markets well enough to trade.
It also records what was changed in the code because of the answers.

**Short answer: no tested signal beats the market after trading costs.** The 1H market price is well
calibrated for liquid coins. Every rule that looked profitable at the midpoint lost money once the
spread and Polymarket's taker fee were paid. The research did find several ways to make the fair-value
models themselves more accurate, and those are now in the code.

## Data and method

- **Backfill:** 2026-08-28 22:00 to 2026-09-25 21:00 UTC, 672 hours × 7 coins (btc, eth, sol, xrp, doge,
  hype, bnb) × minutes 1–59 = 277,536 rows. Built with the scripts in this folder (see README.md).
- **Holdout:** a second, untouched 4-week period (2026-07-31 to 2026-08-28), fetched with the same
  pipeline after a written pre-registration, used only to confirm results.
- **Prices:** Polymarket CLOB 1-minute midpoint history for the 1H, 15m and 5m markets; Binance 1m and
  1h candles. Outcomes from the Binance 1h candle (close ≥ open → Up) agreed with Polymarket's own
  resolution on 4,700 of 4,700 coin-hours.
- **Costs:** Polymarket charges takers `0.07 × p × (1 − p)` per share on crypto markets (1.75¢ at 50¢,
  0.63¢ at 90¢; makers pay nothing). A buyer also crosses half the spread. "Realistic cost" below means
  the coin's measured half-spread plus that fee.
- **Statistics:** time-ordered train/test splits only (walk-forward by day or week), standard errors
  clustered by clock hour (coins move together within an hour), and every result checked by a separate
  reviewer who tried to refute it.

## Live spreads and fees (1H market, measured 22–25 Sep)

| coin | median quoted spread | mean effective half-spread | typical fee paid |
|---|---|---|---|
| BTC | 1¢ | 0.79¢ | 1.34¢ |
| ETH | 1¢ | 1.02¢ | 1.28¢ |
| SOL | 5¢ | 2.60¢ | 1.14¢ |
| XRP | 6¢ | 3.17¢ | 1.03¢ |
| BNB | 7¢ | 2.99¢ | 1.00¢ |
| DOGE | 9¢ | 4.15¢ | 0.76¢ |
| HYPE | 33¢ | 16.9¢ | 0.62¢ |

Alt spreads tighten late in the hour (SOL and XRP to about 1¢ in the last 15 minutes). 15m and 5m books
are 1–3¢ wide. HYPE's 1H book is so wide that its midpoint is not a tradeable price: in the last
10 minutes, real HYPE buyers paid a median 0.99 when the mid showed 0.845.

## Experiment 1 — Is the market price itself mispriced?

- The 1H midpoint is well calibrated for liquid coins: BTC+ETH calibration slope 1.016 ± 0.051
  (1.0 is perfect). The 15m (1.04) and 5m (1.00) markets are also well calibrated.
- The only large anomaly is HYPE late in the hour, and it is the wide-book midpoint artifact above.
- Rules that bought "underpriced" price buckets, chosen on earlier weeks, made +2 to +3.5¢ per trade at
  the midpoint out of sample but lost 1.7 to 3.3¢ per trade at executable cost.
- Across 586,521 real taker trades in all 1H markets, takers broke even before fees and lost about 1¢
  per share after fees, in every week.
- Verdict: no tradeable bias.

## Experiment 2 — The UP/DOWN alert and fair-value rules

- The old alert (15m drift fair value and Base both on the same side of the midpoint by ≥ 1.5¢) fired
  about 380 times a day. On the holdout it made +2.27¢ per trade at the midpoint but −3.90¢ at realistic
  cost (t = −9.9). Without HYPE: +1.13¢ at mid, −2.61¢ realistic. BTC+ETH only: flat even at mid.
- None of 63 variants (Base-only thresholds, BUY-only, excluding the last minutes, value rules, fixed
  models) was profitable at realistic cost out of sample without HYPE.
- **Model accuracy findings that held on the holdout:**
  - Using realized volatility of the last 60 one-minute bars (rv60) instead of the 7-day hourly
    volatility improved Base's log loss by 0.013 (t ≈ 5), for every coin and every holdout week.
  - The 15m, 5m and joint drift models applied the drift implied by a 15m or 5m market to the whole
    rest of the hour. That roughly doubled their log loss versus the market. Applying the drift only
    until the model's own window ends fixed most of it (15m: 1.00 → 0.485; 5m: 1.55 → 0.481;
    joint: 0.96 → 0.54; market ≈ 0.48; Base with rv60 0.470). Even fixed, the drift models remain
    worse than Base with rv60.
  - When a 15m or 5m price sits within about 1.5¢ of 0 or 1 it no longer reflects the spot move, and
    the drift model's error on those rows is four times larger.

## Experiment 3 — Can extra information beat the market?

- Models tried: regularized logistic regression and LightGBM, walk-forward by day over the last
  14–21 days, with features for spot distance to the open in volatility units, recent returns,
  volatility regime, BTC lead–lag for alts, 15m/5m prices, market momentum and taker order flow.
- With consistent timing, no model beat the 1H midpoint: best Brier difference −6.5e-4 with a 95% CI of
  [−22.9, +10.1]e-4. LightGBM overfit. Order flow added nothing.
- The model only "beat" a 46-second-old price, and only by as much as the market's own next snapshot
  did. About 26% of the gap between Base and a stale mid closes within ~15 s; on the rest the market is
  right.
- No trading rule was profitable after realistic costs (1,340 variants tried).
- **One open lead:** a reviewer found that real taker fills on alt 1H markets that a simple model liked,
  using Binance prices only 3–20 seconds old, made +2.0 to +4.3¢ per fill after fees (t 2.4–5.1), and
  nothing at 60 s. This is a latency effect with tiny capacity (median fill $3, about $10k over 21 days)
  and needs live, sub-second recording to confirm.

## Experiment 4 — Jev prompt design

Jev (OpenRouter decisions API, typesafe/jev-1.13) is a typed classifier, not a forecaster. It returns
probabilities only and has no temperature or seed control. On 900 decision points from the test week:

- Every Jev probability was less accurate than the market (market Brier 0.1718; Jev variants
  0.1771–0.2631).
- Given market prices, Jev agrees with the market favourite 98–100% of the time. When the 1H price in
  its input was changed and nothing else, its answer moved with it (0.10 → 0.13, 0.50 → 0.45,
  0.90 → 0.76).
- Without market prices it returns a compressed copy of the code's Base fair value (R² 0.95).
- The production BULLISH/BEARISH rule fired on 35% of points at an average entry of 91¢ and won 90%
  of the time, which is just buying the favourite. It lost 0.94¢ per share at the midpoint and about
  3.9¢ after realistic cost.
- The one-hour direction question is saturated (98.6% of answers at ≥ 0.99 or ≤ 0.01), and score/4 is
  overconfident (calibration slope 0.46).

## What changed in the code

- `src/app/api/updown/route.ts`: σ defaults to rv60 (fallback 7-day, then 0.02). A failed refresh keeps
  an rv60 up to 5 minutes old. The 15m, 5m and joint drift apply only until their window ends. Drift
  models are skipped when their market price is within 1.5¢ of 0 or 1. HYPE prices come from Binance
  USD-M futures, which is what its 1H markets resolve on. The response carries `modelVersion`,
  `sigma60m`, `sigma7d`, `priceVenue` and the tradeable 1H/15m Up-token books.
- `src/lib/updownSignal.ts` and `src/lib/alerts.ts`: the UP/DOWN alert fires only when both fair values
  beat the executable price (Up ask for BUY; 1 − Up bid for buying Down) plus the taker fee by ≥ 1¢, on
  a book at most 4¢ wide with at least $20 at the best price. HYPE is excluded. The cooldown is per
  hourly market.
- `src/lib/updownRecorder.ts`: the alerts worker appends one tick per coin every minute to
  `ticks/updown-YYYY-MM-DD.jsonl` with spot, opens, σ, books and all fair values. Polymarket keeps no
  order-book history, so these files are the only way to test signals at real prices later.
- Snapshot records in `jev/history` now also store `model_inputs` and `books`.

## Recommended next steps

1. Treat UP/DOWN alerts as informational. With costs included they should now be rare.
2. Retire or relabel the Jev BULLISH/BEARISH Telegram alert: it is a "favourite at ~91¢" alert with
   negative expected value after costs. If Jev is kept, use it only for text inputs such as news, as a
   feature in a model tested the same way.
3. Let the tick recorder run for several weeks, then re-test the rules at recorded bid/ask prices.
4. If the latency lead is worth pursuing, record Binance and the CLOB books over websockets at
   sub-second resolution before building anything that trades.
5. Re-run this pipeline on a longer window (1-minute CLOB history goes back at least 150 days) before
   trusting any edge of a few cents.

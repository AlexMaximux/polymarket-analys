# Ladder-Entry Backtest — Design

Date: 2026-09-27
Status: approved in conversation, pending written-spec review

## 1. Intent

Cloud Analysis (`/cloud-analysis`) already backtests a single-entry strategy: when the Jev/Kev/Span model fires a signal, buy one stake at the quoted price and hold to resolution (`src/lib/signalAnalysis.ts`). The owner wants to test a ladder / averaging-down variant on top of that: when the initial signal fires (1x stake), place additional smaller orders further down in price on the same side, and only count them if the price actually reached that level. Sizes and distances must be adjustable, and the owner wants an automatic search for the best-performing combination.

Owner's own words: place the first order at signal time (1x), then further orders at configurable distances (default 15¢/30¢/50¢ below the first entry) and sizes (default 0.5x/0.35x/0.2x), verify each one actually would have filled, keep the numbers adjustable, and find the best-performing combination automatically.

### Decisions already made (see conversation)

- Ladder distances are in **cents** of price (0-100 scale), not percentage.
- Fill detection uses the **existing periodic snapshots** already loaded by the page (no new data source); if price crosses a rung's threshold between two snapshots with no row in between, it is treated as not-filled. This is an accepted approximation.
- Optimizer objective: maximize **total ROI**.
- Optimizer must guard against overfitting: search on a **train** slice of history, report results on a **holdout** slice the search never saw, reusing the walk-forward split date (`splitDate`/`effectiveSplit`) that already exists on the page.
- No new API route, no new npm dependency. Computation stays client-side, in a new pure module alongside `signalAnalysis.ts`.

### Success criteria

1. `test/ladderBacktest.test.ts` covers fill detection, PnL/blended-entry math, ladder metrics, and the optimizer, and passes.
2. The existing `signalAnalysis.ts` file and its 130 existing tests are unmodified and still pass.
3. `/cloud-analysis` gets a new "Ladder Backtest" section showing live metrics for the manually-configured ladder and an "Optimize" action that reports train vs. holdout ROI for the best combination found.
4. `npx tsc --noEmit`, `npx vitest run`, `npm run build` pass; manual Playwright check of the new section with zero console errors.

## 2. Data model (`src/lib/ladderBacktest.ts`, pure functions, no React)

```ts
export interface LadderRung {
  distanceCents: number;   // price drop from the base entry, e.g. 15
  sizeMultiplier: number;  // relative to the base stake, e.g. 0.5
}

export interface LadderConfig {
  rungs: LadderRung[]; // additional rungs beyond the always-filled base (1x at signal price)
}

export const DEFAULT_LADDER_CONFIG: LadderConfig = {
  rungs: [
    { distanceCents: 15, sizeMultiplier: 0.5 },
    { distanceCents: 30, sizeMultiplier: 0.35 },
    { distanceCents: 50, sizeMultiplier: 0.2 },
  ],
};

export interface RungFill {
  distanceCents: number;
  sizeMultiplier: number;
  filled: boolean;
  fillPrice: number | null; // the rung's own limit price when filled, never the observed snapshot price
  fillTime: number | null;
}

export interface LadderTrade {
  base: Trade;            // from signalAnalysis.buildTrades()
  rungs: RungFill[];
  totalStake: number;
  totalShares: number;
  blendedEntry: number | null;
  status: TradeStatus;    // identical to base.status; rungs never change the market outcome
  pnl: number;
}

export interface LadderMetrics {
  trades: number; wins: number; losses: number; pending: number; resolved: number;
  winRate: number | null; ciLow: number | null; ciHigh: number | null;
  breakEven: number | null; edge: number | null;
  pnl: number; roi: number | null; evPerTrade: number | null;
  maxDrawdown: number; maxLossStreak: number;
  fillRateByRung: number[]; // % of trades where rung i filled, same order as config.rungs
  avgRungsFilled: number;
}
```

`Trade`, `TradeStatus`, `SnapshotRow`, `sidePrice`, `MIN_RESOLVED_FOR_VERDICT` are imported from `signalAnalysis.ts`; nothing in that file changes.

## 3. Fill simulation

```ts
export function buildLadderTrades(
  baseTrades: Trade[],       // output of signalAnalysis.buildTrades() for the current filter config
  allRows: SnapshotRow[],    // every loaded snapshot, unfiltered — this is the price series
  ladderCfg: LadderConfig,
  baseStake: number,
): LadderTrade[]
```

For each base trade:

1. Collect every row in `allRows` with the same `marketKey` and `rowTime(row) > base.time`, sorted chronologically. This is the forward price path for that market hour, built from whatever snapshots exist (dense or sparse — see accepted approximation above).
2. For each configured rung, independently: find the first row where `sidePrice(row, base.dir) <= base.quote - distanceCents / 100`. If found, the rung is filled at the rung's own limit price (`base.quote - distanceCents/100`), not the row's observed price — a resting limit order fills at its limit price or better, and using the limit price is the conservative assumption given snapshot-only data. `fillTime` records the row's timestamp for diagnostics.
3. `totalStake = baseStake + Σ filled rungs (baseStake * sizeMultiplier)`.
4. `totalShares = baseStake / base.entry + Σ filled rungs (baseStake * sizeMultiplier / fillPrice)`. Trades where `base.entry` is null are skipped (mirrors existing `buildTrades` null-price handling).
5. `status = base.status`. `pnl = status === 'WIN' ? totalShares - totalStake : status === 'LOSS' ? -totalStake : 0` — the direct generalization of `tradePnl` in `signalAnalysis.ts` to a variable number of fills.
6. `blendedEntry = totalStake / totalShares` when `totalShares > 0`, else `null`.

## 4. Metrics

`computeLadderMetrics(trades: LadderTrade[]): LadderMetrics` mirrors `computeMetrics` in `signalAnalysis.ts` (same win/loss/pending counting, Wilson interval, drawdown, loss-streak tracking) but:

- ROI is `pnl / Σ totalStake` over resolved trades (variable stake per trade, unlike the fixed-stake original).
- `breakEven` uses `blendedEntry` the same harmonic-mean way the original uses `entry`.
- `fillRateByRung[i]` = fraction of trades where `rungs[i].filled` is true — this directly answers "did these orders actually trigger."
- `avgRungsFilled` = mean count of filled rungs per trade.

## 5. Optimizer

```ts
export interface OptimizerOptions {
  rangeCents?: [number, number];    // default [5, 80]
  rangeMultiplier?: [number, number]; // default [0.05, 1]
  iterations?: number;              // default 2000
  minTrainResolved?: number;        // default MIN_RESOLVED_FOR_VERDICT (30)
}

export interface OptimizerResult {
  config: LadderConfig;
  trainMetrics: LadderMetrics;
  holdoutMetrics: LadderMetrics;
  triedCount: number;
  cancelled: boolean;
}

export function optimizeLadder(
  baseTrades: Trade[],
  allRows: SnapshotRow[],
  baseStake: number,
  splitDate: string,          // reuses the page's existing effectiveSplit
  opts?: OptimizerOptions,
  shouldCancel?: () => boolean,
): OptimizerResult
```

- `train = baseTrades.filter(t => t.date < splitDate)`, `holdout = baseTrades.filter(t => t.date >= splitDate)` — identical split semantics to the existing walk-forward panel.
- Bounded random search over the rung count fixed at the configured length (default 3): each iteration draws random `distanceCents`/`sizeMultiplier` per rung within range, snapped to a coarse step (5¢, 0.05x) to keep the space finite and results reproducible-ish. The first iteration always evaluates `DEFAULT_LADDER_CONFIG` (or the user's current manual config, passed in) so the optimizer can never report something worse than the starting point.
- A candidate is scored by `computeLadderMetrics(buildLadderTrades(train, allRows, candidate, baseStake)).roi`, but only if train `resolved >= minTrainResolved`; otherwise it is skipped (avoids picking a config that "wins" on 3 lucky trades).
- Best candidate by train ROI is kept; its holdout metrics are computed separately (holdout trades never influence candidate scoring).
- Runs in chunks (e.g. 100 iterations per `setTimeout(0)` yield) so the UI thread stays responsive; `shouldCancel` is checked between chunks so the UI can offer a Cancel button.

## 6. UI (`src/app/cloud-analysis/page.tsx`)

New card, "Ladder Backtest", placed after the existing results/breakdown section, reusing already-loaded `rows`, `trades` (as `baseTrades`), `cfg.stake`, and `effectiveSplit` — no new fetch.

- Three rung rows (distance¢ + multiplier inputs), defaulting to `DEFAULT_LADDER_CONFIG`, editable.
- Live `LadderMetrics` for the current manual config: trade count, win rate, ROI, edge, and a fill-rate line per rung ("rung 1 (15¢): filled in 63% of trades").
- "Optimize" button: runs `optimizeLadder`, shows a progress count while running with a Cancel button, then displays the found config plus train ROI vs. holdout ROI side by side (flagging a large train/holdout gap the same way the existing notes panel flags other overfitting risks), with an "Apply" button that loads the found config into the manual inputs.

## 7. Error handling

No new network calls or external failure modes — this feature only transforms data already in memory. Empty/insufficient data (no rows, no base trades) reuses the page's existing empty-state pattern. The optimizer cannot throw on a malformed candidate (all generated values are within the configured numeric ranges by construction).

## 8. Testing (`test/ladderBacktest.test.ts`, mirrors `test/signalAnalysis.test.ts` style)

- Fill detection: a rung fills when a later same-market row crosses its threshold; stays unfilled when price never crosses it; fill price equals the rung's limit price, not the crossing row's own (lower) price.
- PnL/blended-entry math on a synthetic win with 2 filled rungs and a synthetic loss.
- `computeLadderMetrics`: ROI, breakeven and `fillRateByRung` on a small fixed set of `LadderTrade`s.
- Optimizer: a small synthetic dataset with a known best config within range; asserts the optimizer's result ROI on train is at least as good as `DEFAULT_LADDER_CONFIG`'s, and that `holdoutMetrics` is computed from trades strictly on/after `splitDate`.

# Ladder-Entry Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an averaging-down ("ladder") backtest to `/cloud-analysis`: on top of the existing single-entry backtest, simulate extra orders at configurable price levels below the signal price, verify from the loaded snapshot data whether each would actually have filled, and provide a train/holdout optimizer that searches for the best distance/size combination.

**Architecture:** A new pure-function module (`src/lib/ladderBacktest.ts`) that consumes the existing `signalAnalysis.ts` engine's output (`Trade[]`) and the raw snapshot rows already loaded by the page, without modifying `signalAnalysis.ts`. A new client component (`src/components/cloud-analysis/LadderPanel.tsx`) renders it, wired into the existing `/cloud-analysis` page by reusing state that page already computes (`rows`, `trades`, `cfg.stake`, `effectiveSplit`).

**Tech Stack:** TypeScript, React (Next.js App Router client components), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-ladder-backtest-design.md`

## Global Constraints

- No new npm dependency.
- No new API route; all ladder computation is pure client-side functions.
- `src/lib/signalAnalysis.ts` is never modified — only imported from.
- Ladder distances are cents on the existing 0-100 price scale (same convention as `up_1h_num` / `sidePrice`).
- Fill detection uses only the snapshot rows the page has already loaded (`allRows`) — no new data source, no new fetch.
- The train/holdout split reuses the page's existing `effectiveSplit` date state — no new date-range control.
- TDD throughout: write the failing test, watch it fail, write the minimal implementation, watch it pass, commit — one task at a time.

## Review Focus

- Empty or insufficient data (`baseTrades = []`, or `allRows = []`) must not crash `buildLadderTrades` or `computeLadderMetrics` — they should return empty/neutral results.
- A base trade whose `entry` or `quote` is `null` (a signal fired but no price was recorded) must be skipped safely by the fill/PnL math, not thrown on or silently corrupt the totals.
- Trades still `PENDING` (market not yet resolved) must still count toward `fillRateByRung` — that diagnostic is about whether price reached a level, independent of the eventual win/loss.
- The optimizer must never report a config that scores worse than the starting config, and must fall back cleanly to the starting config when every random candidate fails the minimum-train-trades bar.
- `holdoutMetrics` must be computed strictly from trades dated on/after `splitDate` — none of the trades the search scored candidates against may leak into the reported out-of-sample number.

---

### Task 1: Ladder data model + fill simulation

**Files:**
- Create: `src/lib/ladderBacktest.ts`
- Test: `test/ladderBacktest.test.ts`

**Interfaces:**
- Consumes: from `src/lib/signalAnalysis.ts` — `Trade`, `TradeStatus`, `SnapshotRow`, `sidePrice(r: SnapshotRow, dir: Dir): number | null`, `rowTime(r: SnapshotRow): number`, `marketKey(r: SnapshotRow): string`.
- Produces: `LadderRung`, `LadderConfig`, `DEFAULT_LADDER_CONFIG`, `RungFill`, `LadderTrade`, `buildLadderTrades(baseTrades: Trade[], allRows: SnapshotRow[], ladderCfg: LadderConfig, baseStake: number): LadderTrade[]` — used by Task 2 and Task 3.

- [ ] **Step 1: Write the failing tests**

Create `test/ladderBacktest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTrades, DEFAULT_ANALYSIS_CONFIG, type AnalysisConfig, type SnapshotRow } from '@/lib/signalAnalysis';
import { buildLadderTrades, DEFAULT_LADDER_CONFIG, type LadderConfig } from '@/lib/ladderBacktest';

let seq = 0;
function row(p: Partial<SnapshotRow> & { hm: string; slug?: string }): SnapshotRow {
  seq++;
  const [h, m] = p.hm.split(':');
  return {
    filename: `btc_updown_2026-09-26_${h}-${m}-00_ET_${seq}.json`,
    coin: 'BTC',
    et_time: `2026-09-26 ${h}:${m}:00 ET`,
    timestamp: `2026-09-26T${String(Number(h) + 4).padStart(2, '0')}:${m}:00.000Z`,
    market_slug: p.slug ?? `bitcoin-up-or-down-september-26-2026-${Number(h)}am-et`,
    score: 3.8,
    score_confidence: 95,
    direction: 'UP',
    kev_direction: 'UP',
    span_direction: 'UP',
    up_1h_num: 80,
    market_outcome: 'UP',
    ...p,
  };
}
const cfg = (over: Partial<AnalysisConfig> = {}): AnalysisConfig => ({ ...DEFAULT_ANALYSIS_CONFIG, ...over });
const ladderCfg = (rungs: LadderConfig['rungs']): LadderConfig => ({ rungs });

describe('buildLadderTrades — fill detection', () => {
  it('fills a rung when a later same-market row crosses its threshold', () => {
    // signal at 04:10, up_1h_num=80 -> quote 0.80. Rung at 15c -> threshold 0.65.
    // 04:20 up_1h_num=60 -> price 0.60, crosses it.
    const rows = [row({ hm: '04:10' }), row({ hm: '04:20', up_1h_num: 60 })];
    const base = buildTrades(rows, cfg());
    const [t] = buildLadderTrades(base, rows, ladderCfg([{ distanceCents: 15, sizeMultiplier: 0.5 }]), 10);
    expect(t.rungs[0].filled).toBe(true);
    expect(t.rungs[0].fillPrice).toBeCloseTo(0.65); // the rung's own limit price, not the observed 0.60
  });

  it('leaves a rung unfilled when price never reaches it', () => {
    const rows = [row({ hm: '04:10' }), row({ hm: '04:20', up_1h_num: 78 })];
    const base = buildTrades(rows, cfg());
    const [t] = buildLadderTrades(base, rows, ladderCfg([{ distanceCents: 15, sizeMultiplier: 0.5 }]), 10);
    expect(t.rungs[0].filled).toBe(false);
    expect(t.rungs[0].fillPrice).toBeNull();
  });

  it('ignores rows at or before the signal time, and rows from a different market', () => {
    const rows = [
      row({ hm: '04:05', up_1h_num: 50 }), // before signal, would satisfy threshold but must not count
      row({ hm: '04:10' }), // the signal itself
      row({ hm: '05:05', up_1h_num: 50, slug: 'bitcoin-up-or-down-september-26-2026-5am-et' }), // different hour/market
    ];
    const base = buildTrades(rows, cfg());
    const [t] = buildLadderTrades(base, rows, ladderCfg([{ distanceCents: 15, sizeMultiplier: 0.5 }]), 10);
    expect(t.rungs[0].filled).toBe(false);
  });

  it('checks each rung independently against the full forward series', () => {
    const rows = [row({ hm: '04:10' }), row({ hm: '04:20', up_1h_num: 25 })]; // price crashes straight to 0.25
    const base = buildTrades(rows, cfg());
    const cfgLadder = ladderCfg([
      { distanceCents: 15, sizeMultiplier: 0.5 },
      { distanceCents: 50, sizeMultiplier: 0.2 },
    ]);
    const [t] = buildLadderTrades(base, rows, cfgLadder, 10);
    expect(t.rungs[0].filled).toBe(true);
    expect(t.rungs[1].filled).toBe(true);
    expect(t.rungs[1].fillPrice).toBeCloseTo(0.3); // 0.80 - 50c
  });
});

describe('buildLadderTrades — stake, shares, blended entry, pnl', () => {
  it('computes blended entry and a winning pnl across two filled rungs', () => {
    // base: $10 @ 0.80 -> 12.5 shares. rung1 fills @0.65 with 0.5x=$5 -> 7.6923 shares.
    const rows = [row({ hm: '04:10' }), row({ hm: '04:20', up_1h_num: 60 })];
    const base = buildTrades(rows, cfg());
    const [t] = buildLadderTrades(base, rows, ladderCfg([{ distanceCents: 15, sizeMultiplier: 0.5 }]), 10);
    expect(t.totalStake).toBeCloseTo(15);
    expect(t.totalShares).toBeCloseTo(10 / 0.8 + 5 / 0.65);
    expect(t.blendedEntry).toBeCloseTo(t.totalStake / t.totalShares);
    expect(t.status).toBe('WIN');
    expect(t.pnl).toBeCloseTo(t.totalShares - t.totalStake);
  });

  it('a loss forfeits exactly the filled stake, unfilled rungs risk nothing', () => {
    const rows = [
      row({ hm: '04:10', market_outcome: 'DOWN' }),
      row({ hm: '04:20', up_1h_num: 78, market_outcome: 'DOWN' }), // never reaches the 15c rung
    ];
    const base = buildTrades(rows, cfg());
    const [t] = buildLadderTrades(base, rows, ladderCfg([{ distanceCents: 15, sizeMultiplier: 0.5 }]), 10);
    expect(t.rungs[0].filled).toBe(false);
    expect(t.totalStake).toBeCloseTo(10); // only the base stake was ever at risk
    expect(t.status).toBe('LOSS');
    expect(t.pnl).toBeCloseTo(-10);
  });
});

describe('buildLadderTrades — edge cases', () => {
  it('returns an empty array for no trades', () => {
    expect(buildLadderTrades([], [], DEFAULT_LADDER_CONFIG, 10)).toEqual([]);
  });

  it('skips a trade with no quoted price without throwing', () => {
    const rows = [row({ hm: '04:10', up_1h_num: null })];
    const base = buildTrades(rows, cfg());
    expect(() => buildLadderTrades(base, rows, DEFAULT_LADDER_CONFIG, 10)).not.toThrow();
    const [t] = buildLadderTrades(base, rows, DEFAULT_LADDER_CONFIG, 10);
    expect(t.totalShares).toBe(0);
    expect(t.blendedEntry).toBeNull();
    expect(t.pnl).toBe(0);
    expect(t.rungs.every((r) => !r.filled)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/ladderBacktest.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ladderBacktest'` (the file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/ladderBacktest.ts`:

```ts
// Averaging-down ("ladder") backtest on top of signalAnalysis.ts. Pure functions only; that
// file is never modified, only imported from.

import { Trade, TradeStatus, SnapshotRow, sidePrice, rowTime, marketKey } from "./signalAnalysis";

export interface LadderRung {
  distanceCents: number; // price drop from the base entry, e.g. 15
  sizeMultiplier: number; // relative to the base stake, e.g. 0.5
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
  base: Trade;
  rungs: RungFill[];
  totalStake: number;
  totalShares: number;
  blendedEntry: number | null;
  status: TradeStatus;
  pnl: number;
}

function groupRowsByMarket(rows: SnapshotRow[]): Map<string, SnapshotRow[]> {
  const map = new Map<string, SnapshotRow[]>();
  for (const r of rows) {
    const k = marketKey(r);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  for (const arr of map.values()) arr.sort((a, b) => rowTime(a) - rowTime(b));
  return map;
}

function findFill(forwardRows: SnapshotRow[], dir: Trade["dir"], threshold: number): number | null {
  for (const r of forwardRows) {
    const p = sidePrice(r, dir);
    if (p != null && p <= threshold) return rowTime(r);
  }
  return null;
}

export function buildLadderTrades(
  baseTrades: Trade[],
  allRows: SnapshotRow[],
  ladderCfg: LadderConfig,
  baseStake: number,
): LadderTrade[] {
  const rowsByMarket = groupRowsByMarket(allRows);

  return baseTrades.map((base) => {
    const group = rowsByMarket.get(base.marketKey) ?? [];
    const forward = group.filter((r) => rowTime(r) > base.time);

    if (base.entry == null || base.quote == null) {
      const rungs: RungFill[] = ladderCfg.rungs.map((r) => ({ ...r, filled: false, fillPrice: null, fillTime: null }));
      return { base, rungs, totalStake: baseStake, totalShares: 0, blendedEntry: null, status: base.status, pnl: 0 };
    }

    let totalStake = baseStake;
    let totalShares = baseStake / base.entry;
    const rungs: RungFill[] = ladderCfg.rungs.map((rung) => {
      const threshold = base.quote! - rung.distanceCents / 100;
      const fillTime = findFill(forward, base.dir, threshold);
      if (fillTime == null) return { ...rung, filled: false, fillPrice: null, fillTime: null };
      const fillPrice = threshold;
      const stakeAmt = baseStake * rung.sizeMultiplier;
      totalStake += stakeAmt;
      totalShares += stakeAmt / fillPrice;
      return { ...rung, filled: true, fillPrice, fillTime };
    });

    const blendedEntry = totalShares > 0 ? totalStake / totalShares : null;
    const status = base.status;
    const pnl = status === "WIN" ? totalShares - totalStake : status === "LOSS" ? -totalStake : 0;
    return { base, rungs, totalStake, totalShares, blendedEntry, status, pnl };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/ladderBacktest.test.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ladderBacktest.ts test/ladderBacktest.test.ts
git commit -m "feat(cloud-analysis): simulate ladder-entry order fills against loaded snapshots"
```

---

### Task 2: Ladder metrics

**Files:**
- Modify: `src/lib/ladderBacktest.ts`
- Test: `test/ladderBacktest.test.ts`

**Interfaces:**
- Consumes: `LadderTrade` (Task 1), `wilson` and `MIN_RESOLVED_FOR_VERDICT` from `src/lib/signalAnalysis.ts`.
- Produces: `LadderMetrics`, `computeLadderMetrics(trades: LadderTrade[]): LadderMetrics` — used by Task 3 and Task 4.

- [ ] **Step 1: Write the failing tests**

In `test/ladderBacktest.test.ts`, change the existing top import `import { buildLadderTrades, DEFAULT_LADDER_CONFIG, type LadderConfig } from '@/lib/ladderBacktest';` to also pull in the two new names:

```ts
import { buildLadderTrades, computeLadderMetrics, DEFAULT_LADDER_CONFIG, type LadderConfig, type LadderTrade } from '@/lib/ladderBacktest';
```

Then append to the bottom of the file:

```ts
function ladderTrade(p: Partial<LadderTrade> & { status: LadderTrade['status']; pnl: number; totalStake: number; blendedEntry: number | null; filled: boolean[] }): LadderTrade {
  return {
    base: {} as any,
    rungs: p.filled.map((filled, i) => ({ distanceCents: (i + 1) * 15, sizeMultiplier: 0.5, filled, fillPrice: filled ? 0.5 : null, fillTime: filled ? 1 : null })),
    totalStake: p.totalStake,
    totalShares: p.blendedEntry ? p.totalStake / p.blendedEntry : 0,
    blendedEntry: p.blendedEntry,
    status: p.status,
    pnl: p.pnl,
  };
}

describe('computeLadderMetrics', () => {
  it('returns neutral zero/null values for an empty trade list', () => {
    const m = computeLadderMetrics([]);
    expect(m).toMatchObject({ trades: 0, wins: 0, losses: 0, pending: 0, resolved: 0, winRate: null, roi: null, fillRateByRung: [], avgRungsFilled: 0 });
  });

  it('computes ROI from total staked across resolved trades, and per-rung fill rate', () => {
    const trades = [
      ladderTrade({ status: 'WIN', pnl: 5, totalStake: 15, blendedEntry: 0.75, filled: [true, false] }),
      ladderTrade({ status: 'LOSS', pnl: -10, totalStake: 10, blendedEntry: 0.8, filled: [false, false] }),
    ];
    const m = computeLadderMetrics(trades);
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(1);
    expect(m.roi).toBeCloseTo(-5 / 25);
    expect(m.fillRateByRung).toEqual([0.5, 0]);
    expect(m.avgRungsFilled).toBeCloseTo(0.5);
  });

  it('counts a pending trade toward fillRateByRung diagnostics but not toward wins/losses/roi', () => {
    const trades = [ladderTrade({ status: 'PENDING', pnl: 0, totalStake: 15, blendedEntry: 0.75, filled: [true, true] })];
    const m = computeLadderMetrics(trades);
    expect(m.pending).toBe(1);
    expect(m.resolved).toBe(0);
    expect(m.roi).toBeNull();
    expect(m.fillRateByRung).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/ladderBacktest.test.ts`
Expected: FAIL — `computeLadderMetrics` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/ladderBacktest.ts` (add the import of `wilson` to the existing import line at the top: `import { Trade, TradeStatus, SnapshotRow, sidePrice, rowTime, marketKey, wilson } from "./signalAnalysis";`):

```ts
export interface LadderMetrics {
  trades: number;
  wins: number;
  losses: number;
  pending: number;
  resolved: number;
  winRate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  breakEven: number | null;
  edge: number | null;
  pnl: number;
  roi: number | null;
  evPerTrade: number | null;
  maxDrawdown: number;
  maxLossStreak: number;
  fillRateByRung: number[];
  avgRungsFilled: number;
}

export function computeLadderMetrics(trades: LadderTrade[]): LadderMetrics {
  let wins = 0, losses = 0, pending = 0, pnl = 0;
  let invEntrySum = 0, priced = 0;
  let stakedResolved = 0;
  let equity = 0, peak = 0, maxDrawdown = 0, lossStreak = 0, maxLossStreak = 0;
  const rungCount = trades[0]?.rungs.length ?? 0;
  const rungFillCounts = new Array(rungCount).fill(0);
  let totalRungsFilled = 0;

  for (const t of trades) {
    t.rungs.forEach((r, i) => {
      if (r.filled) {
        rungFillCounts[i]++;
        totalRungsFilled++;
      }
    });
    if (t.status === "PENDING") {
      pending++;
      continue;
    }
    if (t.status === "WIN") {
      wins++;
      lossStreak = 0;
    } else {
      losses++;
      lossStreak++;
    }
    maxLossStreak = Math.max(maxLossStreak, lossStreak);
    if (t.blendedEntry != null && t.blendedEntry > 0) {
      invEntrySum += 1 / t.blendedEntry;
      priced++;
    }
    stakedResolved += t.totalStake;
    pnl += t.pnl;
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const resolved = wins + losses;
  const winRate = resolved ? wins / resolved : null;
  const ci = wilson(wins, resolved);
  const breakEven = priced ? priced / invEntrySum : null;
  return {
    trades: trades.length,
    wins,
    losses,
    pending,
    resolved,
    winRate,
    ciLow: ci?.low ?? null,
    ciHigh: ci?.high ?? null,
    breakEven,
    edge: winRate != null && breakEven != null ? winRate - breakEven : null,
    pnl,
    roi: stakedResolved > 0 ? pnl / stakedResolved : null,
    evPerTrade: resolved ? pnl / resolved : null,
    maxDrawdown,
    maxLossStreak,
    fillRateByRung: rungFillCounts.map((c) => (trades.length ? c / trades.length : 0)),
    avgRungsFilled: trades.length ? totalRungsFilled / trades.length : 0,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/ladderBacktest.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ladderBacktest.ts test/ladderBacktest.test.ts
git commit -m "feat(cloud-analysis): compute ladder backtest metrics and per-rung fill rate"
```

---

### Task 3: Optimizer with train/holdout split

**Files:**
- Modify: `src/lib/ladderBacktest.ts`
- Test: `test/ladderBacktest.test.ts`

**Interfaces:**
- Consumes: `buildLadderTrades`, `computeLadderMetrics`, `DEFAULT_LADDER_CONFIG` (Task 1/2), `Trade`, `SnapshotRow`, `MIN_RESOLVED_FOR_VERDICT` from `src/lib/signalAnalysis.ts`.
- Produces: `OptimizerOptions`, `OptimizerResult`, `optimizeLadder(baseTrades: Trade[], allRows: SnapshotRow[], baseStake: number, splitDate: string, startingConfig?: LadderConfig, opts?: OptimizerOptions, shouldCancel?: () => boolean): Promise<OptimizerResult>` — used by Task 4.

- [ ] **Step 1: Write the failing tests**

In `test/ladderBacktest.test.ts`, extend the same top import once more to add `optimizeLadder`:

```ts
import { buildLadderTrades, computeLadderMetrics, optimizeLadder, DEFAULT_LADDER_CONFIG, type LadderConfig, type LadderTrade } from '@/lib/ladderBacktest';
```

Then append to the bottom of the file:

```ts
// A deterministic rng: cycles through two fixed fractions so every random candidate this
// generates is identical (2 rng() calls per rung: distance fraction, then multiplier fraction).
function fixedRng(distanceFraction: number, multiplierFraction: number) {
  let i = 0;
  const seq = [distanceFraction, multiplierFraction];
  return () => seq[i++ % seq.length];
}

function manyRowsForSignal(hm: string, outcome: 'UP' | 'DOWN', crashTo: number | null, slug: string) {
  const rows = [row({ hm, slug })];
  if (crashTo != null) {
    const [h, m] = hm.split(':');
    const laterM = String(Number(m) + 5).padStart(2, '0');
    rows.push(row({ hm: `${h}:${laterM}`, up_1h_num: crashTo, slug }));
  }
  return rows.map((r) => ({ ...r, market_outcome: outcome }));
}

describe('optimizeLadder', () => {
  it('falls back to the starting config when train data has too few resolved trades', async () => {
    // Only 2 trades total, both dated before the split -> train has 2 resolved, well under the default 30 minimum.
    const rows = [
      ...manyRowsForSignal('04:10', 'UP', 60, 'bitcoin-up-or-down-september-26-2026-4am-et'),
      ...manyRowsForSignal('05:10', 'UP', 60, 'bitcoin-up-or-down-september-26-2026-5am-et'),
    ];
    const base = buildTrades(rows, cfg());
    const starting = ladderCfg([{ distanceCents: 15, sizeMultiplier: 0.5 }]);
    const result = await optimizeLadder(base, rows, 10, '2026-09-27', starting, { iterations: 20, rng: fixedRng(0.5, 0.5) });
    expect(result.config).toEqual(starting);
    expect(result.cancelled).toBe(false);
  });

  it('finds a better config and computes holdout strictly from trades on/after the split date', async () => {
    // Every market crashes from 0.80 to 0.50 shortly after the signal and resolves UP (a win).
    // 20 distinct markets/hours on each of two train days (40 total, both before the split),
    // plus 10 distinct markets on one holdout day (on/after the split). Each market gets its own
    // et_time/timestamp/slug passed directly — row()'s ...p spread lets these override its
    // hardcoded-date defaults, so there is no risk of two markets colliding on the same key.
    function winningMarket(date: string, hour: number): SnapshotRow[] {
      const hh = String(hour).padStart(2, '0');
      const utcHour = String((hour + 4) % 24).padStart(2, '0');
      const slug = `bitcoin-up-or-down-${date}-${hh}h-et`;
      return [
        row({ hm: `${hh}:10`, et_time: `${date} ${hh}:10:00 ET`, timestamp: `${date}T${utcHour}:10:00.000Z`, slug, market_outcome: 'UP' }),
        row({ hm: `${hh}:20`, et_time: `${date} ${hh}:20:00 ET`, timestamp: `${date}T${utcHour}:20:00.000Z`, slug, up_1h_num: 50, market_outcome: 'UP' }),
      ];
    }
    const rows = [
      ...Array.from({ length: 20 }, (_, h) => winningMarket('2026-09-01', h)).flat(),
      ...Array.from({ length: 20 }, (_, h) => winningMarket('2026-09-02', h)).flat(),
      ...Array.from({ length: 10 }, (_, h) => winningMarket('2026-09-05', h)).flat(),
    ];
    const base = buildTrades(rows, cfg());
    const starting = ladderCfg([{ distanceCents: 50, sizeMultiplier: 0.01 }]); // its rung needs price <=0.30, the crash only reaches 0.50 -> never fills
    // fixedRng always draws distanceCents=15, sizeMultiplier=0.5 (inverting the implementation's snap() step):
    // 15 = 5 + f*(80-5) -> f = 10/75; 0.5 = 0.05 + f*(1-0.05) -> f = 0.45/0.95.
    const rng = fixedRng(10 / 75, 0.45 / 0.95);
    const result = await optimizeLadder(base, rows, 10, '2026-09-03', starting, { iterations: 50, rng });
    expect(result.config.rungs[0].distanceCents).toBeCloseTo(15);
    expect(result.config.rungs[0].sizeMultiplier).toBeCloseTo(0.5);
    expect(result.trainMetrics.resolved).toBe(40);
    expect(result.holdoutMetrics.trades).toBe(10);
    // starting config never fills its rung, so its train ROI is a fixed ~0.25 (2.5 pnl / 10 stake per trade);
    // the found config fills a profitable rung and should clear that by a comfortable margin.
    expect(result.trainMetrics.roi).toBeGreaterThan(0.3);
  });

  it('stops early and reports cancelled when shouldCancel returns true', async () => {
    const rows = manyRowsForSignal('04:10', 'UP', 60, 'bitcoin-up-or-down-september-26-2026-4am-et');
    const base = buildTrades(rows, cfg());
    const result = await optimizeLadder(base, rows, 10, '2026-09-27', DEFAULT_LADDER_CONFIG, { iterations: 500 }, () => true);
    expect(result.cancelled).toBe(true);
    expect(result.triedCount).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/ladderBacktest.test.ts`
Expected: FAIL — `optimizeLadder` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/ladderBacktest.ts` (add `MIN_RESOLVED_FOR_VERDICT` to the existing import from `./signalAnalysis`):

```ts
export interface OptimizerOptions {
  rangeCents?: [number, number];
  rangeMultiplier?: [number, number];
  iterations?: number;
  minTrainResolved?: number;
  rng?: () => number; // injectable for deterministic tests; defaults to Math.random
}

export interface OptimizerResult {
  config: LadderConfig;
  trainMetrics: LadderMetrics;
  holdoutMetrics: LadderMetrics;
  triedCount: number;
  cancelled: boolean;
}

const STEP_CENTS = 5;
const STEP_MULT = 0.05;

function snap(value: number, step: number, min: number, max: number): number {
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(2))));
}

function randomConfig(
  rungCount: number,
  rangeCents: [number, number],
  rangeMultiplier: [number, number],
  rng: () => number,
): LadderConfig {
  const rungs: LadderRung[] = [];
  for (let i = 0; i < rungCount; i++) {
    const distanceCents = snap(rangeCents[0] + rng() * (rangeCents[1] - rangeCents[0]), STEP_CENTS, rangeCents[0], rangeCents[1]);
    const sizeMultiplier = snap(rangeMultiplier[0] + rng() * (rangeMultiplier[1] - rangeMultiplier[0]), STEP_MULT, rangeMultiplier[0], rangeMultiplier[1]);
    rungs.push({ distanceCents, sizeMultiplier });
  }
  return { rungs };
}

export async function optimizeLadder(
  baseTrades: Trade[],
  allRows: SnapshotRow[],
  baseStake: number,
  splitDate: string,
  startingConfig: LadderConfig = DEFAULT_LADDER_CONFIG,
  opts: OptimizerOptions = {},
  shouldCancel?: () => boolean,
): Promise<OptimizerResult> {
  const rangeCents = opts.rangeCents ?? [5, 80];
  const rangeMultiplier = opts.rangeMultiplier ?? [0.05, 1];
  const iterations = opts.iterations ?? 2000;
  const minTrainResolved = opts.minTrainResolved ?? MIN_RESOLVED_FOR_VERDICT;
  const rng = opts.rng ?? Math.random;
  const rungCount = startingConfig.rungs.length;
  const CHUNK = 100;

  const train = baseTrades.filter((t) => t.date < splitDate);
  const holdout = baseTrades.filter((t) => t.date >= splitDate);

  let bestConfig = startingConfig;
  let bestRoi = computeLadderMetrics(buildLadderTrades(train, allRows, startingConfig, baseStake)).roi ?? -Infinity;
  let triedCount = 1;
  let cancelled = false;

  for (let i = 1; i < iterations; i++) {
    const candidate = randomConfig(rungCount, rangeCents, rangeMultiplier, rng);
    const m = computeLadderMetrics(buildLadderTrades(train, allRows, candidate, baseStake));
    triedCount++;
    if (m.resolved >= minTrainResolved && m.roi != null && m.roi > bestRoi) {
      bestRoi = m.roi;
      bestConfig = candidate;
    }
    if (i % CHUNK === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (shouldCancel?.()) {
        cancelled = true;
        break;
      }
    }
  }

  return {
    config: bestConfig,
    trainMetrics: computeLadderMetrics(buildLadderTrades(train, allRows, bestConfig, baseStake)),
    holdoutMetrics: computeLadderMetrics(buildLadderTrades(holdout, allRows, bestConfig, baseStake)),
    triedCount,
    cancelled,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/ladderBacktest.test.ts`
Expected: PASS, all tests green (this file now has the full Task 1–3 suite).

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; full suite green (130 pre-existing + this file's tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ladderBacktest.ts test/ladderBacktest.test.ts
git commit -m "feat(cloud-analysis): add train/holdout optimizer for ladder distances and sizes"
```

---

### Task 4: UI panel, wiring, and verification

**Files:**
- Create: `src/components/cloud-analysis/LadderPanel.tsx`
- Modify: `src/app/cloud-analysis/page.tsx`

**Interfaces:**
- Consumes: `buildLadderTrades`, `computeLadderMetrics`, `optimizeLadder`, `DEFAULT_LADDER_CONFIG`, `LadderConfig`, `LadderRung` from `src/lib/ladderBacktest.ts` (Tasks 1–3); `SnapshotRow`, `Trade` types from `src/lib/signalAnalysis.ts`.
- Produces: `LadderPanel` React component, rendered by `/cloud-analysis`.

This task has no new unit tests (it is a UI wiring task); it is verified by typecheck, the existing suite staying green, and a manual Playwright check.

- [ ] **Step 1: Create the panel component**

Create `src/components/cloud-analysis/LadderPanel.tsx`:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import {
  DEFAULT_LADDER_CONFIG,
  buildLadderTrades,
  computeLadderMetrics,
  optimizeLadder,
  type LadderConfig,
  type LadderRung,
  type OptimizerResult,
} from "@/lib/ladderBacktest";
import type { SnapshotRow, Trade } from "@/lib/signalAnalysis";

const pct = (x: number | null | undefined, d = 1) => (x == null || isNaN(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const money = (x: number | null | undefined) =>
  x == null || isNaN(x) ? "—" : `${x < 0 ? "−" : x > 0 ? "+" : ""}$${Math.abs(x).toFixed(2)}`;

const cardCls = "rounded-2xl border border-white/[0.08] bg-[#181a1e]/80 p-4";
const inputCls =
  "w-full bg-[#0f1013] text-[#e8e8e4] border border-white/[0.12] rounded-lg px-2 py-1.5 text-[12px] font-mono focus:outline-none focus:border-[#8ea4e8]";
const btnCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-white/[0.12] bg-white/[0.04] text-[#e8e8e4] hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed";
const kpiCls = "rounded-xl border border-white/[0.07] bg-[#131418] px-3 py-2.5";

export function LadderPanel({
  rows,
  baseTrades,
  stake,
  effectiveSplit,
}: {
  rows: SnapshotRow[];
  baseTrades: Trade[];
  stake: number;
  effectiveSplit: string | null;
}) {
  const [config, setConfig] = useState<LadderConfig>(DEFAULT_LADDER_CONFIG);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const cancelRef = useRef(false);

  const ladderTrades = useMemo(() => buildLadderTrades(baseTrades, rows, config, stake), [baseTrades, rows, config, stake]);
  const metrics = useMemo(() => computeLadderMetrics(ladderTrades), [ladderTrades]);

  const setRung = (i: number, patch: Partial<LadderRung>) =>
    setConfig((p) => ({ rungs: p.rungs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));

  const runOptimizer = async () => {
    if (!effectiveSplit) return;
    setRunning(true);
    setProgress(0);
    cancelRef.current = false;
    const r = await optimizeLadder(baseTrades, rows, stake, effectiveSplit, config, {}, () => cancelRef.current);
    setResult(r);
    setProgress(r.triedCount);
    setRunning(false);
  };

  const overfitWarning =
    result &&
    result.trainMetrics.roi != null &&
    result.holdoutMetrics.roi != null &&
    result.holdoutMetrics.roi < result.trainMetrics.roi - 0.1;

  return (
    <section className={cardCls}>
      <div className="mb-3">
        <h2 className="text-[14px] font-semibold text-[#e8e8e4]">Ladder backtest</h2>
        <p className="text-[12px] text-[#9a9ca3] mt-0.5">
          Base order (1x) at the signal price, plus extra orders further down if the price actually gets there.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-2 mb-3">
        {config.rungs.map((r, i) => (
          <div key={i} className={`${kpiCls} space-y-1.5`}>
            <div className="text-[11px] text-[#9a9ca3]">Rung {i + 1}</div>
            <label className="block text-[10px] text-[#73757c]">
              Distance (¢ below entry)
              <input
                type="number"
                className={`${inputCls} mt-0.5`}
                value={r.distanceCents}
                min={0}
                onChange={(e) => setRung(i, { distanceCents: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
            </label>
            <label className="block text-[10px] text-[#73757c]">
              Size (x base stake)
              <input
                type="number"
                className={`${inputCls} mt-0.5`}
                value={r.sizeMultiplier}
                step={0.05}
                min={0}
                onChange={(e) => setRung(i, { sizeMultiplier: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
            </label>
            <div className="text-[11px] text-[#73757c]">filled in {pct(metrics.fillRateByRung[i] ?? null, 0)} of trades</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className={kpiCls}>
          <div className="text-[11px] text-[#9a9ca3]">Trades</div>
          <div className="text-[18px] font-semibold font-mono mt-0.5 text-[#e8e8e4]">{metrics.trades}</div>
        </div>
        <div className={kpiCls}>
          <div className="text-[11px] text-[#9a9ca3]">Win rate</div>
          <div className="text-[18px] font-semibold font-mono mt-0.5 text-[#e8e8e4]">{pct(metrics.winRate)}</div>
        </div>
        <div className={kpiCls}>
          <div className="text-[11px] text-[#9a9ca3]">ROI</div>
          <div className="text-[18px] font-semibold font-mono mt-0.5 text-[#e8e8e4]">{pct(metrics.roi)}</div>
        </div>
        <div className={kpiCls}>
          <div className="text-[11px] text-[#9a9ca3]">P&amp;L</div>
          <div className="text-[18px] font-semibold font-mono mt-0.5 text-[#e8e8e4]">{money(metrics.pnl)}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className={btnCls} disabled={running || !effectiveSplit} onClick={runOptimizer}>
          {running ? `Searching… (${progress})` : "Optimize"}
        </button>
        {running && (
          <button
            type="button"
            className={btnCls}
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            Cancel
          </button>
        )}
        {!effectiveSplit && <span className="text-[11px] text-[#73757c]">Pick a walk-forward split date above first.</span>}
      </div>

      {result && (
        <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
          <div className="text-[11px] text-[#9a9ca3]">
            Best of {result.triedCount} tried{result.cancelled ? " (cancelled early)" : ""}: train ROI {pct(result.trainMetrics.roi)}, holdout ROI{" "}
            {pct(result.holdoutMetrics.roi)}
            {overfitWarning && <span className="text-[#e5787f]"> — holdout is much worse than train, likely overfit.</span>}
          </div>
          <div className="text-[11px] text-[#73757c] font-mono">
            {result.config.rungs.map((r, i) => `rung${i + 1}: ${r.distanceCents}¢ @ ${r.sizeMultiplier}x`).join(" · ")}
          </div>
          <button type="button" className={btnCls} onClick={() => setConfig(result.config)}>
            Apply this config
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire it into the page**

In `src/app/cloud-analysis/page.tsx`, add the import next to the other local imports (after the `@/lib/signalAnalysis` import block):

```ts
import { LadderPanel } from "@/components/cloud-analysis/LadderPanel";
```

Then find the "Walk-forward check" `<Card>` block (it renders `walkForward` and the `effectiveSplit` `<select>`). Immediately after its closing `</Card>`, and before the next `<Card title="Breakdown" ...>`, insert:

```tsx
              <LadderPanel rows={rows} baseTrades={trades} stake={cfg.stake} effectiveSplit={effectiveSplit} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: every test passes (all pre-existing tests plus `test/ladderBacktest.test.ts`), none of `signalAnalysis.test.ts`'s tests changed or broke.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: build succeeds with no type or lint errors from the new files.

- [ ] **Step 6: Manual verification**

With the dev server running (`npm run dev` or the existing `npm run supervisor`), open `/cloud-analysis` in a browser (or via the Playwright MCP tools) and confirm:
- The new "Ladder backtest" card renders below "Walk-forward check" with the three default rungs (15¢/0.5x, 30¢/0.35x, 50¢/0.2x) and live KPI values.
- Editing a rung's distance or size updates the KPI values and fill-rate lines without a page reload.
- Clicking "Optimize" (with a walk-forward split date selected) shows a progress state, then a result with train/holdout ROI and an "Apply this config" button that updates the rung inputs when clicked.
- No console errors during any of the above.

- [ ] **Step 7: Commit**

```bash
git add src/components/cloud-analysis/LadderPanel.tsx src/app/cloud-analysis/page.tsx
git commit -m "feat(cloud-analysis): add Ladder Backtest panel with live metrics and optimizer"
```

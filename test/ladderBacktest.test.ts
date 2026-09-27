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

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

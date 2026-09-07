export interface UserStats {
  wallet: string;
  name?: string;
  pseudonym?: string;
  first_seen: number;
  last_active: number;
  trade_count: number;
  total_notional: number;
  max_single_bet: number;
  avg_bet: number;
  buys: number;
  sells: number;
  markets_distinct: number;
}

export function computeUpdatedStats(existingUser: UserStats | null, trade: any, newMarketsDistinct: number): UserStats {
  const notional = trade.size * trade.price;
  const isBuy = trade.side === 'BUY';
  const isSell = trade.side === 'SELL';
  
  if (!existingUser) {
    return {
      wallet: trade.proxyWallet,
      name: trade.name || '',
      pseudonym: trade.pseudonym || '',
      first_seen: trade.timestamp,
      last_active: trade.timestamp,
      trade_count: 1,
      total_notional: notional,
      max_single_bet: notional,
      avg_bet: notional,
      buys: isBuy ? 1 : 0,
      sells: isSell ? 1 : 0,
      markets_distinct: newMarketsDistinct
    };
  }

  const newTradeCount = existingUser.trade_count + 1;
  const newTotalNotional = existingUser.total_notional + notional;
  const newMaxSingleBet = Math.max(existingUser.max_single_bet, notional);
  const newAvgBet = newTotalNotional / newTradeCount;
  const newFirstSeen = Math.min(existingUser.first_seen, trade.timestamp);
  const newLastActive = Math.max(existingUser.last_active, trade.timestamp);

  return {
    ...existingUser,
    name: trade.name || existingUser.name,
    pseudonym: trade.pseudonym || existingUser.pseudonym,
    first_seen: newFirstSeen,
    last_active: newLastActive,
    trade_count: newTradeCount,
    total_notional: newTotalNotional,
    max_single_bet: newMaxSingleBet,
    avg_bet: newAvgBet,
    buys: existingUser.buys + (isBuy ? 1 : 0),
    sells: existingUser.sells + (isSell ? 1 : 0),
    markets_distinct: newMarketsDistinct,
  };
}

export function isNewUser(first_seen: number, now: number = Math.floor(Date.now() / 1000), thresholdDays: number = 7): boolean {
  const thresholdSeconds = thresholdDays * 24 * 60 * 60;
  return (now - first_seen) <= thresholdSeconds;
}

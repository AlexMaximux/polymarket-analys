import { describe, it, expect } from 'vitest';
import { computeUpdatedStats, isNewUser, UserStats } from '../src/lib/stats';

describe('stats computation', () => {
  it('should initialize a new user correctly', () => {
    const trade = {
      proxyWallet: '0x123',
      side: 'BUY',
      size: 10,
      price: 0.5,
      timestamp: 1000,
      name: 'Alice',
      pseudonym: 'A1'
    };
    const stats = computeUpdatedStats(null, trade, 1);
    
    expect(stats.wallet).toBe('0x123');
    expect(stats.name).toBe('Alice');
    expect(stats.trade_count).toBe(1);
    expect(stats.total_notional).toBe(5); // 10 * 0.5
    expect(stats.max_single_bet).toBe(5);
    expect(stats.avg_bet).toBe(5);
    expect(stats.buys).toBe(1);
    expect(stats.sells).toBe(0);
    expect(stats.first_seen).toBe(1000);
    expect(stats.markets_distinct).toBe(1);
  });

  it('should update an existing user correctly', () => {
    const existing: UserStats = {
      wallet: '0x123',
      name: 'Alice',
      pseudonym: 'A1',
      first_seen: 1000,
      last_active: 1000,
      trade_count: 1,
      total_notional: 5,
      max_single_bet: 5,
      avg_bet: 5,
      buys: 1,
      sells: 0,
      markets_distinct: 1
    };

    const trade = {
      proxyWallet: '0x123',
      side: 'SELL',
      size: 20,
      price: 0.8,
      timestamp: 2000,
      name: 'Alice',
    };
    
    const stats = computeUpdatedStats(existing, trade, 2);
    
    expect(stats.trade_count).toBe(2);
    expect(stats.total_notional).toBe(21); // 5 + (20*0.8) = 21
    expect(stats.max_single_bet).toBe(16); // max(5, 16)
    expect(stats.avg_bet).toBe(10.5); // 21 / 2
    expect(stats.buys).toBe(1);
    expect(stats.sells).toBe(1);
    expect(stats.first_seen).toBe(1000);
    expect(stats.last_active).toBe(2000);
    expect(stats.markets_distinct).toBe(2);
  });
  
  it('should identify new users correctly', () => {
    const now = 1000000;
    const oneDay = 24 * 60 * 60;
    
    expect(isNewUser(now - oneDay, now, 7)).toBe(true);
    expect(isNewUser(now - 10 * oneDay, now, 7)).toBe(false);
  });
});

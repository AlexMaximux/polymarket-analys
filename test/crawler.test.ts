import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { processTrades } from '../src/lib/crawler';
import * as dbModule from '../src/lib/db';
import Database from 'better-sqlite3';

describe('crawler and dedupe', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db);
    dbModule.initializeDb(db); // Create schema explicitly in the in-memory db
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should dedupe trades correctly', () => {
    const trade1 = {
      proxyWallet: '0xabc',
      side: 'BUY',
      size: 10,
      price: 0.5,
      timestamp: 1000,
      title: 'T1',
      slug: 't1',
      conditionId: 'c1',
      outcome: 'Yes',
      transactionHash: 'hash1',
      asset: 'a1'
    };

    const inserted1 = processTrades([trade1]);
    expect(inserted1).toBe(1);

    const inserted2 = processTrades([trade1]);
    expect(inserted2).toBe(0);

    const trade2 = { ...trade1, side: 'SELL' };
    const inserted3 = processTrades([trade2]);
    expect(inserted3).toBe(1);
    
    const user = db.prepare('SELECT * FROM users WHERE wallet = ?').get('0xabc') as any;
    expect(user.trade_count).toBe(2);
    expect(user.buys).toBe(1);
    expect(user.sells).toBe(1);
  });
});

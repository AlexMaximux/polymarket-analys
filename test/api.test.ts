import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as getWallet } from '../src/app/api/users/[wallet]/route';
import { GET as getUsers } from '../src/app/api/users/route';
import * as dbModule from '../src/lib/db';
import Database from 'better-sqlite3';

describe('leaderboard fallback and minTrades filter', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db);
    dbModule.initializeDb(db);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('minTrades filter SQL builder test', async () => {
    // Insert some users
    db.prepare(`INSERT INTO users (wallet, name, trade_count, total_notional, first_seen, last_active, buys, sells, max_single_bet) VALUES ('0x1', 'A', 5, 100, 0, 0, 0, 0, 0)`).run();
    db.prepare(`INSERT INTO users (wallet, name, trade_count, total_notional, first_seen, last_active, buys, sells, max_single_bet) VALUES ('0x2', 'B', 1, 50, 0, 0, 0, 0, 0)`).run();

    const req = new Request('http://localhost/api/users?minTrades=3');
    const res = await getUsers(req);
    const data = await res.json();
    
    expect(data.data.length).toBe(1);
    expect(data.data[0].wallet).toBe('0x1');
  });

  it('leaderboard fallback logic', async () => {
    const mockedActivity = [
      { side: 'BUY', size: '10', price: '0.5', timestamp: new Date().toISOString(), title: 'T1' }
    ];
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('activity')) {
        return Promise.resolve(new Response(JSON.stringify(mockedActivity)));
      }
      return Promise.resolve(new Response(JSON.stringify([])));
    });

    const req = new Request('http://localhost/api/users/0xunknown');
    const res = await getWallet(req, { params: Promise.resolve({ wallet: '0xunknown' }) });
    const data = await res.json();

    expect(data.isLiveFallback).toBe(true);
    expect(data.trades.length).toBe(1);
    expect(data.user.wallet).toBe('0xunknown');
    expect(data.user.trade_count).toBe(1);

    // Should have been inserted into DB
    const dbUser = db.prepare('SELECT * FROM users WHERE wallet = ?').get('0xunknown');
    expect(dbUser).toBeDefined();
  });
});

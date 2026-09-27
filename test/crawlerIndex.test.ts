import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDb } from '../src/lib/db';

// The crawler runs this count once per new trade inside its write transaction. Without a covering
// index it reads every trade row of the wallet (79k for the busiest bot), holding the SQLite write
// lock for minutes and starving the alerts and jev workers (SQLITE_BUSY).
describe('trades indexes', () => {
  it("counts a wallet's distinct markets from the index alone", () => {
    const db = new Database(':memory:');
    initializeDb(db);
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT COUNT(DISTINCT conditionId) as count FROM trades WHERE proxyWallet = ?`)
      .all('0x1') as { detail: string }[];
    expect(plan.map(p => p.detail).join(' | ')).toMatch(/COVERING INDEX/);
  });
});

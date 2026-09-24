import { getDb, initializeDb } from './db';
import { computeUpdatedStats, UserStats } from './stats';

export async function fetchTrades(limit = 100) {
  const url = `https://data-api.polymarket.com/trades?limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Trades API error: ${res.status}`);
  return await res.json();
}

export function processTrades(trades: any[]) {
  const db = getDb();
  let newTradesCount = 0;

  // Process from oldest to newest to maintain correct stats accumulation
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  const insertTradeStmt = db.prepare(`
    INSERT INTO trades (
      proxyWallet, side, size, price, timestamp, title, slug, conditionId, outcome, name, pseudonym, transactionHash, asset, dedupe_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getUserStmt = db.prepare(`SELECT * FROM users WHERE wallet = ?`);
  const updateUserStmt = db.prepare(`
    INSERT INTO users (
      wallet, name, pseudonym, first_seen, last_active, trade_count, total_notional, max_single_bet, avg_bet, buys, sells, markets_distinct
    ) VALUES (
      @wallet, @name, @pseudonym, @first_seen, @last_active, @trade_count, @total_notional, @max_single_bet, @avg_bet, @buys, @sells, @markets_distinct
    ) ON CONFLICT(wallet) DO UPDATE SET
      name = excluded.name,
      pseudonym = excluded.pseudonym,
      first_seen = excluded.first_seen,
      last_active = excluded.last_active,
      trade_count = excluded.trade_count,
      total_notional = excluded.total_notional,
      max_single_bet = excluded.max_single_bet,
      avg_bet = excluded.avg_bet,
      buys = excluded.buys,
      sells = excluded.sells,
      markets_distinct = excluded.markets_distinct
  `);
  
  const getMarketsCountStmt = db.prepare(`SELECT COUNT(DISTINCT conditionId) as count FROM trades WHERE proxyWallet = ?`);

  const runTransaction = db.transaction((trades) => {
    for (const trade of trades) {
      // Only real trades: the global feed sometimes carries REDEEM/rebate rows with side='' & price=0
      // which poison user aggregates (seen with wallet 0x78becf0a... — 141 junk rows).
      if (trade.side !== 'BUY' && trade.side !== 'SELL') continue;
      const dedupe_id = `${trade.transactionHash}-${trade.conditionId}-${trade.timestamp}-${trade.size}-${trade.price}-${trade.side}`;
      
      try {
        insertTradeStmt.run(
          trade.proxyWallet, trade.side, trade.size, trade.price, trade.timestamp, 
          trade.title, trade.slug, trade.conditionId, trade.outcome, 
          trade.name, trade.pseudonym, trade.transactionHash, trade.asset, dedupe_id
        );
        newTradesCount++;

        const existingUser = getUserStmt.get(trade.proxyWallet) as UserStats | null;
        const marketsRes = getMarketsCountStmt.get(trade.proxyWallet) as {count: number};
        
        const newStats = computeUpdatedStats(existingUser, trade, marketsRes.count);
        updateUserStmt.run(newStats);

      } catch (err: any) {
        if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
          console.error("Error inserting trade:", err);
          throw err;
        }
        // It's a duplicate trade, ignore
      }
    }
  });

  runTransaction(sortedTrades);
  return newTradesCount;
}

export async function runCrawlPhase(limit = 100) {
  initializeDb();
  const trades = await fetchTrades(limit);
  const count = processTrades(trades);
  return { fetched: trades.length, inserted: count };
}

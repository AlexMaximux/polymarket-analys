import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

export function getDb() {
  if (db) return db;

  const dbPath = path.join(process.cwd(), 'polymarket.db');
  db = new Database(dbPath, {
    // verbose: console.log
  });

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = OFF'); // Disable to allow inserting trades before users in the same loop if needed

  return db;
}

export function initializeDb(dbInstance?: Database.Database) {
  const db = dbInstance || getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      wallet TEXT PRIMARY KEY,
      name TEXT,
      pseudonym TEXT,
      first_seen INTEGER,
      last_active INTEGER,
      trade_count INTEGER DEFAULT 0,
      total_notional REAL DEFAULT 0,
      max_single_bet REAL DEFAULT 0,
      avg_bet REAL DEFAULT 0,
      buys INTEGER DEFAULT 0,
      sells INTEGER DEFAULT 0,
      markets_distinct INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxyWallet TEXT,
      side TEXT,
      size REAL,
      price REAL,
      timestamp INTEGER,
      title TEXT,
      slug TEXT,
      conditionId TEXT,
      outcome TEXT,
      name TEXT,
      pseudonym TEXT,
      transactionHash TEXT,
      asset TEXT,
      dedupe_id TEXT UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_users_first_seen ON users(first_seen);
    CREATE INDEX IF NOT EXISTS idx_users_total_notional ON users(total_notional);
    CREATE INDEX IF NOT EXISTS idx_users_trade_count ON users(trade_count);
    CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(proxyWallet);
  `);
}

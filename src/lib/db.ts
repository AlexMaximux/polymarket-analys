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

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hours INTEGER NOT NULL DEFAULT 24,
      min_bet REAL NOT NULL DEFAULT 1000,
      telegram_token TEXT NOT NULL,
      telegram_chat TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_fired_at INTEGER,
      last_evaluated_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_seen (
      alert_id INTEGER NOT NULL,
      wallet TEXT NOT NULL,
      fired_at INTEGER NOT NULL,
      first_trade_at INTEGER,
      PRIMARY KEY (alert_id, wallet)
    );
  `);

  // Migration: true on-chain first-trade columns (crawler first_seen is only "first time WE saw them")
  try {
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('true_first_trade_at')) {
      db.exec(`ALTER TABLE users ADD COLUMN true_first_trade_at INTEGER`);
      db.exec(`ALTER TABLE users ADD COLUMN true_first_trade_size REAL`);
      db.exec(`ALTER TABLE users ADD COLUMN true_first_checked_at INTEGER`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_users_true_first ON users(true_first_trade_at)`);
    }
  } catch {
    // another process (dev server / crawler / backfill) may have migrated concurrently — safe to ignore
  }

  // Migration: starred wallets + starred_open alerts (watchlist position alerts)
  try {
    const ucols = new Set((db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map(c => c.name));
    if (!ucols.has('starred')) {
      db.exec(`ALTER TABLE users ADD COLUMN starred INTEGER DEFAULT 0`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_users_starred ON users(starred)`);
    }
    const acols = new Set((db.prepare(`PRAGMA table_info(alerts)`).all() as { name: string }[]).map(c => c.name));
    if (!acols.has('alert_type')) {
      db.exec(`ALTER TABLE alerts ADD COLUMN alert_type TEXT NOT NULL DEFAULT 'new_whale'`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS alert_wallets (
        alert_id INTEGER NOT NULL,
        wallet TEXT NOT NULL,
        PRIMARY KEY (alert_id, wallet)
      );
      CREATE TABLE IF NOT EXISTS alert_pos_seen (
        alert_id INTEGER NOT NULL,
        wallet TEXT NOT NULL,
        condition_id TEXT NOT NULL,
        fired_at INTEGER NOT NULL,
        PRIMARY KEY (alert_id, wallet, condition_id)
      );
    `);
  } catch {
    // concurrent migration — safe to ignore
  }
}

import { getDb } from './db';

/**
 * True first-trade backfill.
 *
 * Polymarket does not expose an account-creation date. The only reliable way to know
 * when a wallet ACTUALLY placed its first bet is to page through its on-chain activity
 * history (newest -> oldest) until the earliest TRADE row is found.
 *
 * Crawler `first_seen` only means "first time OUR crawler saw this wallet" — useless
 * for new-user detection. `true_first_trade_at` is the real thing.
 */

const PAGE = 500;
const ACTIVITY_URL = 'https://data-api.polymarket.com/activity';

export interface TrueFirstResult {
  wallet: string;
  true_first_trade_at: number | null;
  true_first_trade_size: number | null;
  scanned: number;
}

function fetchPage(wallet: string, offset: number): Promise<any[]> {
  return fetch(`${ACTIVITY_URL}?user=${wallet}&limit=${PAGE}&offset=${offset}`).then(r => {
    if (!r.ok) throw new Error(`activity API ${r.status}`);
    return r.json();
  });
}

async function fetchPageRetry(wallet: string, offset: number, retries = 3): Promise<any[]> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchPage(wallet, offset);
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1))); // transient 400/5xx happen under load
    }
  }
  throw lastErr;
}

export async function fetchTrueFirstTrade(wallet: string, maxPages = 40): Promise<TrueFirstResult> {
  // Fast path: the API can sort ASC and filter type=TRADE, so the oldest trade is the FIRST row.
  try {
    const res = await fetch(`${ACTIVITY_URL}?user=${wallet}&limit=1&type=TRADE&sortBy=TIMESTAMP&sortDirection=ASC`);
    if (res.ok) {
      const rows: any[] = await res.json();
      if (Array.isArray(rows)) {
        if (rows.length === 0) {
          return { wallet, true_first_trade_at: null, true_first_trade_size: null, scanned: 0 };
        }
        const r = rows[0];
        const sz = r.usdcSize != null ? Number(r.usdcSize) : Number(r.size) * Number(r.price);
        return { wallet, true_first_trade_at: r.timestamp, true_first_trade_size: sz, scanned: 1 };
      }
    }
    // non-ok (e.g. 400) -> fall through to pagination
  } catch {
    // network hiccup -> fall through to pagination
  }

  // Fallback: page newest->oldest (offset drift possible, but better than nothing).
  let first: { ts: number; size: number } | null = null;
  let scanned = 0;

  for (let page = 0; page < maxPages; page++) {
    const rows: any[] = await fetchPageRetry(wallet, page * PAGE);
    if (!Array.isArray(rows) || rows.length === 0) break;
    scanned += rows.length;

    for (const a of rows) {
      if (a.type === 'TRADE' && a.timestamp) {
        const ts = a.timestamp as number;
        if (!first || ts < first.ts) {
          const sz = a.usdcSize != null ? Number(a.usdcSize) : Number(a.size) * Number(a.price);
          first = { ts, size: sz };
        }
      }
    }
    if (rows.length < PAGE) break; // reached the end of history
    await new Promise(r => setTimeout(r, 250)); // polite
  }

  return {
    wallet,
    true_first_trade_at: first ? first.ts : null,
    true_first_trade_size: first ? first.size : null,
    scanned,
  };
}

export function saveTrueFirst(r: TrueFirstResult): void {
  const db = getDb();
  db.prepare(
    `UPDATE users SET true_first_trade_at = ?, true_first_trade_size = ?, true_first_checked_at = ? WHERE wallet = ?`
  ).run(r.true_first_trade_at, r.true_first_trade_size, Math.floor(Date.now() / 1000), r.wallet);
}

/** Wallets that have a users row but no true-first data yet. Oldest crawler-first-seen first. */
export function pendingBackfillQueue(limit = 50): string[] {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT wallet FROM users
         WHERE true_first_checked_at IS NULL
         ORDER BY max_single_bet DESC, first_seen ASC
         LIMIT ?`
      )
      .all(limit) as { wallet: string }[]
  ).map(r => r.wallet);
}

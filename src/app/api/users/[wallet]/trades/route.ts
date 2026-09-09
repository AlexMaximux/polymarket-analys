import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/[wallet]/trades?limit=…&full=1
 *
 * Full trade history built from the PERSISTENT ledger cache (wallet_ledger_cache)
 * merged with fresh /activity pages. The data-api caps at 5500 rows; once a row is
 * cached here it stays — so repeated requests accumulate MORE history than any
 * single API call, exactly as requested ("اگر رکواست بعدی زدی اطلاعات قبلی رو داشته باشیم").
 *
 * Returns rows newest-first with title/slug/conditionId for search + deep links.
 */
export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 5000);

  const db = getDb();

  // ---- pull fresh pages and merge into cache (only the newest page usually changes) ----
  let fresh = 0;
  let oldestCachedTs = 0;
  try {
    oldestCachedTs = (db.prepare(
      `SELECT MIN(ts) m FROM wallet_ledger_cache WHERE wallet = ?`
    ).get(wallet.toLowerCase()) as any)?.m || 0;
  } catch { /* table may not exist yet on fresh DBs */ }

  try {
    let page = 0;
    while (page < 11) {
      const res = await fetch(
        `https://data-api.polymarket.com/activity?user=${wallet}&limit=500&offset=${page * 500}`
      );
      if (!res.ok) break;
      const chunk: any[] = await res.json();
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      if (page > 0) {
        // stop early when we've walked past what's already cached (page fully older than cache)
        const minTs = Math.min(...chunk.map((r: any) => r.timestamp || 0));
        if (oldestCachedTs && minTs < oldestCachedTs) { /* still insert; cache dedupes */ }
      }
      const ins = db.prepare(
        `INSERT OR IGNORE INTO wallet_ledger_cache (wallet, ts, type, side, size, usdc, price, title, slug, condition_id, outcome, tx_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const tx = db.transaction(() => {
        for (const r of chunk) {
          const r0 = ins.run(
            wallet.toLowerCase(), r.timestamp || 0, r.type || '', r.side || '',
            Number(r.size) || 0, Number(r.usdcSize) || 0, Number(r.price) || 0,
            r.title || '', r.slug || '', r.conditionId || '', r.outcome || '', r.transactionHash || ''
          );
          fresh += r0.changes;
        }
      });
      tx();
      if (chunk.length < 500) break;
      page++;
    }
  } catch { /* best-effort refresh */ }

  const rows = db.prepare(
    `SELECT ts, type, side, size, usdc, price, title, slug, condition_id AS conditionId, outcome, tx_hash AS transactionHash
     FROM wallet_ledger_cache WHERE wallet = ? ORDER BY ts DESC LIMIT ?`
  ).all(wallet.toLowerCase(), limit) as any[];

  return NextResponse.json({
    cachedTotal: (db.prepare(`SELECT COUNT(*) AS n FROM wallet_ledger_cache WHERE wallet = ?`).get(wallet.toLowerCase()) as any)?.n ?? 0,
    freshRows: fresh,
    totals: {
      count: rows.length,
      buys: rows.filter(r => r.type === 'TRADE' && r.side === 'BUY').length,
      sells: rows.filter(r => r.type === 'TRADE' && r.side === 'SELL').length,
      redeems: rows.filter(r => r.type === 'REDEEM').length,
    },
    trades: rows,
  });
}

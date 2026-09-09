import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const revalidate = 300; // Cache for 5 mins

/**
 * Live positions proxy, enhanced:
 *  - positions (live) / resolved (settled, hidden by the site)
 *  - each position carries entryCount = number of separate BUY entries in the ledger cache
 *  - keeps slug/eventSlug so the UI can deep-link to polymarket.com
 * Also PERSISTS every BUY trade seen into wallet_entries (grows across requests —
 * the activity API is capped at 5500 rows, the cache is not).
 */

export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const db = getDb();
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/positions?user=${wallet}&limit=500&sortBy=CURRENT&sortDirection=DESC`
    );
    if (!res.ok) throw new Error('Failed to fetch positions');
    const data: any[] = await res.json();
    const rows = Array.isArray(data) ? data : [];
    const positions = rows.filter(r => !r.redeemable);
    const resolved = rows.filter(r => !!r.redeemable);

    // ---- persist BUY entries into wallet_entries (cumulative ledger) ----
    let persisted = 0;
    try {
      let page = 0;
      while (page < 12) { // up to 6000 rows; capped by API anyway
        const aRes = await fetch(
          `https://data-api.polymarket.com/activity?user=${wallet}&type=TRADE&side=BUY&limit=500&offset=${page * 500}`
        );
        if (!aRes.ok) break;
        const chunk: any[] = await aRes.json();
        if (!Array.isArray(chunk) || chunk.length === 0) break;
        const ins = db.prepare(
          `INSERT OR IGNORE INTO wallet_entries (wallet, condition_id, title, slug, event_slug, outcome, ts, side, size, price, usdc, tx_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const tx = db.transaction(() => {
          for (const r of chunk) {
            const r0 = ins.run(
              wallet, r.conditionId || '', r.title || '', r.slug || '', r.eventSlug || r.slug || '',
              r.outcome || '', r.timestamp || 0, 'BUY', Number(r.size) || 0, Number(r.price) || 0,
              Number(r.usdcSize) || 0, r.transactionHash || ''
            );
            persisted += r0.changes;
          }
        });
        tx();
        if (chunk.length < 500) break;
        page++;
      }
    } catch { /* cache write best-effort */ }

    // ---- entry counts per conditionId (from the persistent cache) ----
    const counts = new Map<string, { n: number; firstTs: number; lastTs: number; usd: number }>();
    const cRows = db.prepare(
      `SELECT condition_id, COUNT(*) n, MIN(ts) firstTs, MAX(ts) lastTs, SUM(usdc) usd
       FROM wallet_entries WHERE wallet = ? GROUP BY condition_id`
    ).all(wallet) as any[];
    for (const r of cRows) counts.set(r.condition_id, { n: r.n, firstTs: r.firstTs, lastTs: r.lastTs, usd: r.usd });

    const decorate = (list: any[]) => list.map(p => {
      const c = counts.get(p.conditionId) || { n: 0, firstTs: 0, lastTs: 0, usd: 0 };
      return { ...p, entryCount: c.n, entryFirstTs: c.firstTs, entryLastTs: c.lastTs, entryUsd: Math.round(c.usd) };
    });

    return NextResponse.json({
      positions: decorate(positions),
      resolved: decorate(resolved),
      persistedNew: persisted,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 500 });
  }
}

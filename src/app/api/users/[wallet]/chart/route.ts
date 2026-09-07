import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildChartSeries } from '@/lib/chart';

export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const db = getDb();
  
  let trades = db.prepare('SELECT * FROM trades WHERE proxyWallet = ? ORDER BY timestamp ASC').all(wallet) as any[];
  
  if (trades.length === 0) {
    try {
      const res = await fetch(`https://data-api.polymarket.com/activity?user=${wallet}&limit=500`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data)) {
          const insertStmt = db.prepare(`
            INSERT INTO trades (proxyWallet, side, size, price, timestamp, title, slug, conditionId, outcome, name, pseudonym, transactionHash, asset, dedupe_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(dedupe_id) DO NOTHING
          `);
          db.transaction((items) => {
            for (const item of items) {
               insertStmt.run(
                 wallet, item.side, item.size, item.price, item.timestamp, item.title, item.slug,
                 item.conditionId, item.outcome, item.name, item.pseudonym, item.transactionHash, item.asset, item.id
               );
            }
          })(data);
          trades = db.prepare('SELECT * FROM trades WHERE proxyWallet = ? ORDER BY timestamp ASC').all(wallet) as any[];
        }
      }
    } catch (e) {
      console.error('Fetch error:', e);
    }
  }

  // Compute daily series
  const series = buildChartSeries(trades);

  return NextResponse.json({
    series,
    generatedAt: new Date().toISOString()
  });
}

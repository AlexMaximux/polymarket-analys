import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/[wallet]/entries?conditionId=0x..
 * Returns every persisted BUY entry for one market (the drill-down behind
 * the "entries" count on Current Positions). Sourced from wallet_entries —
 * the persistent ledger that survives API truncation.
 */
export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const { searchParams } = new URL(request.url);
  const conditionId = searchParams.get('conditionId') || '';
  if (!conditionId) return NextResponse.json({ error: 'conditionId required' }, { status: 400 });

  const db = getDb();
  const rows = db.prepare(
    `SELECT ts, size, price, usdc, tx_hash FROM wallet_entries
     WHERE wallet = ? AND condition_id = ? ORDER BY ts ASC`
  ).all(wallet.toLowerCase(), conditionId) as any[];

  return NextResponse.json({
    count: rows.length,
    totalUsd: rows.reduce((s, r) => s + (r.usdc || 0), 0),
    entries: rows.map(r => ({
      ts: r.ts, size: r.size, price: r.price, usdc: r.usdc, txHash: r.tx_hash,
    })),
  });
}

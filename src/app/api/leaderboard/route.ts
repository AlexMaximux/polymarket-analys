import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/leaderboard?window=1d|1w|1m|all
 * Polymarket leaderboard (top 100 by volume) enriched with local last_active
 * from the crawler DB (users table) for the Last Active column.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const window = searchParams.get('window') || '1w';

  try {
    const res = await fetch(`https://data-api.polymarket.com/v1/leaderboard?window=${window}&limit=100`);
    if (!res.ok) throw new Error('Failed to fetch from Polymarket');
    const data: any[] = await res.json();

    // enrich with local last_active where known
    let lastActiveByWallet = new Map<string, number>();
    try {
      const db = getDb();
      const rows = db.prepare(`SELECT wallet, last_active FROM users WHERE last_active IS NOT NULL`).all() as any[];
      lastActiveByWallet = new Map(rows.map(r => [r.wallet, r.last_active]));
    } catch { /* db unavailable — skip enrichment */ }

    const enriched = (Array.isArray(data) ? data : []).map((r: any) => ({
      ...r,
      lastActive: lastActiveByWallet.get(String(r.proxyWallet || '').toLowerCase()) ?? null,
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json({ error: 'Leaderboard unavailable' }, { status: 500 });
  }
}

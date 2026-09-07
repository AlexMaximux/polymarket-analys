import { NextResponse } from 'next/server';

export const revalidate = 120; // cache 2 min

/**
 * FULL trade history straight from Polymarket's activity ledger —
 * unlike the crawler DB (which only holds trades our poller happened to witness),
 * this covers the wallet's entire history (up to 2000 latest rows) and is always current.
 */
export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 2000);

  try {
    const rows: any[] = [];
    for (let page = 0; page < 4; page++) {
      const res = await fetch(
        `https://data-api.polymarket.com/activity?user=${wallet}&type=TRADE&limit=500&offset=${page * 500}`,
        { next: { revalidate: 120 } }
      );
      if (!res.ok) throw new Error(`activity ${res.status}`);
      const chunk: any[] = await res.json();
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      rows.push(...chunk);
      if (chunk.length < 500) break;
    }

    const trades = rows
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit);

    const buyUsd = rows.reduce((s, t) => s + (t.side === 'BUY' ? Number(t.usdcSize) || 0 : 0), 0);
    const sellUsd = rows.reduce((s, t) => s + (t.side === 'SELL' ? Number(t.usdcSize) || 0 : 0), 0);

    return NextResponse.json({
      trades,
      totals: { count: rows.length, buyUsd, sellUsd, volume: buyUsd + sellUsd },
    });
  } catch (error) {
    return NextResponse.json({ trades: [], totals: { count: 0, buyUsd: 0, sellUsd: 0, volume: 0 }, error: 'trades fetch failed' }, { status: 502 });
  }
}

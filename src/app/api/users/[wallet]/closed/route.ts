import { NextResponse } from 'next/server';

export const revalidate = 300; // Cache for 5 mins

/**
 * SITE-STYLE closed positions history (like polymarket.com @user?tab=positions RESULT list).
 * The /positions endpoint only returns positions CURRENTLY HELD — anything exited via
 * SELL or REDEEM disappears from it. The site's history comes from replaying the full
 * activity ledger, which is what we do here:
 *
 *   per (market, outcome):
 *     invested = Σ BUY usdcSize
 *     returned = Σ SELL usdcSize + Σ REDEEM usdcSize
 *     pnl      = returned - invested            (= site's "AMOUNT WON")
 *     totalTraded = invested + returned         (= site's "TOTAL TRADED")
 *   closed when boughtShares - soldShares - redeemedShares <= 0
 */
export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
  const sort = searchParams.get('sort') || 'won'; // 'won' | 'recent'

  try {
    // fetch full activity ledger (paged)
    const rows: any[] = [];
    for (let page = 0; page < 8; page++) {
      const res = await fetch(
        `https://data-api.polymarket.com/activity?user=${wallet}&limit=500&offset=${page * 500}`,
        { next: { revalidate: 300 } }
      );
      if (!res.ok) throw new Error(`activity ${res.status}`);
      const chunk: any[] = await res.json();
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      rows.push(...chunk);
      if (chunk.length < 500) break;
    }

    // group per (market, outcome) — same granularity as the site's list
    const groups = new Map<string, any>();
    for (const a of rows) {
      if (a.type !== 'TRADE' && a.type !== 'REDEEM') continue;
      const key = `${a.conditionId}|${a.outcome ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          conditionId: a.conditionId,
          title: a.title,
          outcome: a.outcome,
          eventSlug: a.eventSlug || a.slug,
          boughtShares: 0, invested: 0,
          soldShares: 0, soldUsd: 0,
          redeemedShares: 0, redeemUsd: 0,
          lastTs: 0,
        };
        groups.set(key, g);
      }
      const sz = Number(a.size) || 0;
      const usd = Number(a.usdcSize) || 0;
      if (a.type === 'TRADE') {
        if (a.side === 'BUY') { g.boughtShares += sz; g.invested += usd; }
        else { g.soldShares += sz; g.soldUsd += usd; }
      } else {
        g.redeemedShares += sz; g.redeemUsd += usd;
      }
      g.lastTs = Math.max(g.lastTs, a.timestamp || 0);
    }

    const closed: any[] = [];
    for (const g of groups.values()) {
      const held = g.boughtShares - g.soldShares - g.redeemedShares;
      if (held > 0.5) continue; // still open (handled by /positions)
      g.returned = g.soldUsd + g.redeemUsd;
      g.pnl = g.returned - g.invested;
      g.totalTraded = g.invested + g.returned;
      g.won = g.pnl > 0.01;
      closed.push(g);
    }

    closed.sort((a, b) =>
      sort === 'recent' ? b.lastTs - a.lastTs : b.pnl - a.pnl
    );

    const totals = {
      invested: closed.reduce((s, g) => s + g.invested, 0),
      returned: closed.reduce((s, g) => s + g.returned, 0),
      pnl: closed.reduce((s, g) => s + g.pnl, 0),
      count: closed.length,
      wins: closed.filter(g => g.pnl > 0.01).length,
    };

    return NextResponse.json({ closed: closed.slice(0, limit), totals });
  } catch (error) {
    return NextResponse.json({ closed: [], totals: { invested: 0, returned: 0, pnl: 0, count: 0, wins: 0 }, error: 'closed fetch failed' }, { status: 502 });
  }
}

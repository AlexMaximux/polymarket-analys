import { NextResponse } from 'next/server';

export const revalidate = 300; // Cache for 5 mins

/**
 * SITE-SOURCE closed positions history — now backed by Polymarket's OWN
 * /closed-positions endpoint (the same source the polymarket.com profile
 * "RESULT" list uses), instead of replaying the activity ledger.
 *
 * Why: the /activity ledger is hard-capped at 5500 rows per wallet by the
 * data-api ("max historical activity offset of 5000 exceeded"), so for very
 * active wallets the replay only covered the last few days and the count was
 * far below what the site shows. /closed-positions has the full lifetime,
 * one row per (asset = market×outcome):
 *   avgPrice, totalBought, realizedPnl, curPrice, title, outcome, endDate, timestamp
 *
 * invested = avgPrice × totalBought
 * gotBack  = invested + realizedPnl
 *
 * Pagination: the endpoint serves max 50/page and truncates at 2000 rows
 * (40 pages) — enough to cover what the site itself displays (e.g. 1672 for
 * the biggest whale we test with).
 */
interface ClosedRow {
  conditionId: string;
  title: string;
  outcome: string;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  endDate?: string;
  timestamp: number;
  slug?: string;
  eventSlug?: string;
}

export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const { searchParams } = new URL(request.url);
  const sort = searchParams.get('sort') || 'won'; // 'won' | 'recent'

  try {
    const rows: ClosedRow[] = [];
    for (let page = 0; page < 40; page++) {
      const res = await fetch(
        `https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=50&sortBy=TIMESTAMP&sortDirection=DESC&offset=${page * 50}`,
        { next: { revalidate: 300 } }
      );
      if (!res.ok) throw new Error(`closed-positions ${res.status}`);
      const chunk: any[] = await res.json();
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      rows.push(...chunk);
      if (chunk.length < 50) break;
    }

    const mapped = rows.map((r) => {
      const avg = Number(r.avgPrice) || 0;
      const bought = Number(r.totalBought) || 0;
      const invested = avg * bought;
      const pnl = Number(r.realizedPnl) || 0;
      return {
        conditionId: r.conditionId,
        title: r.title || '',
        outcome: r.outcome || '',
        slug: r.slug || r.eventSlug || '',
        endDate: r.endDate || '',
        settledTs: r.timestamp || 0,
        avgPrice: avg,
        shares: bought,
        invested,
        gotBack: invested + pnl,
        pnl,
        result: pnl > 0.01 ? 'WON' : pnl < -0.01 ? 'LOST' : 'FLAT',
      };
    });

    const totals = {
      count: mapped.length,
      wins: mapped.filter((m) => m.pnl > 0.01).length,
      losses: mapped.filter((m) => m.pnl < -0.01).length,
      invested: mapped.reduce((s, m) => s + m.invested, 0),
      gotBack: mapped.reduce((s, m) => s + m.gotBack, 0),
      pnl: mapped.reduce((s, m) => s + m.pnl, 0),
      truncated: rows.length >= 2000, // endpoint cap reached — there are more
    };

    const sorted =
      sort === 'recent'
        ? [...mapped].sort((a, b) => b.settledTs - a.settledTs)
        : [...mapped].sort((a, b) => b.pnl - a.pnl);

    return NextResponse.json({ totals, closed: sorted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'closed-positions failed', totals: { count: 0, wins: 0, losses: 0, invested: 0, gotBack: 0, pnl: 0, truncated: false }, closed: [] }, { status: 200 });
  }
}

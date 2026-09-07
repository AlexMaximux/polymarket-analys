import { NextResponse } from 'next/server';

export const revalidate = 300; // Cache for 5 mins

/**
 * Live positions proxy. The raw data-api /positions response also includes
 * RESOLVED (dead) markets — rows with curPrice=0 + redeemable=true that
 * polymarket.com hides from "Open Positions". We return both lists:
 *   positions -> live open positions (what the site shows)
 *   resolved  -> settled positions waiting to be redeemed/lost (hidden by the site)
 * so the UI can be transparent instead of disagreeing with polymarket.com.
 */
export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/positions?user=${wallet}&limit=500&sortBy=CURRENT&sortDirection=DESC`
    );
    if (!res.ok) throw new Error('Failed to fetch positions');
    const data: any[] = await res.json();
    const rows = Array.isArray(data) ? data : [];
    // A market is CLOSED when it no longer has a live order book — reliably flagged by
    // redeemable=true (resolved on-chain). curPrice alone can mis-classify a winner that
    // is awaiting redemption (curPrice frozen >0 but already settled).
    const positions = rows.filter(r => !r.redeemable);
    const resolved = rows.filter(r => !!r.redeemable);
    return NextResponse.json({ positions, resolved });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 500 });
  }
}

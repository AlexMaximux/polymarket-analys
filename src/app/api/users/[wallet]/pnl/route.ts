import { NextResponse } from 'next/server';

export const revalidate = 300; // Cache for 5 mins

/**
 * Official Polymarket PnL series (same numbers as the user's polymarket.com profile):
 *   GET user-pnl-api.polymarket.com/user-pnl?user_address=<wallet>&interval=<iv>&fidelity=<fid>
 * Points are CUMULATIVE PnL snapshots (not deltas). Windows: 1d(1h) / 1w(1h) / 1m(1d) / all(1d).
 */
export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const { searchParams } = new URL(request.url);
  const interval = searchParams.get('interval') || '1d';
  const fidelity = interval === '1d' ? '1h' : interval === '1w' ? '1h' : '1d';

  try {
    const res = await fetch(
      `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}&interval=${interval}&fidelity=${fidelity}`
    );
    if (!res.ok) throw new Error(`user-pnl-api ${res.status}`);
    const series = await res.json();
    const points = Array.isArray(series) ? series : [];
    const current = points.length > 0 ? points[points.length - 1].p : 0;
    const first = points.length > 0 ? points[0].p : 0;
    return NextResponse.json({ points, current, change: current - first, interval });
  } catch (error) {
    return NextResponse.json({ points: [], current: 0, change: 0, interval, error: 'pnl fetch failed' }, { status: 502 });
  }
}

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const window = searchParams.get('window') || '1w'; // 1d, 1w, 1m, all
  
  try {
    const res = await fetch(`https://data-api.polymarket.com/v1/leaderboard?window=${window}&limit=100`);
    if (!res.ok) throw new Error('Failed to fetch from Polymarket');
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Leaderboard unavailable' }, { status: 500 });
  }
}

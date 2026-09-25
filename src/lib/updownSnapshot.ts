import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Fetches the same payload the /updown dashboard uses, for one coin.
 * Re-uses the internal API via absolute fetch so model/modelA/m1h stay identical to the UI.
 */
export async function fetchUpdownSnapshot(coin: string): Promise<any | null> {
  try {
    const base = process.env.PMP_BASE_URL || 'http://127.0.0.1:8000';
    // no ?sigma= → the API uses the coin's realized hourly vol, same default as the UI
    const res = await fetch(`${base}/api/updown?coin=${coin}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

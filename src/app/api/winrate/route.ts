import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/winrate?hours=24&minRate=80&minMarkets=3&limit=100
 *
 * Wallets whose PER-MARKET win rate (closed markets only) over the last `hours` hours
 * is >= minRate%. A market counts as won when the wallet's realized pnl on it is > 0.
 *
 * Perf: candidate pool = users with last_active in window AND trade_count >= minMarkets.
 * Full ledgers are fetched per wallet (cached 10 min via Next fetch cache) — the scan is
 * capped at `scan` wallets (most active first) so a request stays bounded.
 */

const CACHE_TTL = 600;

// in-process cache to avoid re-scanning on every page load
const cache = new Map<string, { at: number; rows: any[] }>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hours = Math.max(parseInt(searchParams.get('hours') || '24'), 1);
  const minRate = Math.min(Math.max(parseFloat(searchParams.get('minRate') || '80'), 0), 100);
  const minMarkets = Math.max(parseInt(searchParams.get('minMarkets') || '3'), 1);
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 200);
  const scan = Math.min(parseInt(searchParams.get('scan') || '400'), 1000);

  const db = getDb();
  const since = Math.floor(Date.now() / 1000) - hours * 3600;

  const cacheKey = `${hours}:${minMarkets}:${scan}`;
  const cached = cache.get(cacheKey);
  let allRows: any[];
  if (cached && Date.now() / 1000 - cached.at < CACHE_TTL) {
    allRows = cached.rows;
  } else {
    const candidates = db
      .prepare(
        `SELECT wallet, COALESCE(NULLIF(pseudonym,''), NULLIF(name,''), '') as label
         FROM users WHERE last_active >= ? AND trade_count >= ? ORDER BY last_active DESC LIMIT ?`
      )
      .all(since, minMarkets, scan) as { wallet: string; label: string }[];

    allRows = [];
    const batchSize = 12;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(c => ledgerStats(c.wallet, since, minMarkets)));
      results.forEach(r => { if (r) allRows.push(r); });
    }
    allRows.sort((a, b) => b.winRate - a.winRate || b.markets - a.markets);
    cache.set(cacheKey, { at: Date.now() / 1000, rows: allRows });
  }

  const qualifying = allRows.filter(r => r.winRate >= minRate).slice(0, limit);
  return NextResponse.json({
    rows: qualifying,
    scanned: allRows.length,
    qualifying: qualifying.length,
    hours, minRate, minMarkets,
  });
}

async function ledgerStats(wallet: string, since: number, minMarkets: number) {
  const rows: any[] = [];
  for (let page = 0; page < 4; page++) {
    try {
      const res = await fetch(`https://data-api.polymarket.com/activity?user=${wallet}&limit=500&offset=${page * 500}`, { next: { revalidate: CACHE_TTL } });
      if (!res.ok) return null;
      const chunk: any[] = await res.json();
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      rows.push(...chunk);
      if (chunk.length < 500) break;
    } catch { return null; }
  }

  // lifetime stats (all history fetched): trade count + realized pnl across ALL time
  let allTimeTrades = 0;
  let lifeInvested = 0, lifeReturned = 0;
  for (const a of rows) {
    if (a.type === 'TRADE') allTimeTrades++;
    if (a.type !== 'TRADE' && a.type !== 'REDEEM') continue;
    const usd = Number(a.usdcSize) || 0;
    if (a.type === 'TRADE' && a.side === 'BUY') lifeInvested += usd; else lifeReturned += usd;
  }

  // per-condition realized pnl, only from trades/redeems INSIDE the window
  const markets = new Map<string, { invested: number; returned: number; firstTs: number; lastTs: number }>();
  for (const a of rows) {
    if (a.type !== 'TRADE' && a.type !== 'REDEEM') continue;
    const ts = Number(a.timestamp) || 0;
    if (ts < since) continue;
    const cid = a.conditionId;
    if (!cid) continue;
    let m = markets.get(cid);
    if (!m) { m = { invested: 0, returned: 0, firstTs: ts, lastTs: ts }; markets.set(cid, m); }
    const usd = Number(a.usdcSize) || 0;
    if (a.type === 'TRADE' && a.side === 'BUY') { m.invested += usd; if (ts < m.firstTs) m.firstTs = ts; }
    else { m.returned += usd; }
    if (ts > m.lastTs) m.lastTs = ts;
  }

  let wins = 0, losses = 0, invested = 0, returned = 0;
  let name = '', pseudonym = '';
  for (const m of markets.values()) {
    // only markets the wallet ENTERED during the window count toward win rate —
    // otherwise old positions redeeming now would pollute the rate
    if (m.invested <= 0.01) continue;
    const pnl = m.returned - m.invested;
    if (pnl > 0.01) wins++; else if (pnl < -0.01) losses++;
    invested += m.invested; returned += m.returned;
  }
  const settled = wins + losses;
  if (settled < minMarkets) return null;
  // grab a display name from any row
  for (const a of rows) { pseudonym = a.pseudonym || ''; name = a.name || ''; break; }

  return {
    wallet,
    pseudonym: pseudonym || name || '',
    markets: settled,
    wins,
    losses,
    winRate: settled > 0 ? Math.round((wins / settled) * 1000) / 10 : 0,
    invested,
    returned,
    pnl: returned - invested,
    lastActive: Math.max(...[...markets.values()].map(m => m.lastTs)),
    allTimeTrades,
    lifetimePnl: lifeReturned - lifeInvested,
    lifetimeInvested: lifeInvested,
  };
}

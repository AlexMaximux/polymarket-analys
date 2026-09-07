import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Wallet watchlist for starred_open alerts + starring wallets.
 *
 * POST /api/watchlist { wallet, alertId? } — add wallet to watchlist
 * DELETE /api/watchlist?wallet=0x..&alertId=1 — remove
 * GET /api/watchlist?alertId=1 — list wallets (of one alert, or all with starred flags)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const alertId = parseInt(searchParams.get('alertId') || '0');

  const db = getDb();
  if (alertId) {
    const wallets = db.prepare(`SELECT wallet FROM alert_wallets WHERE alert_id = ? ORDER BY wallet`).all(alertId);
    return NextResponse.json({ wallets });
  }
  const starred = db
    .prepare(
      `SELECT wallet, name, pseudonym, max_single_bet, total_notional, trade_count,
              true_first_trade_at, note, last_active
       FROM users WHERE starred = 1 ORDER BY starred DESC, max_single_bet DESC`
    )
    .all();
  return NextResponse.json({ starred });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const wallet = String(body?.wallet || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return NextResponse.json({ error: 'valid wallet required' }, { status: 400 });
  const star = body?.star !== false; // default: also star the wallet
  const alertId = parseInt(body?.alertId || '0');

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    // ensure the user exists locally (light row) so starring works even before the crawler sees them
    db.prepare(
      `INSERT INTO users (wallet, pseudonym, first_seen, last_active, starred)
       VALUES (?, '', ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET starred = MAX(COALESCE(starred, 0), excluded.starred)`
    ).run(wallet, now, now, star ? 1 : 0);
    if (alertId) {
      db.prepare(`INSERT OR IGNORE INTO alert_wallets (alert_id, wallet) VALUES (?, ?)`).run(alertId, wallet);
    }
  });
  tx();
  return NextResponse.json({ ok: true, wallet, starred: star, alertId: alertId || null });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const wallet = String(body?.wallet || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return NextResponse.json({ error: 'valid wallet required' }, { status: 400 });
  const note = String(body?.note ?? '').slice(0, 2000);
  const db = getDb();
  const r = db.prepare(`UPDATE users SET note = ? WHERE wallet = ?`).run(note, wallet);
  if (r.changes === 0) return NextResponse.json({ error: 'wallet not found' }, { status: 404 });
  return NextResponse.json({ ok: true, wallet, note });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = String(searchParams.get('wallet') || '').trim().toLowerCase();
  const alertId = parseInt(searchParams.get('alertId') || '0');
  if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 });

  const db = getDb();
  if (alertId) {
    db.prepare(`DELETE FROM alert_wallets WHERE alert_id = ? AND wallet = ?`).run(alertId, wallet);
  } else {
    db.prepare(`UPDATE users SET starred = 0 WHERE wallet = ?`).run(wallet);
    db.prepare(`DELETE FROM alert_wallets WHERE wallet = ?`).run(wallet);
  }
  return NextResponse.json({ ok: true });
}

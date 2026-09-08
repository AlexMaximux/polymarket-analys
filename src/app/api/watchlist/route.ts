import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Wallet watchlist for starred_open alerts + starring wallets.
 *
 * GET    /api/watchlist                 — starred wallets (with category info) + all categories
 * POST   /api/watchlist { wallet }      — star + add to watchlists
 * PATCH  /api/watchlist { wallet, note?, categoryId? } — update note and/or category
 * PUT    /api/watchlist { category }    — create/update a category { id?, label, emoji, note, sort }
 * DELETE /api/watchlist?wallet=0x..&alertId=1 — remove
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
      `SELECT u.wallet, u.name, u.pseudonym, u.max_single_bet, u.total_notional, u.trade_count,
              u.true_first_trade_at, u.note, u.last_active, u.category_id,
              wc.label AS category_label, wc.emoji AS category_emoji, wc.note AS category_note
       FROM users u LEFT JOIN watch_categories wc ON wc.id = u.category_id
       WHERE u.starred = 1 ORDER BY u.max_single_bet DESC`
    )
    .all();
  const categories = db
    .prepare(`SELECT id, label, emoji, note, sort FROM watch_categories ORDER BY sort, id`)
    .all();
  return NextResponse.json({ starred, categories });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const wallet = String(body?.wallet || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return NextResponse.json({ error: 'valid wallet required' }, { status: 400 });
  const star = body?.star !== false;
  const alertId = parseInt(body?.alertId || '0');

  const db = getDb();
  db.prepare(`INSERT INTO users (wallet) VALUES (?) ON CONFLICT(wallet) DO NOTHING`).run(wallet);
  if (star) db.prepare(`UPDATE users SET starred = 1 WHERE wallet = ?`).run(wallet);
  if (alertId) {
    db.prepare(`INSERT OR IGNORE INTO alert_wallets (alert_id, wallet) VALUES (?, ?)`).run(alertId, wallet);
  }
  return NextResponse.json({ ok: true, wallet });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const wallet = String(body?.wallet || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return NextResponse.json({ error: 'valid wallet required' }, { status: 400 });
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (body?.note !== undefined) { sets.push('note = ?'); vals.push(String(body.note).slice(0, 2000)); }
  if (body?.categoryId !== undefined) {
    const cid = body.categoryId === null ? null : parseInt(body.categoryId) || null;
    sets.push('category_id = ?'); vals.push(cid);
  }
  if (!sets.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  vals.push(wallet);
  const r = db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE wallet = ?`).run(...vals);
  if (r.changes === 0) return NextResponse.json({ error: 'wallet not found' }, { status: 404 });
  return NextResponse.json({ ok: true, wallet });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const cat = body?.category;
  if (!cat?.label) return NextResponse.json({ error: 'category label required' }, { status: 400 });
  const db = getDb();
  const label = String(cat.label).slice(0, 60);
  const emoji = String(cat.emoji || '⭐').slice(0, 8);
  const note = String(cat.note || '').slice(0, 2000);
  const sort = parseInt(cat.sort) || 99;
  if (cat.id) {
    db.prepare(`UPDATE watch_categories SET label=?, emoji=?, note=?, sort=? WHERE id=?`)
      .run(label, emoji, note, sort, parseInt(cat.id));
    return NextResponse.json({ ok: true, id: parseInt(cat.id) });
  }
  const r = db.prepare(`INSERT INTO watch_categories (label, emoji, note, sort) VALUES (?,?,?,?)`)
    .run(label, emoji, note, sort);
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = (searchParams.get('wallet') || '').toLowerCase();
  const alertId = parseInt(searchParams.get('alertId') || '0');
  const db = getDb();
  if (alertId) {
    db.prepare(`DELETE FROM alert_wallets WHERE alert_id = ? AND wallet = ?`).run(alertId, wallet);
  } else {
    db.prepare(`UPDATE users SET starred = 0 WHERE wallet = ?`).run(wallet);
    db.prepare(`DELETE FROM alert_wallets WHERE wallet = ?`).run(wallet);
  }
  return NextResponse.json({ ok: true });
}

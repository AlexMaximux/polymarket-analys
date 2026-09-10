import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const alerts = db
    .prepare(
      `SELECT a.*,
              (SELECT COUNT(*) FROM alert_seen s WHERE s.alert_id = a.id) as fired_count,
              (SELECT COUNT(*) FROM alert_wallets w WHERE w.alert_id = a.id) as wallet_count
       FROM alerts a ORDER BY a.id`
    )
    .all();
  return NextResponse.json({ alerts });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });

  const name = String(body.name || '').trim();
  const alertType = ['starred_open', 'updown', 'starred_gold'].includes(body.alertType) ? body.alertType : 'new_whale';
  const hours = parseInt(body.hours);
  const minBet = parseFloat(body.minBet);
  const token = String(body.telegramToken || '').trim();
  const chat = String(body.telegramChat || '').trim();
  const wallets: string[] = Array.isArray(body.wallets) ? body.wallets.map((w: any) => String(w).trim().toLowerCase()).filter(Boolean) : [];

  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (!hours || hours < 1 || hours > 8760) return NextResponse.json({ error: 'hours must be 1-8760' }, { status: 400 });
  if (alertType === 'new_whale' && !(minBet > 0)) return NextResponse.json({ error: 'minBet must be > 0' }, { status: 400 });
  if (!token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) return NextResponse.json({ error: 'telegramToken looks invalid' }, { status: 400 });
  if (!chat) return NextResponse.json({ error: 'telegramChat required' }, { status: 400 });
  const watchStarred = body?.watchStarred !== false; // starred_open: starred wallets are always watched
  if (alertType === 'starred_open' && wallets.length === 0 && !watchStarred) {
    return NextResponse.json({ error: 'starred_open alert needs at least one wallet or the starred set' }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO alerts (name, alert_type, hours, min_bet, telegram_token, telegram_chat, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(name, alertType, hours, alertType === 'new_whale' ? minBet : 0, token, chat, now);
    const id = Number(res.lastInsertRowid);
    const ins = db.prepare(`INSERT OR IGNORE INTO alert_wallets (alert_id, wallet) VALUES (?, ?)`);
    for (const w of wallets) ins.run(id, w);
    return id;
  });
  const id = tx();

  return NextResponse.json({ id }, { status: 201 });
}

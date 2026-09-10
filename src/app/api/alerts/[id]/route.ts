import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { evaluateAlert, sendTelegram, formatWhaleMessage, formatPositionMessage, AlertRow } from '@/lib/alerts';
import { markAlertSeen } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

type Action = 'enable' | 'disable' | 'delete' | 'test' | 'run';

/** POST /api/alerts/[id]  body: { action } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr);
  const { action } = await request.json().catch(() => ({ action: undefined }));
  if (!id || !action) return NextResponse.json({ error: 'id and action required' }, { status: 400 });

  const db = getDb();
  const alert = db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(id) as AlertRow | undefined;
  if (!alert) return NextResponse.json({ error: 'alert not found' }, { status: 404 });

  switch (action as Action) {
    case 'enable':
      db.prepare(`UPDATE alerts SET enabled = 1 WHERE id = ?`).run(id);
      return NextResponse.json({ ok: true, enabled: true });

    case 'disable':
      db.prepare(`UPDATE alerts SET enabled = 0 WHERE id = ?`).run(id);
      return NextResponse.json({ ok: true, enabled: false });

    case 'delete':
      db.prepare(`DELETE FROM alerts WHERE id = ?`).run(id);
      db.prepare(`DELETE FROM alert_seen WHERE alert_id = ?`).run(id);
      db.prepare(`DELETE FROM alert_wallets WHERE alert_id = ?`).run(id);
      return NextResponse.json({ ok: true, deleted: true });

    case 'test': {
      // Sends a sample message WITHOUT touching dedupe tables — pure connectivity check.
      const sample =
        alert.alert_type === 'starred_gold'
          ? `🥇 <b>Test alert: ${alert.name}</b>\nGold-starred wallets position-open alert wiring works.`
          : alert.alert_type === 'starred_open'
          ? `⭐ <b>Test alert: ${alert.name}</b>\nWatchlist position-open alert wiring works.`
          : alert.alert_type === 'updown'
          ? `📈 <b>Test alert: ${alert.name}</b>\nUP/DOWN signal alert wiring works. Fires when both Fair-Value-1H and Base(no-drift) are on the same side of the 1H market UP price.`
          : `🔔 <b>Test alert: ${alert.name}</b>\nRule: first-ever trade within ${alert.hours}h &amp; max bet ≥ $${alert.min_bet.toLocaleString()}\nIf you can read this, the Telegram wiring works.`;
      const ok = await sendTelegram(alert.telegram_token, alert.telegram_chat, sample);
      return NextResponse.json({ ok, sent: ok }, { status: ok ? 200 : 502 });
    }

    case 'run': {
      // Manual evaluation right now (respects dedupe — only NEW events fire).
      const matches = await evaluateAlert(alert);
      let sent = false;
      if (matches.length > 0) {
        const msg = alert.alert_type === 'starred_open'
          ? await formatPositionMessage(alert, matches)
          : formatWhaleMessage(alert, matches);
        sent = await sendTelegram(alert.telegram_token, alert.telegram_chat, msg);
        if (sent) {
          markAlertSeen(alert, matches);
          db.prepare(`UPDATE alerts SET last_fired_at = ? WHERE id = ?`).run(Math.floor(Date.now() / 1000), alert.id);
        }
      }
      return NextResponse.json({ ok: true, matched: matches.length, sent });
    }

    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}

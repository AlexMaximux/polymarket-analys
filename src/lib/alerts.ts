import { getDb } from './db';

/**
 * Alert engine. Two rule types:
 *
 *  1. new_whale  — wallet whose TRUE first-ever on-chain trade (true_first_trade_at, resolved by
 *                  the backfill worker from full activity history) happened within the last `hours`
 *                  hours AND whose max single bet >= min_bet. Dedupe: alert_seen (alert_id, wallet).
 *
 *  2. starred_open — a wallet on the alert's watchlist (alert_wallets, fed from starred wallets or
 *                  explicitly listed wallets) opens a NEW position: any fresh BUY trade seen since the
 *                  last evaluation watermark. Uses /activity?type=TRADE&side=BUY per wallet (cheap for
 *                  watchlists of a handful of wallets). Dedupe: alert_pos_seen (alert_id, wallet, conditionId).
 */

export interface AlertRow {
  id: number;
  name: string;
  alert_type: 'new_whale' | 'starred_open';
  hours: number;
  min_bet: number;
  telegram_token: string;
  telegram_chat: string;
  enabled: number;
  last_fired_at: number | null;
  last_evaluated_at: number | null;
  created_at: number;
}

export function sendTelegram(token: string, chat: string, text: string): Promise<boolean> {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
    .then(r => r.ok)
    .catch(() => false);
}

export function formatWhaleMessage(alert: AlertRow, whales: any[]): string {
  const lines = whales.map(w => {
    const firstSize = w.true_first_trade_size != null ? Number(w.true_first_trade_size) : 0;
    const firstDate = new Date(w.true_first_trade_at * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    return (
      `🐋 <b>${w.pseudonym || w.name || 'Anonymous'}</b>\n` +
      `• First-ever bet: <b>$${firstSize.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b> (${firstDate})\n` +
      `• Max single bet: $${Number(w.max_single_bet || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` +
      `• Total volume: $${Number(w.total_notional || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` +
      `• https://polymarket.com/profile/${w.wallet}`
    );
  });
  return (
    `<b>🚨 ${alert.name}</b>\n` +
    `Rule: first-ever trade within last ${alert.hours}h &amp; max single bet ≥ $${alert.min_bet.toLocaleString()}\n` +
    `${whales.length} new whale${whales.length > 1 ? 's' : ''}:\n\n` +
    lines.join('\n\n')
  );
}

function fmtAge(ts: number): string {
  const d = Math.floor((Date.now() / 1000 - ts) / 60);
  if (d < 60) return `${d}m ago`;
  return `${Math.floor(d / 60)}h${d % 60 ? ' ' + (d % 60) + 'm' : ''} ago`;
}

export function formatPositionMessage(alert: AlertRow, events: any[]): string {
  const lines = events.map((e: any) => {
    const badge = e.catEmoji ? `${e.catEmoji} <b>${e.catLabel}</b>` : '⭐';
    const noteLine = e.note ? `\n📝 <i>${e.note}</i>` : '';
    const catLine = e.catNote ? `\n🏷 <i>${e.catNote}</i>` : '';
    return (
      `${badge} <b>${e.pseudonym || e.name || e.wallet.slice(0, 10) + '…'}</b>${noteLine}${catLine}\n` +
      `• Opened: <b>${e.side === 'BUY' ? 'LONG' : e.side} ${e.outcome}</b>\n` +
      `• Market: ${e.title}\n` +
      `• Size: ${Number(e.size).toLocaleString(undefined, { maximumFractionDigits: 0 })} sh @ ${e.price}¢` +
      (e.usdcSize ? ` (<b>$${Number(e.usdcSize).toLocaleString(undefined, { maximumFractionDigits: 0 })}</b>)` : '') +
      `\n• ${fmtAge(e.timestamp)}\n` +
      `• https://polymarket.com/event/${e.slug || ''}`
    );
  });
  return (
    `<b>⭐ ${alert.name}</b>\n` +
    `${events.length} new position${events.length > 1 ? 's' : ''} from watchlisted wallet${events.length > 1 ? 's' : ''}:\n\n` +
    lines.join('\n\n')
  );
}

/** new_whale rule: match whales not yet notified, mark them seen. */
function evaluateWhaleAlert(alert: AlertRow): any[] {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const threshold = now - alert.hours * 3600;

  const matches = db
    .prepare(
      `SELECT u.* FROM users u
       WHERE u.true_first_checked_at IS NOT NULL
         AND u.true_first_trade_at IS NOT NULL
         AND u.true_first_trade_at >= ?
         AND u.max_single_bet >= ?
         AND NOT EXISTS (SELECT 1 FROM alert_seen s WHERE s.alert_id = ? AND s.wallet = u.wallet)
       ORDER BY u.max_single_bet DESC`
    )
    .all(threshold, alert.min_bet, alert.id);

  // NOTE: marking happens after successful send (see markWhaleSeen) so failed sends don't lose events.
  return matches;
}

/** starred_open rule: poll recent BUYs of watchlisted wallets, dedupe per (alert, wallet, market). */
async function evaluateStarredAlert(alert: AlertRow): Promise<any[]> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // watchlist = wallets explicitly on the alert + starred wallets (if alert watches starred set)
  const wallets = new Set<string>(
    (db.prepare(`SELECT wallet FROM alert_wallets WHERE alert_id = ?`).all(alert.id) as any[]).map(r => r.wallet)
  );
  const starred = db.prepare(`SELECT wallet FROM users WHERE starred = 1`).all() as { wallet: string }[];
  for (const s of starred) wallets.add(s.wallet);
  if (wallets.size === 0) return [];

  // watermark: only look at trades newer than (last eval - 5 min overlap)
  const lastEval = (db.prepare(`SELECT last_evaluated_at FROM alerts WHERE id = ?`).get(alert.id) as any)?.last_evaluated_at || (now - alert.hours * 3600);
  const since = lastEval - 300;

  const metaByWallet = new Map<string, any>();
  for (const s of starred) metaByWallet.set(s.wallet, s);
  const events: any[] = [];
  // dedupe check WITHOUT marking — marking happens only after a successful Telegram send
  const isSeen = db.prepare(`SELECT 1 FROM alert_pos_seen WHERE alert_id = ? AND wallet = ? AND condition_id = ?`);
  const mark = db.prepare(`INSERT OR IGNORE INTO alert_pos_seen (alert_id, wallet, condition_id, fired_at) VALUES (?, ?, ?, ?)`);
  for (const w of wallets) {
    try {
      const res = await fetch(`https://data-api.polymarket.com/activity?user=${w}&type=TRADE&side=BUY&limit=100`);
      if (!res.ok) continue;
      const rows: any[] = await res.json();
      for (const t of rows) {
        if (!t.conditionId || !t.timestamp || t.timestamp <= since) continue;
        if (isSeen.get(alert.id, w, t.conditionId)) continue;
        const meta = metaByWallet.get(w) || {};
        events.push({
          wallet: w,
          conditionId: t.conditionId,
          pseudonym: meta.pseudonym || meta.name || t.pseudonym || t.name || '',
          note: meta.note || '',
          catLabel: meta.cat_label || '',
          catEmoji: meta.cat_emoji || '',
          catNote: meta.cat_note || '',
          title: t.title,
          outcome: t.outcome,
          side: 'BUY',
          size: Number(t.size) || 0,
          price: Math.round((Number(t.price) || 0) * 100),
          usdcSize: Number(t.usdcSize) || 0,
          timestamp: t.timestamp,
          slug: t.slug,
        });
      }
    } catch (e) {
      console.error(`starred_open poll failed for ${w.slice(0, 10)}:`, e);
    }
    await new Promise(r => setTimeout(r, 200)); // polite
  }
  return events.sort((a, b) => b.timestamp - a.timestamp);
}

/** Mark whale wallets as notified (call only after successful send). */
function markWhaleSeen(alert: AlertRow, whales: any[]): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(`INSERT OR IGNORE INTO alert_seen (alert_id, wallet, fired_at, first_trade_at) VALUES (?, ?, ?, ?)`);
  const markAll = db.transaction((rows: any[]) => {
    for (const w of rows) insert.run(alert.id, w.wallet, now, w.true_first_trade_at);
  });
  markAll(whales);
}

/** Mark starred position events as notified (call only after successful send). */
function markPositionsSeen(alert: AlertRow, events: any[]): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const mark = db.prepare(`INSERT OR IGNORE INTO alert_pos_seen (alert_id, wallet, condition_id, fired_at) VALUES (?, ?, ?, ?)`);
  const markAll = db.transaction((rows: any[]) => {
    for (const e of rows) mark.run(alert.id, e.wallet, e.conditionId, now);
  });
  markAll(events);
}

/** Telegram hard-caps messages at 4096 chars — chunk to be safe. */
function chunkMessage(msg: string, maxLen = 3500): string[] {
  if (msg.length <= maxLen) return [msg];
  const chunks: string[] = [];
  let cur = '';
  for (const block of msg.split('\n\n')) {
    if ((cur + '\n\n' + block).length > maxLen && cur) {
      chunks.push(cur);
      cur = block;
    } else {
      cur = cur ? cur + '\n\n' + block : block;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Mark an alert's matches as seen after a successful send (used by manual run endpoint too). */
export function markAlertSeen(alert: AlertRow, matches: any[]): void {
  if (alert.alert_type === 'starred_open') markPositionsSeen(alert, matches);
  else markWhaleSeen(alert, matches);
}

/** Evaluate one alert (dispatch by type) and return matches (not yet sent/marked). */
export async function evaluateAlert(alert: AlertRow): Promise<any[]> {
  if (alert.alert_type === 'starred_open') return evaluateStarredAlert(alert);
  return evaluateWhaleAlert(alert);
}

/** Evaluate every enabled alert and send Telegram messages for new matches. Returns summary. */
export async function evaluateAllAlerts(): Promise<{ evaluated: number; sent: number; failed: number }> {
  const db = getDb();
  const alerts = db.prepare(`SELECT * FROM alerts WHERE enabled = 1`).all() as AlertRow[];
  let sent = 0;
  let failed = 0;

  for (const alert of alerts) {
    try {
      const matches = await evaluateAlert(alert);
      if (matches.length > 0) {
        const msg = alert.alert_type === 'starred_open'
          ? formatPositionMessage(alert, matches)
          : formatWhaleMessage(alert, matches);
        const chunks = chunkMessage(msg);
        let allOk = true;
        for (const part of chunks) {
          const ok = await sendTelegram(alert.telegram_token, alert.telegram_chat, part);
          if (!ok) { allOk = false; break; }
        }
        if (allOk) {
          // mark AFTER successful send so failed sends are retried next cycle
          if (alert.alert_type === 'starred_open') markPositionsSeen(alert, matches);
          else markWhaleSeen(alert, matches);
          sent++;
          db.prepare(`UPDATE alerts SET last_fired_at = ? WHERE id = ?`).run(Math.floor(Date.now() / 1000), alert.id);
        } else {
          failed++;
        }
      }
    } catch (e) {
      console.error(`alert ${alert.id} eval error:`, e);
      failed++;
    }
    db.prepare(`UPDATE alerts SET last_evaluated_at = ? WHERE id = ?`).run(Math.floor(Date.now() / 1000), alert.id);
  }

  return { evaluated: alerts.length, sent, failed };
}

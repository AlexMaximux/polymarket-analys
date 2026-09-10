import { getDb } from '@/lib/db';
import { fetchUpdownSnapshot } from '@/lib/updownSnapshot';
import { sendTelegram } from '@/lib/alerts';

const COOLDOWN_MIN = 30;      // don't re-fire for the same coin within 30 min
const MIN_EDGE_CENTS = 1.5;   // require a meaningful gap, not 0.1¢ noise

type Signal = { coin: string; label: string; side: 'SELL' | 'BUY'; target: number; fv1h: number; base: number; marketUp: number; slug: string };

/** Check every coin: if BOTH Fair-Value-1H and Base(no-drift) are on the same side of market UP price → signal. */
async function evaluateUpdownSignals(): Promise<Signal[]> {
  const coins: [string, string][] = [
    ['btc', 'Bitcoin'], ['eth', 'Ethereum'], ['sol', 'Solana'], ['xrp', 'XRP'],
    ['doge', 'Dogecoin'], ['hype', 'Hyperliquid'], ['zec', 'ZCash'], ['bnb', 'BNB'],
  ];
  const out: Signal[] = [];
  for (const [coin, label] of coins) {
    try {
      const snap = await fetchUpdownSnapshot(coin);
      if (!snap) continue;
      const { m1h, model, modelA } = snap;
      if (!m1h || m1h.closed || !m1h.accepting) continue;
      const fv1h = Number(model?.fairUp);      // Fair Value 1H (μ from 15m)
      const base = Number(modelA?.fairUp);     // Base (No drift)
      const marketUp = Number(m1h.up);         // market UP price, 0..1
      if (!isFinite(fv1h) || !isFinite(base) || !isFinite(marketUp) || marketUp <= 0 || marketUp >= 1) continue;

      const bothBelow = fv1h < marketUp && base < marketUp;
      const bothAbove = fv1h > marketUp && base > marketUp;
      if (!bothBelow && !bothAbove) continue;

      // edge = distance of the CLOSER model to market (must clear noise floor)
      const closer = Math.max(Math.abs(marketUp - fv1h), Math.abs(marketUp - base)) * 100;
      if (closer < MIN_EDGE_CENTS) continue;

      out.push({
        coin, label,
        side: bothBelow ? 'SELL' : 'BUY',
        target: base * 100, // target is always Base (No drift), as user specified
        fv1h: fv1h * 100,
        base: base * 100,
        marketUp: marketUp * 100,
        slug: m1h.slug as string,
      });
    } catch { /* per-coin failure must not kill the loop */ }
  }
  return out;
}

export async function checkUpdownSignals(
  telegramToken: string,
  telegramChat: string,
): Promise<number> {
  const db = getDb();
  const signals = await evaluateUpdownSignals();
  let sent = 0;
  for (const s of signals) {
    // cooldown per coin+side so the same condition doesn't spam every 60s
    const key = `updown:${s.coin}:${s.side}`;
    const last = (db.prepare(`SELECT fired_at FROM updown_signal_seen WHERE key = ?`).get(key) as any)?.fired_at || 0;
    if (Date.now() / 1000 - last < COOLDOWN_MIN * 60) continue;

    const arrow = s.side === 'SELL' ? '🔴' : '🟢';
    const msg =
      `${arrow} <b>UP/DOWN ${s.side} — ${s.label} 1H</b>\n` +
      `• Market UP: <b>${s.marketUp.toFixed(1)}¢</b>\n` +
      `• Fair Value 1H: ${s.fv1h.toFixed(1)}¢\n` +
      `• Base (No drift): ${s.base.toFixed(1)}¢\n` +
      `• Signal: <b>${s.side} UP</b> → target <b>${s.target.toFixed(1)}¢</b> (Base)\n` +
      `• https://polymarket.com/event/${s.slug}`;

    const ok = await sendTelegram(telegramToken, telegramChat, msg);
    if (ok) {
      db.prepare(`INSERT OR REPLACE INTO updown_signal_seen (key, fired_at) VALUES (?, ?)`).run(key, Math.floor(Date.now() / 1000));
      sent++;
    }
  }
  return sent;
}

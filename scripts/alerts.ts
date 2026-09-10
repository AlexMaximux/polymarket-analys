import { initializeDb, getDb } from '../src/lib/db';
import { evaluateAllAlerts } from '../src/lib/alerts';
import { checkUpdownSignals } from '../src/lib/updownSignals';

/** Telegram creds: take from any enabled alert, else env. */
function updownCreds(): { token: string; chat: string } | null {
  if (process.env.UPDOWN_TG_TOKEN && process.env.UPDOWN_TG_CHAT) {
    return { token: process.env.UPDOWN_TG_TOKEN, chat: process.env.UPDOWN_TG_CHAT };
  }
  try {
    const db = getDb();
    const row = db.prepare(`SELECT telegram_token, telegram_chat FROM alerts WHERE enabled = 1 LIMIT 1`).get() as any;
    if (row) return { token: row.telegram_token, chat: row.telegram_chat };
  } catch { /* db not ready */ }
  return null;
}

/**
 * Alert worker: evaluates all enabled alert rules every 60s and pushes
 * Telegram messages for new (never-seen) whale matches.
 */
async function alertLoop() {
  initializeDb();
  console.log('Starting alert evaluation loop (every 60s)...');
  while (true) {
    try {
      const r = await evaluateAllAlerts();
      if (r.sent > 0 || r.failed > 0) {
        console.log(`[${new Date().toISOString()}] alerts: evaluated=${r.evaluated} sent=${r.sent} failed=${r.failed}`);
      }
      const creds = updownCreds();
      if (creds) {
        const s = await checkUpdownSignals(creds.token, creds.chat);
        if (s > 0) console.log(`[${new Date().toISOString()}] updown signals sent=${s}`);
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] alert loop error:`, err);
    }
    await new Promise(r => setTimeout(r, 60000));
  }
}

alertLoop().catch(console.error);

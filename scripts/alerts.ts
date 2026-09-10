import { initializeDb } from '../src/lib/db';
import { evaluateAllAlerts } from '../src/lib/alerts';

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
    } catch (err) {
      console.error(`[${new Date().toISOString()}] alert loop error:`, err);
    }
    await new Promise(r => setTimeout(r, 60000));
  }
}

alertLoop().catch(console.error);

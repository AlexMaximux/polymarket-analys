import { initializeDb } from '../src/lib/db';
import { fetchTrueFirstTrade, saveTrueFirst, pendingBackfillQueue } from '../src/lib/truefirst';

/**
 * Backfill worker: continuously resolves the TRUE on-chain first trade for wallets
 * we track but haven't scanned yet (oldest/biggest first), then marks them checked.
 * Safe to run alongside the crawler; single instance assumed (like crawl.ts).
 */
async function backfill() {
  initializeDb();
  console.log('Starting true-first-trade backfill loop...');
  while (true) {
    const wallets = pendingBackfillQueue(25);
    if (wallets.length === 0) {
      await new Promise(r => setTimeout(r, 15000)); // wait for crawler to discover new users
      continue;
    }
    for (const w of wallets) {
      try {
        const r = await fetchTrueFirstTrade(w);
        saveTrueFirst(r);
        console.log(
          `[${new Date().toISOString()}] ${w.slice(0, 10)}... first=${
            r.true_first_trade_at ? new Date(r.true_first_trade_at * 1000).toISOString() : 'none'
          } scanned=${r.scanned}`
        );
      } catch (err) {
        console.error(`[${new Date().toISOString()}] backfill error for ${w}:`, err);
        await new Promise(r => setTimeout(r, 3000));
      }
      await new Promise(r => setTimeout(r, 400)); // polite between wallets
    }
  }
}

backfill().catch(console.error);

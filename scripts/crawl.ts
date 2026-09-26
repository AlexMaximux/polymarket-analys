import { runCrawlPhase } from '../src/lib/crawler';
import { getSetting } from '../src/lib/settings';

async function crawl() {
  console.log('Starting crawler loop...');
  while (true) {
    try {
      const { fetched, inserted } = await runCrawlPhase(200);
      console.log(`[${new Date().toISOString()}] Fetched: ${fetched}, Inserted: ${inserted}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Crawl error:`, err);
    }
    // Poll interval from /control settings (default 30s)
    await new Promise(r => setTimeout(r, getSetting('crawl.intervalSec') * 1000));
  }
}

crawl().catch(console.error);

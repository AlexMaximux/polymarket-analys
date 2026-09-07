import { runCrawlPhase } from '../src/lib/crawler';

async function crawl() {
  console.log('Starting crawler loop...');
  while (true) {
    try {
      const { fetched, inserted } = await runCrawlPhase(200);
      console.log(`[${new Date().toISOString()}] Fetched: ${fetched}, Inserted: ${inserted}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Crawl error:`, err);
    }
    // Poll every 30s
    await new Promise(r => setTimeout(r, 30000));
  }
}

crawl().catch(console.error);

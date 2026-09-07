import { runCrawlPhase } from '../src/lib/crawler';

async function seed() {
  console.log('Starting seed...');
  let totalInserted = 0;
  
  for (let i = 0; i < 3; i++) {
    console.log(`Fetching page ${i+1}...`);
    const { fetched, inserted } = await runCrawlPhase(100);
    console.log(`Fetched ${fetched}, Inserted ${inserted} new trades.`);
    totalInserted += inserted;
    if (i < 2) await new Promise(r => setTimeout(r, 1500)); // Be polite
  }
  
  console.log(`Seed complete. Total new trades inserted: ${totalInserted}`);
}

seed().catch(console.error);

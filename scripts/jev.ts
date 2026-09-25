import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import {
  generateJevSnapshot,
  callJevDecision,
  saveHistoricalJevRecord,
  getLatestHistoricalFile,
} from '../src/lib/jevSnapshot';
import { initializeAlertTracker } from '../src/lib/jevAlerts';

const SNAPSHOT_INTERVAL_MS = 30000; // 30s live cache refresh
const JEV_RECORD_INTERVAL_MS = 300000; // 5 minutes (300 seconds)

const SUPPORTED_COINS = ['btc', 'eth', 'sol', 'xrp', 'doge', 'hype', 'zec', 'bnb'];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function startLoop() {
  console.log(
    `[${new Date().toISOString()}] Starting Multi-Coin JEV 5-Minute Historical Collector & 30s Worker for: ${SUPPORTED_COINS.map(c => c.toUpperCase()).join(', ')}...`
  );

  // Initialize Telegram alert tracker with existing files so no duplicate spam occurs
  initializeAlertTracker();

  const runCoinRecord = async (coin: string) => {
    try {
      const latest = getLatestHistoricalFile(coin);
      if (latest) {
        const elapsed = Date.now() - latest.timestamp;
        if (elapsed < 240000) {
          // Less than 4 minutes since last file for this specific coin
          return;
        }
      }

      console.log(`[${new Date().toISOString()}] [${coin.toUpperCase()}] Fetching fresh snapshot...`);
      const snapshot = await generateJevSnapshot(coin);
      console.log(`[${new Date().toISOString()}] [${coin.toUpperCase()}] Querying OpenRouter typesafe/jev-1.13...`);
      const prediction = await callJevDecision(snapshot);
      const { filename, skippedDuplicate } = saveHistoricalJevRecord(snapshot, prediction);
      if (!skippedDuplicate) {
        console.log(
          `[${new Date().toISOString()}] 💾 SAVED 5-MIN HISTORICAL RECORD -> ${filename} | Score: ${prediction.score} (${prediction.score_interpretation}) | Direction: ${prediction.direction} (${((prediction.direction_probabilities?.UP || 0) * 100).toFixed(0)}% UP)`
        );
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}] [${coin.toUpperCase()}] Error in 5-min Jev record:`, err.message || err);
    }
  };

  const runAllDueCoins = async () => {
    for (const coin of SUPPORTED_COINS) {
      const latest = getLatestHistoricalFile(coin);
      const elapsed = latest ? Date.now() - latest.timestamp : Infinity;
      if (elapsed >= JEV_RECORD_INTERVAL_MS) {
        await runCoinRecord(coin);
        await sleep(1500); // Gentle pause between OpenRouter calls
      }
    }
  };

  const run30sUpdate = async () => {
    try {
      // 1. Refresh live snapshot cache for all coins
      for (const coin of SUPPORTED_COINS) {
        try {
          await generateJevSnapshot(coin);
        } catch {}
      }

      // 2. Check and collect for any coin that is due for 5-minute file
      await runAllDueCoins();

      const latestBtc = getLatestHistoricalFile('btc');
      const btcElapsed = latestBtc ? Date.now() - latestBtc.timestamp : 0;
      const nextSec = Math.max(0, Math.round((JEV_RECORD_INTERVAL_MS - btcElapsed) / 1000));
      console.log(
        `[${new Date().toISOString()}] Multi-coin JEV live cache refreshed (all ${SUPPORTED_COINS.length} coins) -> next check cycle in ${nextSec}s`
      );
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}] 30s update error:`, err.message || err);
    }
  };

  // On start: run for any coin that has no record within the last 5 minutes
  console.log(`[${new Date().toISOString()}] Initializing startup check for all coins...`);
  await runAllDueCoins();

  // Run the 30s cycle
  setInterval(run30sUpdate, SNAPSHOT_INTERVAL_MS);
}

if (require.main === module) {
  startLoop().catch(console.error);
}

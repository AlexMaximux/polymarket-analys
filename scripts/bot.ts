import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { startTelegramBotListener, formatStatusMessage } from '../src/lib/bot/telegramBot';
import { initializeBotTables } from '../src/lib/bot/db';

async function main() {
  console.log(`[${new Date().toISOString()}] Initializing Polymarket Pulse Trading Bot...`);
  initializeBotTables();

  const status = await formatStatusMessage();
  console.log('--- Bot Initial Status ---');
  console.log(status.replace(/<[^>]*>/g, ''));
  console.log('---------------------------');

  console.log('[BOT] Starting Telegram polling listener...');
  await startTelegramBotListener();
}

main().catch((err) => {
  console.error('[BOT FATAL ERROR]:', err);
  process.exit(1);
});

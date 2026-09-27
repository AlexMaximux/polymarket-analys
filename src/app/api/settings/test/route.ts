import { NextResponse } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import { getSetting } from '@/lib/settings';
import { sendTelegram } from '@/lib/alerts';
import { pingLlm } from '@/lib/llmPing';
import { getOpenRouterCredit } from '@/lib/openrouterCredit';
import { resolveActiveMarket } from '@/lib/bot/executor';
import { normalizePrivateKey } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/** Check saved credentials: Telegram test message, OpenRouter key info (free), or a 5-token LLM ping. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const target = body?.target;
  try {
    if (target === 'telegram') {
      const token = getSetting('jev.telegramToken');
      const chat = getSetting('jev.telegramChat');
      if (!token || !chat) return NextResponse.json({ ok: false, message: 'Save a bot token and chat ID first' });
      const ok = await sendTelegram(token, chat, '✅ Polymarket Pulse: Jev Telegram settings work.');
      return NextResponse.json({ ok, message: ok ? 'Test message sent' : 'Telegram rejected the message — check token and chat ID' });
    }
    if (target === 'openrouter') {
      const c = await getOpenRouterCredit({ fresh: true });
      const left = c.remaining != null ? `$${c.remaining.toFixed(2)} left` : 'no credit limit set';
      return NextResponse.json({ ok: true, message: `Key works — ${left}${c.usage != null ? `, $${c.usage.toFixed(2)} used` : ''}` });
    }
    if (target === 'llm') {
      const baseUrl = getSetting('llm.baseUrl');
      const apiKey = getSetting('llm.apiKey');
      const model = getSetting('llm.model');
      if (!baseUrl || !apiKey || !model) return NextResponse.json({ ok: false, message: 'Save base URL, API key and model first' });
      const r = await pingLlm(baseUrl, apiKey, model);
      return NextResponse.json({ ok: r.ok, message: r.ok ? 'LLM endpoint answered' : r.error || 'failed' });
    }
    if (target === 'bot') {
      const pk = getSetting('bot.privateKey');
      if (!pk) return NextResponse.json({ ok: false, message: 'save a wallet private key first' });
      let address: string;
      try {
        address = privateKeyToAccount(normalizePrivateKey(pk) as `0x${string}`).address;
      } catch {
        return NextResponse.json({ ok: false, message: 'private key is not a valid format' });
      }
      const walletType = getSetting('bot.walletType');
      const proxyAddress = getSetting('bot.proxyAddress');
      const effectiveAddress = walletType === 'POLY_PROXY' && proxyAddress ? proxyAddress : address;
      // Best-effort connectivity check — never blocks the wallet-format result above, and never places an order.
      let marketNote = 'market check skipped';
      try {
        const market = await resolveActiveMarket('btc', '1H', 'UP');
        marketNote = market ? `active 1H BTC market found: ${market.title}` : 'no active 1H market found right now';
      } catch {
        marketNote = 'market check failed (network)';
      }
      return NextResponse.json({ ok: true, message: `Wallet ok: ${effectiveAddress}. ${marketNote}. No order was placed.` });
    }
    if (target === 'bot-telegram') {
      const token = getSetting('bot.telegramToken');
      const chat = getSetting('bot.telegramChatId');
      if (!token || !chat) return NextResponse.json({ ok: false, message: 'Save a bot token and chat ID first' });
      const ok = await sendTelegram(token, chat, '✅ Polymarket Pulse: trading bot Telegram settings work.');
      return NextResponse.json({ ok, message: ok ? 'Test message sent' : 'Telegram rejected the message — check token and chat ID' });
    }
    return NextResponse.json({ ok: false, message: 'unknown test target' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message });
  }
}

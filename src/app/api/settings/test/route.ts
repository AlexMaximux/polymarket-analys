import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';
import { sendTelegram } from '@/lib/alerts';
import { pingLlm } from '@/lib/llmPing';
import { getOpenRouterCredit } from '@/lib/openrouterCredit';

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
    return NextResponse.json({ ok: false, message: 'unknown test target' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message });
  }
}

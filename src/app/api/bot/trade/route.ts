import { NextResponse } from 'next/server';
import { executeSignal, getBotStatus } from '@/lib/bot/executor';
import { parseTradeSignal } from '@/lib/bot/telegramBot';
import type { SignalRequest } from '@/lib/bot/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bot/trade
 * Returns current bot status, wallet, budget limits, and recent trades.
 */
export async function GET() {
  try {
    const status = await getBotStatus();
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch bot status' }, { status: 500 });
  }
}

/**
 * POST /api/bot/trade
 * Direct signal entrypoint for system integration, automated alerts, or webhooks.
 *
 * Supports payload formats:
 * 1) Raw text string signal:
 *    { "signal": "buy: BTCUPDOW/1H/UP" }
 *
 * 2) Structured JSON:
 *    {
 *      "symbol": "BTCUPDOW",
 *      "timeframe": "1H",
 *      "outcome": "UP" | "DOWN",
 *      "amountUsd": 10
 *    }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    let requestData: SignalRequest;

    if (body.signal && typeof body.signal === 'string') {
      const parsed = parseTradeSignal(body.signal);
      if (!parsed) {
        return NextResponse.json(
          { error: 'Invalid signal format. Expected e.g. "buy: BTCUPDOW/1H/UP" or "buy: BTCUPDOW/1H/DOWN"' },
          { status: 400 }
        );
      }
      requestData = {
        symbol: parsed.symbol,
        timeframe: parsed.timeframe,
        outcome: parsed.outcome,
        amountUsd: typeof body.amountUsd === 'number' ? body.amountUsd : undefined,
        source: body.source || 'api',
      };
    } else if (body.symbol && body.outcome) {
      const outcome = body.outcome.toUpperCase();
      if (outcome !== 'UP' && outcome !== 'DOWN') {
        return NextResponse.json({ error: 'outcome must be UP or DOWN' }, { status: 400 });
      }
      requestData = {
        symbol: String(body.symbol).toUpperCase(),
        timeframe: (body.timeframe || '1H').toUpperCase(),
        outcome,
        amountUsd: typeof body.amountUsd === 'number' ? body.amountUsd : undefined,
        source: body.source || 'api',
      };
    } else {
      return NextResponse.json(
        { error: 'Missing signal or { symbol, outcome } parameters' },
        { status: 400 }
      );
    }

    const result = await executeSignal(requestData);

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Execution error' }, { status: 500 });
  }
}

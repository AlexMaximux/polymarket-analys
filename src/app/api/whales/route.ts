import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * TRUE new whales: wallets whose REAL on-chain first trade (true_first_trade_at,
 * resolved by the backfill worker from full activity history) happened within the
 * last N hours, AND whose max single bet exceeds minBet.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hours = Math.max(parseInt(searchParams.get('hours') || '24'), 1);
  const minBet = Math.max(parseFloat(searchParams.get('minBet') || '25000'), 0);
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);

  const db = getDb();
  const threshold = Math.floor(Date.now() / 1000) - hours * 3600;

  const whales = db
    .prepare(
      `SELECT wallet, name, pseudonym, true_first_trade_at, true_first_trade_size,
              max_single_bet, total_notional, trade_count, last_active
       FROM users
       WHERE true_first_checked_at IS NOT NULL
         AND true_first_trade_at IS NOT NULL
         AND true_first_trade_at >= ?
         AND max_single_bet >= ?
       ORDER BY max_single_bet DESC
       LIMIT ?`
    )
    .all(threshold, minBet, limit);

  const pending = (
    db.prepare(`SELECT COUNT(*) as c FROM users WHERE true_first_checked_at IS NULL`).get() as { c: number }
  ).c;
  const checked = (
    db.prepare(`SELECT COUNT(*) as c FROM users WHERE true_first_checked_at IS NOT NULL`).get() as { c: number }
  ).c;

  return NextResponse.json({ whales, pending, checked, hours, minBet });
}

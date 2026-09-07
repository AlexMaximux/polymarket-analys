import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const usersCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as {c:number}).c;
  const tradesCount = (db.prepare('SELECT COUNT(*) as c FROM trades').get() as {c:number}).c;
  const bigBetUsers24h = (db.prepare(`
    SELECT COUNT(*) as c FROM users 
    WHERE max_single_bet >= 100 
    AND last_active >= ?
  `).get(Math.floor(Date.now() / 1000) - 86400) as {c:number}).c;

  return NextResponse.json({
    usersTracked: usersCount,
    tradesStored: tradesCount,
    bigBetUsers24h,
  });
}

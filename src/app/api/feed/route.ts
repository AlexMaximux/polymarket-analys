import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const trades = db.prepare(`
    SELECT t.*, u.name as u_name, u.pseudonym as u_pseudonym 
    FROM trades t 
    LEFT JOIN users u ON t.proxyWallet = u.wallet 
    ORDER BY t.timestamp DESC 
    LIMIT 50
  `).all();
  return NextResponse.json(trades);
}

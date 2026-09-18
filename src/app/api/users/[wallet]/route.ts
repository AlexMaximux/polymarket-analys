import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const db = getDb();
  
  const user = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const trades = db.prepare('SELECT * FROM trades WHERE proxyWallet = ? ORDER BY timestamp DESC LIMIT 50').all(wallet);

  return NextResponse.json({
    user,
    trades
  });
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const db = getDb();
  
  let user = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet) as any;
  let trades = [];
  let isLiveFallback = false;

  if (!user) {
    try {
      const [posRes, valRes, trRes, actRes] = await Promise.allSettled([
        fetch(`https://data-api.polymarket.com/positions?user=${wallet}`),
        fetch(`https://data-api.polymarket.com/value?user=${wallet}`),
        fetch(`https://data-api.polymarket.com/traded?user=${wallet}`),
        fetch(`https://data-api.polymarket.com/activity?user=${wallet}&limit=100`)
      ]);

      const isAnySuccess = [posRes, valRes, trRes, actRes].some(r => r.status === 'fulfilled' && (r.value as Response).ok);
      
      if (!isAnySuccess) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Build fallback user
      const actData = actRes.status === 'fulfilled' && actRes.value.ok ? await actRes.value.json() : [];
      let name = '';
      if (Array.isArray(actData) && actData.length > 0) {
        name = actData[0].name || actData[0].pseudonym || '';
        trades = actData.map((t, i) => ({
          ...t,
          id: `${t.transactionHash || 'tx'}-${t.asset || 'asset'}-${t.timestamp}-${i}`, // synthetic id: raw Polymarket rows have no DB id (React key fix)
          size: Number(t.size),
          price: Number(t.price),
          timestamp: Math.floor(new Date(t.timestamp).getTime() / 1000) || t.timestamp // activity uses ISO strings or Unix?
        }));
        // Clean timestamps if they are strings
        trades = trades.map(t => ({
            ...t,
            timestamp: typeof t.timestamp === 'string' ? Math.floor(new Date(t.timestamp).getTime() / 1000) : t.timestamp
        }))
      }

      const valData = valRes.status === 'fulfilled' && valRes.value.ok ? await valRes.value.json() : { value: 0 };
      // "valData" schema? Not important, we can just map what we can for UI. The UI expects:
      // user.total_notional, user.trade_count, user.max_single_bet, user.buys, user.sells, user.name, user.pseudonym
      
      user = {
        wallet,
        name: name,
        pseudonym: name,
        total_notional: 0,
        trade_count: trades.length,
        max_single_bet: 0,
        buys: trades.filter(t => t.side === 'BUY').length,
        sells: trades.filter(t => t.side === 'SELL').length,
        first_seen: Math.floor(Date.now() / 1000),
        last_active: Math.floor(Date.now() / 1000),
      };
      
      if (trades.length > 0) {
         user.total_notional = trades.reduce((acc, t) => acc + (t.size * t.price), 0);
         user.max_single_bet = Math.max(...trades.map(t => t.size * t.price), 0);
      }

      // Upsert minimal row to users table
      try {
        db.prepare(`
          INSERT INTO users (wallet, name, pseudonym, total_notional, trade_count, buys, sells, first_seen, last_active, max_single_bet)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(wallet) DO NOTHING
        `).run(wallet, name, name, user.total_notional, user.trade_count, user.buys, user.sells, user.first_seen, user.last_active, user.max_single_bet);
      } catch (e) {
        console.error('Failed to upsert fallback user:', e);
      }
      
      isLiveFallback = true;
    } catch (e) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
  } else {
    trades = db.prepare('SELECT * FROM trades WHERE proxyWallet = ? ORDER BY timestamp DESC LIMIT 50').all(wallet);
  }

  return NextResponse.json({
    user,
    trades: trades.slice(0, 50),
    isLiveFallback
  });
}

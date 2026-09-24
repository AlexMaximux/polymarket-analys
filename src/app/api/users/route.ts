import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const newWithinDays = parseInt(searchParams.get('newWithinDays') || '0');
  const minSingleBet = parseFloat(searchParams.get('minSingleBet') || '0');
  const minVolume = parseFloat(searchParams.get('minVolume') || '0');
  const q = searchParams.get('q') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const sortBy = searchParams.get('sortBy') || 'total_notional';
  const order = searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';

  const limit = 50;
  const offset = (page - 1) * limit;

  const db = getDb();

  let query = 'SELECT * FROM users WHERE 1=1';
  const params: any[] = [];

  if (newWithinDays > 0) {
    const threshold = Math.floor(Date.now() / 1000) - (newWithinDays * 24 * 60 * 60);
    query += ' AND first_seen >= ?';
    params.push(threshold);
  }

  if (minSingleBet > 0) {
    query += ' AND max_single_bet >= ?';
    params.push(minSingleBet);
  }

  if (minVolume > 0) {
    query += ' AND total_notional >= ?';
    params.push(minVolume);
  }

  const minTrades = parseInt(searchParams.get('minTrades') || '0');
  if (minTrades > 0) {
    query += ' AND trade_count >= ?';
    params.push(minTrades);
  }

  if (q) {
    query += ' AND (wallet LIKE ? OR name LIKE ? OR pseudonym LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  if (searchParams.get('starred') === '1') {
    query += ' AND starred = 1';
  }

  const validSortColumns = ['total_notional', 'max_single_bet', 'trade_count', 'first_seen', 'last_active', 'starred', 'true_first_trade_at'];
  const sortCol = validSortColumns.includes(sortBy) ? sortBy : 'total_notional';

  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as c');
  const totalRes = db.prepare(countQuery).get(...params) as {c: number};

  query += ` ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const users = db.prepare(query).all(...params) as any[];

  return NextResponse.json({
    data: users,
    pagination: {
      total: totalRes.c,
      page,
      limit,
      totalPages: Math.ceil(totalRes.c / limit)
    }
  });
}

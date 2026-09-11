import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/users/[wallet]/analyze
 * Gathers the wallet's full trading picture (profile + closed positions summary +
 * recent trades + risk stats), sends a structured brief to the configured LLM and
 * returns the markdown analysis. Also caches the last analysis in llm_settings-adjacent
 * table `wallet_analyses` so the UI can show it instantly on revisit.
 */
async function getLlm() {
  const db = getDb();
  const row = db.prepare(`SELECT base_url, api_key, model FROM llm_settings WHERE id = 1`).get() as any;
  return row || null;
}

export async function POST(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet: rawWallet } = await params;
  const wallet = rawWallet.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'valid wallet required' }, { status: 400 });
  }
  const llm = await getLlm();
  if (!llm) return NextResponse.json({ error: 'LLM not configured — set it in Settings' }, { status: 400 });

  // ---- gather data ----
  const app = process.env.PMP_BASE_URL || 'http://127.0.0.1:8000';
  const [closedRes, tradesRes, posRes] = await Promise.all([
    fetch(`${app}/api/users/${wallet}/closed`, { cache: 'no-store' }),
    fetch(`${app}/api/users/${wallet}/trades`, { cache: 'no-store' }),
    fetch(`${app}/api/users/${wallet}/positions`, { cache: 'no-store' }),
  ]);
  const closed = await closedRes.json().catch(() => null);
  const trades = await tradesRes.json().catch(() => null);
  const positions = await posRes.json().catch(() => null);

  const totals = closed?.totals || {};
  const closedTop = (closed?.closed || []).slice(0, 25).map((m: any) => ({
    market: m.title, outcome: m.outcome, invested: Math.round(m.invested),
    gotBack: Math.round(m.gotBack), pnl: Math.round(m.pnl * 100) / 100, result: m.result,
  }));
  const recentTrades = (trades?.trades || []).slice(0, 60).map((t: any) => ({
    date: new Date(t.timestamp * 1000).toISOString().slice(0, 16).replace('T', ' '),
    side: t.type === 'REDEEM' ? 'REDEEM' : t.side, market: t.title, outcome: t.outcome,
    shares: Math.round(t.size), pricePct: Math.round((t.price || 0) * 1000) / 10, usd: Math.round(t.usdcSize),
  }));
  const open = (positions?.positions || []).slice(0, 15).map((p: any) => ({
    market: p.title, outcome: p.outcome, size: Math.round(p.size || 0),
    curPricePct: Math.round((p.curPrice || 0) * 1000) / 10,
    initialValue: Math.round(p.initialValue || 0), currentValue: Math.round(p.currentValue || 0),
  }));
  const resolvedOnHand = (positions?.resolved || []).slice(0, 10).map((p: any) => ({
    market: p.title, outcome: p.outcome, cashPnl: Math.round((p.cashPnl || 0) * 100) / 100,
  }));

  const brief = {
    wallet,
    lifetimeClosed: {
      markets: totals.count ?? 0, wins: totals.wins ?? 0, losses: totals.losses ?? 0,
      invested: Math.round(totals.invested ?? 0), gotBack: Math.round(totals.gotBack ?? 0),
      realizedPnl: Math.round((totals.pnl ?? 0) * 100) / 100,
      note: totals.truncated ? 'capped at most recent 2000 markets' : 'full history',
    },
    openPositions: open,
    resolvedOnHand,
    recentTrades,
    biggestClosedMarkets: closedTop,
  };

  const prompt = `تو یک تحلیلگر باتجربه‌ی بازارهای پیش‌بینی (prediction markets) و کریپتوی هستی.
کل تاریخچه‌ی معاملات این والت Polymarket را تحلیل کن و یک بریفینگ مختصر، صریح و پر از عدد
به زبان فارسی (Farsi) به صورت Markdown بنویس با این بخش‌ها:

## خلاصه (۲-۳ جمله: این معامله‌گر چه تیپی است؟)
## استراتژی و سبک (دسته‌بندی بازارها، ریتم معامله، حجم پوزیشن‌ها، رفتار ورود و خروج)
## نقاط قوت (چه کارهایی را خوب انجام می‌دهد — با اعداد واقعی از داده‌ها)
## نقاط ضعف و ریسک‌ها (ضررها، اهرم ریسک، علائم خطر — به بازارهای مشخص اشاره کن)
## بازارهای قابل‌توجه (۲ تا ۴ پوزیشن جالب یا گویا از بسته‌شده‌ها/بازها و چرا)
## جمع‌بندی نهایی (دنبالش بریم / خلافش شرط ببندیم / فقط رصد — و چه سیگنالی را رصد کنیم)

دقیق باش: به بازارها، اعداد و نتایج واقعی داخل داده‌ها اشاره کن.
اگر داده‌ها کم بود، همین را بگو و چیزی از خودت نساز.
کل پاسخ فقط فارسی باشد (اسم بازارها می‌تواند انگلیسی بماند). داخل code fence نگذار.

داده‌ها (JSON):
${JSON.stringify(brief)}`;

  // ---- call the LLM ----
  let analysis = '';
  try {
    const res = await fetch(`${llm.base_url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.api_key}` },
      body: JSON.stringify({
        model: llm.model,
        stream: false,
        messages: [
          { role: 'system', content: 'You are a professional prediction-market trading analyst.' },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(240_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
    }
    const d = await res.json();
    analysis = d?.choices?.[0]?.message?.content || '';
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'LLM call failed' }, { status: 502 });
  }

  if (!analysis) return NextResponse.json({ error: 'empty LLM response' }, { status: 502 });

  // ---- cache (append — every run is kept as a dated entry) ----
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS wallet_analyses_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    model TEXT,
    analysis TEXT,
    created_at INTEGER
  )`);
  db.prepare(
    `INSERT INTO wallet_analyses_v2 (wallet, model, analysis, created_at) VALUES (?, ?, ?, ?)`
  ).run(wallet, llm.model, analysis, Math.floor(Date.now() / 1000));

  return NextResponse.json({ ok: true, model: llm.model, analysis });
}

export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS wallet_analyses_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    model TEXT,
    analysis TEXT,
    created_at INTEGER
  )`);
  const rows = db.prepare(
    `SELECT id, model, analysis, created_at FROM wallet_analyses_v2 WHERE wallet = ? ORDER BY created_at DESC LIMIT 30`
  ).all(wallet.toLowerCase()) as any[];
  return NextResponse.json({ cached: rows.length > 0, analyses: rows });
}

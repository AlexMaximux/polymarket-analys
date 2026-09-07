import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/updown?coin=btc
 *
 * Live state for the Up/Down markets dashboard:
 *  - active 1H, 15m, 5m Polymarket markets (slug constructed from current time, verified)
 *  - BTC spot prices from Binance: hour open (S0), active-15m open (Sa), latest (St)
 *  - CLOB midpoints for every active market (real-time market prices)
 *  - fair value of the 1H Up market, per user's drift-extraction model:
 *      x_t = ln(St/S0), y = ln(St/Sa)
 *      z = Phi^-1(p15); mu = (z*sigma_m*sqrt(tau15) - y) / tau15
 *      fair = Phi((x_t + mu*tau60) / (sigma_m*sqrt(tau60)))
 *    sigma_1h defaults to 0.02, overridable via ?sigma=
 */

const COINS: Record<string, { binance: string; label: string; slugPrefix: string }> = {
  btc: { binance: 'BTCUSDT', label: 'Bitcoin', slugPrefix: 'btc-updown' },
  eth: { binance: 'ETHUSDT', label: 'Ethereum', slugPrefix: 'eth-updown' },
  sol: { binance: 'SOLUSDT', label: 'Solana', slugPrefix: 'sol-updown' },
  xrp: { binance: 'XRPUSDT', label: 'XRP', slugPrefix: 'xrp-updown' },
  doge: { binance: 'DOGEUSDT', label: 'Dogecoin', slugPrefix: 'doge-updown' },
  hype: { binance: 'HYPEUSDT', label: 'Hyperliquid', slugPrefix: 'hype-updown' },
  zec: { binance: 'ZECUSDT', label: 'ZCash', slugPrefix: 'zec-updown' },
};

function etParts(d: Date) {
  // ET = UTC-4 (EDT, Sep)
  const et = new Date(d.getTime() - 4 * 3600 * 1000);
  const day = et.getUTCDate();
  const hour = et.getUTCHours();
  const h12 = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 ? 'am' : 'pm';
  const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const month = monthNames[et.getUTCMonth()];
  return { day, month, h12, ampm, hour };
}

function normInv(p: number): number {
  // Acklam's inverse normal CDF approximation
  if (p <= 0) return -10; if (p >= 1) return 10;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

function normCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26 via erf approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const dd = 0.3989422804014327 * Math.exp(-x * x / 2);
  const prob = dd * t * (0.319381530 * t + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - prob : prob;
}

async function j(url: string, timeoutMs = 8000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(t); }
}

async function eventBySlug(slug: string) {
  const d = await j(`https://gamma-api.polymarket.com/events?slug=${slug}`);
  if (!Array.isArray(d) || !d.length) return null;
  const m = d[0]?.markets?.[0];
  if (!m) return null;
  const prices = JSON.parse(m.outcomePrices || '["0.5","0.5"]');
  let tokens: string[] = [];
  try { tokens = JSON.parse(m.clobTokenIds || '[]'); } catch {}
  return {
    slug, title: d[0].title, up: parseFloat(prices[0]), down: parseFloat(prices[1]), live: null as number | null, liveDown: null as number | null,
    closed: !!m.closed, accepting: !!m.acceptingOrders,
    endDate: m.endDate, startDate: m.startDate,
    tokenUp: tokens[0] || '', tokenDown: tokens[1] || '',
  };
}

async function clobMid(token: string): Promise<number | null> {
  if (!token) return null;
  const d = await j(`https://clob.polymarket.com/midpoint?token_id=${token}`, 5000);
  return d?.mid ? parseFloat(d.mid) : null;
}

// Polymarket's UI displays the market's official opening price (Chainlink TWAP for 15m/5m,
// exact boundary price for 1h). It's embedded in the event page's dehydrated react-query as
// "openPrice". This is the SAME number the site shows the user (e.g. 79,214.50 for a 15m window).
async function polymarketOpenPrice(slug: string): Promise<number | null> {
  if (!slug) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    const res = await fetch(`https://polymarket.com/event/${slug}`, {
      signal: ctl.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"openPrice\\":([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  } catch { return null; }
}

async function binanceKline(symbol: string, startSec: number): Promise<number | null> {
  const d = await j(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${startSec * 1000}&limit=1`);
  return Array.isArray(d) && d[0] ? parseFloat(d[0][1]) : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const coinKey = (searchParams.get('coin') || 'btc').toLowerCase();
  const cfg = COINS[coinKey];
  if (!cfg) return NextResponse.json({ error: 'unknown coin' }, { status: 400 });
  const sigma1h = Math.min(Math.max(parseFloat(searchParams.get('sigma') || '0.02') || 0.02, 0.002), 0.2);

  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const secIntoHour = nowSec % 3600;
  const t = secIntoHour / 60;                    // minutes into hour (float)
  const hourStartSec = nowSec - secIntoHour;
  const win15Sec = nowSec - (nowSec % 900);
  const win5Sec = nowSec - (nowSec % 300);
  const next15Sec = win15Sec + 900;
  const next5Sec = win5Sec + 300;

  // ---- Polymarket events (constructed slugs, hour/15m/5m) ----
  const { month, day, h12, ampm, hour } = etParts(now);
  const hourSlug = `bitcoin-up-or-down-${month}-${day}-2026-${h12}${ampm}-et`
    .replace('bitcoin', cfg.slugPrefix.split('-')[0] === 'btc' ? 'bitcoin' : cfg.label.toLowerCase());
  const genericHourSlug = cfg.slugPrefix.split('-')[0] === 'btc'
    ? `bitcoin-up-or-down-${month}-${day}-2026-${h12}${ampm}-et`
    : `${cfg.slugPrefix.split('-')[0]}-up-or-down-${month}-${day}-2026-${h12}${ampm}-et`;

  const [m1h, m15, m5, n15, n5] = await Promise.all([
    eventBySlug(genericHourSlug),
    eventBySlug(`${cfg.slugPrefix}-15m-${win15Sec}`),
    eventBySlug(`${cfg.slugPrefix}-5m-${win5Sec}`),
    eventBySlug(`${cfg.slugPrefix}-15m-${next15Sec}`),
    eventBySlug(`${cfg.slugPrefix}-5m-${next5Sec}`),
  ]);

  // ---- Opening prices: Polymarket's official values (Chainlink TWAP / boundary) from event pages;
  //      fallback: Binance 1m kline opens. St = Binance ticker (live). ----
  const [s0pm, sapm, sa5pm, s0b, sab, sa5b, stRaw] = await Promise.all([
    m1h ? polymarketOpenPrice(m1h.slug) : Promise.resolve(null),
    m15 ? polymarketOpenPrice(m15.slug) : Promise.resolve(null),
    m5 ? polymarketOpenPrice(m5.slug) : Promise.resolve(null),
    binanceKline(cfg.binance, hourStartSec),
    binanceKline(cfg.binance, win15Sec),
    binanceKline(cfg.binance, win5Sec),
    j(`https://api.binance.com/api/v3/ticker/price?symbol=${cfg.binance}`, 5000),
  ]);
  const s0 = s0pm ?? s0b;
  const sa = sapm ?? sab;
  const sa5 = sa5pm ?? sa5b;
  const st = stRaw?.price ? parseFloat(stRaw.price) : null;

  // ---- CLOB midpoints (true live market prices) ----
  const [mid1hUp, mid1hDn, mid15Up, mid15Dn, mid5Up, mid5Dn] = await Promise.all([
    m1h ? clobMid(m1h.tokenUp) : Promise.resolve(null),
    m1h ? clobMid(m1h.tokenDown) : Promise.resolve(null),
    m15 ? clobMid(m15.tokenUp) : Promise.resolve(null),
    m15 ? clobMid(m15.tokenDown) : Promise.resolve(null),
    m5 ? clobMid(m5.tokenUp) : Promise.resolve(null),
    m5 ? clobMid(m5.tokenDown) : Promise.resolve(null),
  ]);
  if (m1h) { m1h.live = mid1hUp ?? (mid1hDn != null ? 1 - mid1hDn : null); m1h.liveDown = mid1hDn ?? (mid1hUp != null ? 1 - mid1hUp : null); }
  if (m15) { m15.live = mid15Up ?? (mid15Dn != null ? 1 - mid15Dn : null); m15.liveDown = mid15Dn ?? (mid15Up != null ? 1 - mid15Up : null); }
  if (m5) { m5.live = mid5Up ?? (mid5Dn != null ? 1 - mid5Dn : null); m5.liveDown = mid5Dn ?? (mid5Up != null ? 1 - mid5Up : null); }

  // ---- Fair value models (same drift-extraction, calibrated on 15m and 5m markets separately) ----
  const p15 = m15?.live ?? m15?.up ?? null;
  const p5 = m5?.live ?? m5?.up ?? null;
  let model: any = null;
  let model5: any = null;
  const sigmaM = sigma1h / Math.sqrt(60);
  const a = 15 * Math.floor(t / 15);
  const q = t - a;
  const tau15 = 15 - q;
  const tau60 = 60 - t;
  const xt = s0 && st ? Math.log(st / s0) : null;
  const y = xt != null && sa && st != null ? Math.log(st / sa) : null;
  const a5 = 5 * Math.floor(t / 5);
  const q5 = t - a5;
  const tau5 = 5 - q5;
  const y5 = xt != null && sa5 && st != null ? Math.log(st / sa5) : null;

  if (s0 && st && p15 && p15 > 0.001 && p15 < 0.999 && xt != null && y != null) {
    const z15 = normInv(p15);
    const mu = tau15 > 0.01 ? (z15 * sigmaM * Math.sqrt(tau15) - y) / tau15 : 0;
    const fair = normCdf((xt + mu * tau60) / (sigmaM * Math.sqrt(tau60)));
    model = {
      t, a, q, tau15, tau60, sigma1h, sigmaM,
      s0, sa, st, xt, y, p15, z15, mu,
      fairUp: fair, fairDown: 1 - fair,
      market1hUp: m1h?.live ?? m1h?.up ?? null,
      edge: m1h?.live != null ? fair - (m1h.live as number) : null,   // fair - market (>0 = Up underpriced)
    };
  }

  // 5m-calibrated variant: drift implied by the live 5-minute market
  if (s0 && st && p5 && p5 > 0.001 && p5 < 0.999 && xt != null && y5 != null) {
    const z5 = normInv(p5);
    const mu5 = tau5 > 0.01 ? (z5 * sigmaM * Math.sqrt(tau5) - y5) / tau5 : 0;
    const fair5 = normCdf((xt + mu5 * tau60) / (sigmaM * Math.sqrt(tau60)));
    model5 = {
      a5, q5, tau5, y5, p5, z5, mu5,
      sa5,
      fairUp: fair5, fairDown: 1 - fair5,
      edge: m1h?.live != null ? fair5 - (m1h.live as number) : null,
    };
  }

  return NextResponse.json({
    coin: coinKey, label: cfg.label, binanceSymbol: cfg.binance,
    openSources: { s0: s0pm ? 'polymarket-chainlink' : 'binance', sa: sapm ? 'polymarket-chainlink' : 'binance' },
    serverTime: nowSec, t, hourStartSec, win15Sec, win5Sec, next15Sec, next5Sec,
    m1h, m15, m5, n15, n5, model, model5, sa5,
  });
}

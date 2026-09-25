import fs from 'fs';
import path from 'path';
import { sendTelegram } from './alerts';

export const JEV_TELEGRAM_BOT_TOKEN =
  process.env.JEV_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';

export const JEV_TELEGRAM_CHAT_ID =
  process.env.JEV_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';

const ALERTS_TRACKER_FILE = path.join(process.cwd(), 'jev', 'alerts_sent.json');

/** Load or initialize the list of alerted filenames to prevent duplicates */
function loadSentAlerts(): Set<string> {
  try {
    if (fs.existsSync(ALERTS_TRACKER_FILE)) {
      const data = JSON.parse(fs.readFileSync(ALERTS_TRACKER_FILE, 'utf8'));
      if (Array.isArray(data)) {
        return new Set(data);
      }
    }
  } catch (e) {
    console.error('Error loading sent Jev alerts tracker:', e);
  }
  return new Set();
}

/** Save alerted filenames to tracker file */
function saveSentAlert(filename: string) {
  try {
    const sent = loadSentAlerts();
    sent.add(filename);
    const jevDir = path.join(process.cwd(), 'jev');
    if (!fs.existsSync(jevDir)) {
      fs.mkdirSync(jevDir, { recursive: true });
    }
    fs.writeFileSync(ALERTS_TRACKER_FILE, JSON.stringify(Array.from(sent), null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving sent Jev alerts tracker:', e);
  }
}

/**
 * Initialize tracker on first startup:
 * If alerts_sent.json does NOT exist, mark all existing historical files as already seen
 * so we do not spam 100+ past alerts to Telegram!
 */
export function initializeAlertTracker() {
  if (!fs.existsSync(ALERTS_TRACKER_FILE)) {
    try {
      const historyDir = path.join(process.cwd(), 'jev', 'history');
      if (fs.existsSync(historyDir)) {
        const files = fs.readdirSync(historyDir).filter((f) => f.endsWith('.json'));
        const jevDir = path.join(process.cwd(), 'jev');
        if (!fs.existsSync(jevDir)) fs.mkdirSync(jevDir, { recursive: true });
        fs.writeFileSync(ALERTS_TRACKER_FILE, JSON.stringify(files, null, 2), 'utf8');
        console.log(`[JEV ALERTS] Initialized tracker with ${files.length} existing historical files.`);
      }
    } catch (e) {
      console.error('Error initializing alert tracker:', e);
    }
  }
}

export interface JevSignalResult {
  isSignal: boolean;
  type?: 'BULLISH' | 'BEARISH';
  score?: number;
  confidence?: number;
  direction?: string;
  rule?: string;
}

/**
 * Evaluate if a Jev record matches the exact conditional rules:
 * - BULLISH (تیک آبی): Jev Score > 3.5 AND Score Confidence >= 90% (0.90)
 * - BEARISH (تیک قرمز): Jev Score < 0.5 AND Score Confidence >= 90% (0.90)
 */
export function evaluateJevRecordSignal(record: any): JevSignalResult {
  const p = record?.prediction;
  if (!p || p.score == null) {
    return { isSignal: false };
  }

  const score = Number(p.score);

  // Extract score_confidence strictly (0 to 1 converted to 0-100)
  let rawConf = p.score_confidence;
  if (rawConf == null && p.raw_decision?.answers?.one_hour_score?.confidence != null) {
    rawConf = p.raw_decision.answers.one_hour_score.confidence;
  }

  if (rawConf == null) {
    return { isSignal: false };
  }

  const confPercent = Number(rawConf) <= 1 ? Number(rawConf) * 100 : Number(rawConf);

  // Strict Bullish check: Score > 3.5 AND Confidence >= 90%
  if (score > 3.5 && confPercent >= 90) {
    return {
      isSignal: true,
      type: 'BULLISH',
      score,
      confidence: Math.round(confPercent),
      direction: p.direction || 'UP',
      rule: 'Jev Score > 3.5 && Score Confidence ≥ 90%',
    };
  }

  // Strict Bearish check: Score < 0.5 AND Confidence >= 90%
  if (score < 0.5 && confPercent >= 90) {
    return {
      isSignal: true,
      type: 'BEARISH',
      score,
      confidence: Math.round(confPercent),
      direction: p.direction || 'DOWN',
      rule: 'Jev Score < 0.5 && Score Confidence ≥ 90%',
    };
  }

  return { isSignal: false };
}

/**
 * Helper to format coin spot price nicely with appropriate decimals
 */
export function formatCoinPrice(price: number | null | undefined): string {
  if (price == null || isNaN(price) || price <= 0) return '—';
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  } else {
    return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
}

/**
 * Fallback fetcher for spot price if missing in record
 */
export async function fetchSpotPriceFallback(coin: string): Promise<number | null> {
  const c = coin.toUpperCase();
  try {
    if (c === 'HYPE') {
      const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=HYPE-USDT', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (res.ok) {
        const d = await res.json();
        const p = parseFloat(d.data?.[0]?.last);
        if (!isNaN(p) && p > 0) return p;
      }
    } else {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${c}USDT`);
      if (res.ok) {
        const d = await res.json();
        const p = parseFloat(d.price);
        if (!isNaN(p) && p > 0) return p;
      }
    }
  } catch {}
  return null;
}

/**
 * Fallback fetcher for 1-hour open price (Price to Beat) if missing in record
 */
export async function fetchOpenPriceFallback(coin: string): Promise<number | null> {
  const c = coin.toUpperCase();
  try {
    if (c === 'HYPE') {
      const res = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=HYPEUSDT&interval=1h&limit=1');
      if (res.ok) {
        const d = await res.json();
        const p = parseFloat(d?.[0]?.[1]);
        if (!isNaN(p) && p > 0) return p;
      }
      const okxRes = await fetch('https://www.okx.com/api/v5/market/candles?instId=HYPE-USDT&bar=1H&limit=1', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (okxRes.ok) {
        const d = await okxRes.json();
        const p = parseFloat(d.data?.[0]?.[1]);
        if (!isNaN(p) && p > 0) return p;
      }
    } else {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${c}USDT&interval=1h&limit=1`);
      if (res.ok) {
        const d = await res.json();
        const p = parseFloat(d?.[0]?.[1]);
        if (!isNaN(p) && p > 0) return p;
      }
    }
  } catch {}
  return null;
}

/**
 * Format Telegram HTML message for Jev Signal
 */
export function formatTelegramSignalMessage(
  record: any,
  filename: string,
  signal: { type: 'BULLISH' | 'BEARISH'; score: number; confidence: number },
  spotPriceOverride?: number | null,
  openPriceOverride?: number | null
): string {
  const isBullish = signal.type === 'BULLISH';
  const headerIcon = isBullish ? '🔵' : '🔴';
  const signalTitle = isBullish
    ? 'تیک آبی (سیگنال صعودی / Bullish)'
    : 'تیک قرمز (سیگنال نزولی / Bearish)';

  const coin = (record.coin || 'BTC').toUpperCase();
  const coinLabel = record.coin_label || coin;
  const p = record.prediction || {};
  const cards = record.cards || {};
  const fv = record.fair_values || {};

  // Extract spot price
  const spotPrice =
    spotPriceOverride != null
      ? spotPriceOverride
      : record.spot_price != null
      ? Number(record.spot_price)
      : record.spotPrice != null
      ? Number(record.spotPrice)
      : record.model?.st != null
      ? Number(record.model.st)
      : null;

  // Extract open price / Price To Beat
  const openPrice =
    openPriceOverride != null
      ? openPriceOverride
      : record.price_to_beat != null
      ? Number(record.price_to_beat)
      : record.open_price != null
      ? Number(record.open_price)
      : record.openPrice != null
      ? Number(record.openPrice)
      : record.model?.s0 != null
      ? Number(record.model.s0)
      : null;

  // Build price comparison block
  let priceBlock = `💵 <b>قیمت لحظه‌ای (Spot Price):</b> <code>$${formatCoinPrice(spotPrice)}</code>\n`;
  if (openPrice != null && openPrice > 0) {
    priceBlock += `🎯 <b>قیمت مبنا (Price To Beat / Open):</b> <code>$${formatCoinPrice(openPrice)}</code>\n`;
    if (spotPrice != null && spotPrice > 0) {
      const diff = spotPrice - openPrice;
      const pct = ((diff / openPrice) * 100).toFixed(2);
      const sign = diff >= 0 ? '+' : '';
      const statusIcon = diff >= 0 ? '🟢' : '🔴';
      const statusText = diff >= 0 ? 'بالاتر از مبنا (Up)' : 'پایین‌تر از مبنا (Down)';
      priceBlock += `📊 <b>فاصله تا مبنا:</b> <code>${sign}$${formatCoinPrice(Math.abs(diff))} (${sign}${pct}%)</code> ${statusIcon} <i>${statusText}</i>\n`;
    }
  }

  const scoreText = Number(signal.score).toFixed(2);
  const interpretation = p.score_interpretation || (isBullish ? 'Strong Up' : 'Strong Down');
  const direction = p.direction || (isBullish ? 'UP' : 'DOWN');

  const probUp =
    p.direction_probabilities?.UP != null
      ? (p.direction_probabilities.UP * 100).toFixed(0) + '%'
      : '—';
  const probDown =
    p.direction_probabilities?.DOWN != null
      ? (p.direction_probabilities.DOWN * 100).toFixed(0) + '%'
      : '—';

  const up1h = cards['1h']?.up_display || (cards['1h']?.up != null ? (cards['1h'].up * 100).toFixed(1) + '%' : '—');
  const down1h = cards['1h']?.down_display || (cards['1h']?.down != null ? (cards['1h'].down * 100).toFixed(1) + '%' : '—');
  const up15m = cards['15m']?.up_display || '—';
  const fair15m = fv.model_15m != null ? (fv.model_15m * 100).toFixed(1) + '%' : '—';

  return (
    `${headerIcon} <b>هشدار سیگنال Jev — ${signalTitle}</b>\n\n` +
    `🪙 <b>ارز:</b> <b>${coinLabel} (${coin})</b>\n` +
    `${priceBlock}\n` +
    `📊 <b>امتیاز هوش مصنوعی (Score):</b> <code>${scoreText} / 4.0</code>\n` +
    `🎯 <b>درصد اطمینان اسکور:</b> <code>${signal.confidence}%</code> (قانون: بالای ۹۰٪)\n` +
    `🧭 <b>جهت و احتمالات:</b> <b>${direction}</b> (صعود: ${probUp} | نزول: ${probDown})\n` +
    `⚡ <b>تفسیر وضعیت:</b> ${interpretation}\n\n` +
    `📈 <b>داده‌های لحظه‌ای بازار Polymarket:</b>\n` +
    `• قیمت ۱ ساعته: UP: <b>${up1h}</b> | DOWN: <b>${down1h}</b>\n` +
    `• بازار ۱۵ دقیقه‌ای: UP: <b>${up15m}</b>\n` +
    `• ارزش منصفانه (Fair Value 15m): <b>${fair15m}</b>\n\n` +
    `⏰ <b>زمان اسنپ‌شات (ET):</b> <code>${record.et_time || record.current_time_et || 'Now'}</code>\n` +
    `📁 <b>فایل:</b> <code>${filename}</code>\n` +
    `🔍 <b>مشاهده در داشبورد:</b> <a href="http://localhost:8000/jev-analysis?coin=${coin.toLowerCase()}">ورود به منحنی تحلیل Jev</a>`
  );
}

/**
 * Check if the record qualifies for an alert, and send Telegram notification if not already sent.
 */
export async function checkAndSendJevSignalAlert(
  record: any,
  filename: string
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const signal = evaluateJevRecordSignal(record);
    if (!signal.isSignal || !signal.type || signal.score == null || signal.confidence == null) {
      return { sent: false, reason: 'Does not match signal criteria' };
    }

    const sentSet = loadSentAlerts();
    if (sentSet.has(filename)) {
      return { sent: false, reason: 'Already alerted for this file' };
    }

    // Resolve spot price
    let spotPrice = record.spot_price != null ? Number(record.spot_price) : null;
    if (spotPrice == null || isNaN(spotPrice) || spotPrice <= 0) {
      spotPrice = await fetchSpotPriceFallback(record.coin || 'BTC');
    }

    // Resolve open price / price to beat
    let openPrice =
      record.price_to_beat != null
        ? Number(record.price_to_beat)
        : record.open_price != null
        ? Number(record.open_price)
        : null;
    if (openPrice == null || isNaN(openPrice) || openPrice <= 0) {
      openPrice = await fetchOpenPriceFallback(record.coin || 'BTC');
    }

    const message = formatTelegramSignalMessage(
      record,
      filename,
      {
        type: signal.type,
        score: signal.score,
        confidence: signal.confidence,
      },
      spotPrice,
      openPrice
    );

    console.log(`[JEV TELEGRAM ALERT] Firing ${signal.type} alert for ${record.coin || 'BTC'} (${filename})...`);
    const ok = await sendTelegram(JEV_TELEGRAM_BOT_TOKEN, JEV_TELEGRAM_CHAT_ID, message);

    if (ok) {
      saveSentAlert(filename);
      console.log(`[JEV TELEGRAM ALERT] ✅ Alert successfully delivered to Telegram chat ${JEV_TELEGRAM_CHAT_ID}!`);
      return { sent: true };
    } else {
      console.error(`[JEV TELEGRAM ALERT] ❌ Telegram API call failed for file ${filename}`);
      return { sent: false, reason: 'Telegram API returned error' };
    }
  } catch (err: any) {
    console.error('[JEV TELEGRAM ALERT] Exception during alert evaluation:', err.message || err);
    return { sent: false, reason: err.message };
  }
}

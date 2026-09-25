import fs from 'fs';
import path from 'path';
import { fetchUpdownSnapshot } from './updownSnapshot';
import { checkAndSendJevSignalAlert } from './jevAlerts';

export const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || '';

function getCard(row: any) {
  if (!row) return null;
  const up = row.live ?? row.up ?? null;
  const down = row.liveDown ?? (up != null ? 1 - up : null);
  return {
    title: row.title ?? null,
    slug: row.slug ?? null,
    status: row.accepting ? 'OPEN' : 'CLOSED',
    up: up != null ? Number(up.toFixed(4)) : null,
    down: down != null ? Number(down.toFixed(4)) : null,
    up_display: up != null ? `${(up * 100).toFixed(1)}%` : null,
    down_display: down != null ? `${(down * 100).toFixed(1)}%` : null,
  };
}

export const COIN_NAMES: Record<string, string> = {
  btc: 'Bitcoin',
  eth: 'Ethereum',
  sol: 'Solana',
  xrp: 'XRP',
  doge: 'Dogecoin',
  hype: 'Hyperliquid',
  zec: 'ZCash',
  bnb: 'BNB',
};

export async function generateJevSnapshot(coin = 'btc') {
  const coinKey = (coin || 'btc').toLowerCase();
  const coinLabel = COIN_NAMES[coinKey] || coinKey.toUpperCase();
  const data = await fetchUpdownSnapshot(coinKey);
  if (!data) {
    throw new Error(`Failed to fetch Up/Down data for ${coinLabel} (${coinKey}) from internal API`);
  }

  const now = new Date();
  const timeET = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const timeET24 = now.toLocaleTimeString('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateET = now.toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });

  const m1h = data.m1h;
  const m15 = data.m15;
  const m5 = data.m5;

  const fair15m = data.model?.fairUp != null ? Number(data.model.fairUp.toFixed(4)) : null;
  const fair5m = data.model5?.fairUp != null ? Number(data.model5.fairUp.toFixed(4)) : null;
  const fairBase = data.modelA?.fairUp != null ? Number(data.modelA.fairUp.toFixed(4)) : null;
  const fairJoint = data.modelC?.valid && data.modelC?.fairUp != null ? Number(data.modelC.fairUp.toFixed(4)) : null;

  const spotPrice = data.spotPrice != null ? Number(data.spotPrice) : data.model?.st != null ? Number(data.model.st) : null;
  const openPrice = data.openPrice != null ? Number(data.openPrice) : data.model?.s0 != null ? Number(data.model.s0) : null;

  const payload = {
    et_time: `${dateET} ${timeET24} ET`,
    date_et: dateET,
    current_time_et: timeET,
    current_time_et_24h: timeET24,
    timestamp: now.toISOString(),
    coin: coinKey.toUpperCase(),
    coin_label: coinLabel,
    spot_price: spotPrice,
    open_price: openPrice,
    price_to_beat: openPrice,
    cards: {
      '1h': getCard(m1h),
      '15m': getCard(m15),
      '5m': getCard(m5),
    },
    fair_values: {
      model_15m: fair15m,
      model_5m: fair5m,
      base_no_drift: fairBase,
      joint_solve: fairJoint,
    },
  };

  const jsonStr = JSON.stringify(payload, null, 2);

  const jevDir = path.join(process.cwd(), 'jev');
  const publicJevDir = path.join(process.cwd(), 'public', 'jev');

  for (const dir of [jevDir, publicJevDir]) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, `${coinKey}_updown.json`), jsonStr, 'utf8');
      if (coinKey === 'btc') {
        fs.writeFileSync(path.join(dir, 'latest.json'), jsonStr, 'utf8');
        fs.writeFileSync(path.join(dir, 'data.json'), jsonStr, 'utf8');
      }
    } catch {}
  }

  return payload;
}

export async function callJevDecision(snapshotData: any, apiKey?: string) {
  const key = apiKey || OPENROUTER_API_KEY;
  const coinLabel = snapshotData.coin_label || snapshotData.coin || 'Crypto';

  const payload = {
    model: 'typesafe/jev-1.13',
    state: {
      et_time: snapshotData.et_time,
      coin: snapshotData.coin,
      coin_label: coinLabel,
      cards: snapshotData.cards,
      fair_values: snapshotData.fair_values,
    },
    questions: {
      one_hour_score: {
        type: 'score',
        instructions:
          `Predict the 1-hour ${coinLabel} outcome score on an ordered scale (0 to 4) from Strong Down to Strong Up based on current market probabilities and fair values.`,
        criteria: [
          'Strong Down',
          'Lean Down',
          'Neutral',
          'Lean Up',
          'Strong Up',
        ],
      },
      one_hour_direction: {
        type: 'choice',
        instructions:
          `Which direction is more probable for ${coinLabel} 1-hour market close?`,
        criteria: {
          UP: `${coinLabel} is more likely to close above the hour open price.`,
          DOWN: `${coinLabel} is more likely to close below the hour open price.`,
        },
      },
    },
  };

  const res = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter Jev error (${res.status}): ${errText}`);
  }

  const decision = await res.json();
  const answers = decision.answers || {};
  const scoreRaw = answers.one_hour_score?.score;
  const score = scoreRaw != null ? Number(Number(scoreRaw).toFixed(2)) : null;

  let scoreInterpretation = 'نامشخص';
  if (score != null) {
    if (score >= 3.0) scoreInterpretation = 'Strong Up (صعودی قوی) 🚀';
    else if (score >= 2.2) scoreInterpretation = 'Lean Up (تمایل به صعود) ↗';
    else if (score >= 1.8) scoreInterpretation = 'Neutral (خنثی / تعادل) ⚖';
    else if (score >= 1.0) scoreInterpretation = 'Lean Down (تمایل به نزول) ↘';
    else scoreInterpretation = 'Strong Down (نزولی قوی) 🔻';
  }

  return {
    model: decision.model || 'typesafe/jev-1.13',
    coin: snapshotData.coin,
    score,
    score_interpretation: scoreInterpretation,
    score_confidence: answers.one_hour_score?.confidence ?? null,
    score_probabilities: answers.one_hour_score?.probabilities ?? null,
    direction: answers.one_hour_direction?.choice ?? null,
    direction_confidence: answers.one_hour_direction?.confidence ?? null,
    direction_probabilities: answers.one_hour_direction?.probabilities ?? null,
    tokens: decision.usage?.input_tokens ?? null,
    cost: decision.usage?.cost ?? null,
    raw_decision: decision,
  };
}

export function getLatestHistoricalFile(coin?: string): { filename: string; timestamp: number } | null {
  try {
    const historyDir = path.join(process.cwd(), 'jev', 'history');
    if (!fs.existsSync(historyDir)) return null;
    const prefix = coin ? `${coin.toLowerCase()}_` : '';
    const files = fs
      .readdirSync(historyDir)
      .filter(f => f.endsWith('.json') && (!prefix || f.toLowerCase().startsWith(prefix)))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    const latestFile = files[0];
    const stat = fs.statSync(path.join(historyDir, latestFile));
    try {
      const data = JSON.parse(fs.readFileSync(path.join(historyDir, latestFile), 'utf8'));
      if (data.timestamp) {
        const t = new Date(data.timestamp).getTime();
        if (!isNaN(t) && t > 0) {
          return { filename: latestFile, timestamp: t };
        }
      }
    } catch {}
    return { filename: latestFile, timestamp: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function saveHistoricalJevRecord(snapshotData: any, prediction: any, force = false) {
  const coinKey = (snapshotData.coin || 'btc').toLowerCase();
  const safeTime = snapshotData.current_time_et_24h.replace(/:/g, '-');
  const filename = `${coinKey}_updown_${snapshotData.date_et}_${safeTime}_ET.json`;

  const fullRecord = {
    et_time: snapshotData.et_time,
    date_et: snapshotData.date_et,
    current_time_et: snapshotData.current_time_et,
    current_time_et_24h: snapshotData.current_time_et_24h,
    timestamp: snapshotData.timestamp,
    coin: snapshotData.coin,
    coin_label: snapshotData.coin_label || snapshotData.coin,
    spot_price: snapshotData.spot_price != null ? Number(snapshotData.spot_price) : null,
    open_price: snapshotData.open_price != null ? Number(snapshotData.open_price) : null,
    price_to_beat: snapshotData.open_price != null ? Number(snapshotData.open_price) : null,
    cards: snapshotData.cards,
    fair_values: snapshotData.fair_values,
    prediction,
  };

  const jsonStr = JSON.stringify(fullRecord, null, 2);

  const jevDir = path.join(process.cwd(), 'jev');
  const historyDir = path.join(jevDir, 'history');
  const publicJevDir = path.join(process.cwd(), 'public', 'jev');
  const publicHistoryDir = path.join(publicJevDir, 'history');

  for (const d of [jevDir, historyDir, publicJevDir, publicHistoryDir]) {
    try {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
      }
    } catch {}
  }

  // DEBOUNCE GUARD: Check if a file was created for this specific coin within the last 4 minutes (240s)
  const latest = getLatestHistoricalFile(coinKey);
  if (!force && latest) {
    const elapsedMs = Date.now() - latest.timestamp;
    if (elapsedMs < 240000) { // 4 minutes
      try {
        fs.writeFileSync(path.join(jevDir, `${coinKey}_updown.json`), jsonStr, 'utf8');
        if (coinKey === 'btc') {
          fs.writeFileSync(path.join(jevDir, 'latest.json'), jsonStr, 'utf8');
        }
      } catch {}
      return { filename: latest.filename, fullRecord, skippedDuplicate: true };
    }
  }

  // 1. Save timestamped file in jev/ and jev/history/ (NEVER OVERWRITTEN - KEPT FOREVER)
  fs.writeFileSync(path.join(historyDir, filename), jsonStr, 'utf8');
  fs.writeFileSync(path.join(jevDir, filename), jsonStr, 'utf8');

  // Also in public for direct HTTP access if desired
  try {
    fs.writeFileSync(path.join(publicHistoryDir, filename), jsonStr, 'utf8');
    fs.writeFileSync(path.join(publicJevDir, filename), jsonStr, 'utf8');
  } catch {}

  // 2. Also update live cache so the latest state has prediction
  fs.writeFileSync(path.join(jevDir, `${coinKey}_updown.json`), jsonStr, 'utf8');
  if (coinKey === 'btc') {
    fs.writeFileSync(path.join(jevDir, 'latest.json'), jsonStr, 'utf8');
  }

  // 3. Check for Blue Tick (Bullish) or Red Tick (Bearish) and send Telegram alert
  try {
    checkAndSendJevSignalAlert(fullRecord, filename).catch(err => {
      console.error('[JEV ALERT] Background alert error:', err);
    });
  } catch (err) {
    console.error('[JEV ALERT] Error invoking alert check:', err);
  }

  return { filename, fullRecord, skippedDuplicate: false };
}

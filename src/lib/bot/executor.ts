import { ClobClient, Side, OrderType, SignatureType } from '@polymarket/clob-client';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import {
  getBotBudgetLimits,
  getTotalSpent,
  recordBotTrade,
  getRecentTrades,
} from './db';
import { clampTradeAmount } from './risk';
import { getSetting } from '../settings';
import type {
  SignalRequest,
  ActiveMarketInfo,
  TradeResult,
  BotStatus,
  TradeOutcome,
} from './types';

const CLOB_HOST = 'https://clob.polymarket.com';
const POLYGON_CHAIN_ID = 137;
const DEFAULT_RPC = 'https://polygon-rpc.com';

/** Build the hourly slug according to ET (Eastern Time) convention */
export function buildHourlyEtSlug(coin = 'btc', targetDate = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    hour12: true,
  }).formatToParts(targetDate);

  const month = parts.find((p) => p.type === 'month')?.value.toLowerCase() || '';
  const day = parts.find((p) => p.type === 'day')?.value || '';
  const year = parts.find((p) => p.type === 'year')?.value || '';
  const hour12 = parts.find((p) => p.type === 'hour')?.value || '';
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value.toLowerCase() || '';

  const coinWord = coin.toLowerCase() === 'btc' ? 'bitcoin' : coin.toLowerCase() === 'eth' ? 'ethereum' : coin.toLowerCase();
  return `${coinWord}-up-or-down-${month}-${day}-${year}-${hour12}${dayPeriod}-et`;
}

/** Fetch live market info for coin and timeframe (e.g. 1H BTC) */
export async function resolveActiveMarket(coin = 'btc', timeframe = '1H', outcome: TradeOutcome = 'UP'): Promise<ActiveMarketInfo | null> {
  const normalizedCoin = coin.toLowerCase().replace(/updow.*$/, '').replace(/[^a-z]/g, '') || 'btc';
  const slug = buildHourlyEtSlug(normalizedCoin);

  // 1. Try Gamma API directly
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'PolymarketPulseBot/1.0' },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const event = data[0];
        const market = event.markets?.[0];
        if (market) {
          let tokens: string[] = [];
          try {
            tokens = JSON.parse(market.clobTokenIds || '[]');
          } catch {}

          const tokenUp = tokens[0] || '';
          const tokenDown = tokens[1] || '';

          // Fetch orderbook for both tokens
          const clobClient = new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID);
          const [bookUp, bookDown] = await Promise.all([
            tokenUp ? clobClient.getOrderBook(tokenUp).catch(() => null) : Promise.resolve(null),
            tokenDown ? clobClient.getOrderBook(tokenDown).catch(() => null) : Promise.resolve(null),
          ]);

          const getBestPrices = (book: any) => {
            if (!book) return { bestAsk: null, bestBid: null };
            const asks = (book.asks || []).map((a: any) => parseFloat(a.price)).filter((p: number) => !isNaN(p));
            const bids = (book.bids || []).map((b: any) => parseFloat(b.price)).filter((p: number) => !isNaN(p));
            return {
              bestAsk: asks.length ? Math.min(...asks) : null,
              bestBid: bids.length ? Math.max(...bids) : null,
            };
          };

          const upPrices = getBestPrices(bookUp);
          const downPrices = getBestPrices(bookDown);

          const selectedTokenId = outcome === 'UP' ? tokenUp : tokenDown;
          const selectedBestAsk = outcome === 'UP' ? upPrices.bestAsk : downPrices.bestAsk;

          return {
            slug,
            title: event.title || `${normalizedCoin.toUpperCase()} Up or Down 1H`,
            coin: normalizedCoin,
            timeframe: timeframe.toUpperCase(),
            endDate: market.endDate,
            acceptingOrders: market.acceptingOrders !== false && !market.closed,
            closed: !!market.closed,
            tokenUp,
            tokenDown,
            bestAskUp: upPrices.bestAsk,
            bestBidUp: upPrices.bestBid,
            bestAskDown: downPrices.bestAsk,
            bestBidDown: downPrices.bestBid,
            selectedTokenId,
            selectedBestAsk,
          };
        }
      }
    }
  } catch (err) {
    console.error('Error resolving market via Gamma API:', err);
  }

  // 2. Fallback to local /api/updown
  try {
    const base = process.env.PMP_BASE_URL || 'http://127.0.0.1:8000';
    const res = await fetch(`${base}/api/updown?coin=${normalizedCoin}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const m1h = data.m1h;
      if (m1h) {
        const selectedTokenId = outcome === 'UP' ? m1h.tokenUp : m1h.tokenDown;
        const selectedBestAsk = outcome === 'UP' ? (m1h.book?.ask ?? m1h.live) : (1 - (m1h.book?.bid ?? m1h.live));
        return {
          slug: m1h.slug || slug,
          title: m1h.title || `${normalizedCoin.toUpperCase()} Up or Down 1H`,
          coin: normalizedCoin,
          timeframe: '1H',
          endDate: m1h.endDate || '',
          acceptingOrders: m1h.accepting !== false && !m1h.closed,
          closed: !!m1h.closed,
          tokenUp: m1h.tokenUp,
          tokenDown: m1h.tokenDown,
          bestAskUp: m1h.book?.ask ?? m1h.live,
          bestBidUp: m1h.book?.bid ?? null,
          bestAskDown: m1h.liveDown ?? (m1h.live != null ? 1 - m1h.live : null),
          bestBidDown: null,
          selectedTokenId,
          selectedBestAsk,
        };
      }
    }
  } catch (err) {
    console.error('Error resolving market via local API:', err);
  }

  return null;
}

/** Get wallet status and configuration (all from /control settings, see src/lib/settings.ts) */
export function getBotWalletConfig() {
  const privateKey = getSetting('bot.privateKey');
  const walletType = getSetting('bot.walletType');
  const proxyAddress = getSetting('bot.proxyAddress');

  let address: string | null = null;
  if (privateKey) {
    try {
      const formattedKey = privateKey.startsWith('0x') ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`);
      const account = privateKeyToAccount(formattedKey);
      address = walletType === 'POLY_PROXY' && proxyAddress ? proxyAddress : account.address;
    } catch {
      address = null;
    }
  }

  return {
    privateKey,
    walletType,
    proxyAddress,
    address,
    isConfigured: !!privateKey && !!address,
  };
}

/**
 * Main execution function:
 * Evaluates budget limits, resolves active market, executes trade (simulated or live CLOB),
 * logs trade in SQLite, and returns comprehensive result.
 */
export async function executeSignal(signal: SignalRequest): Promise<TradeResult> {
  const now = Date.now();

  // 0. Kill switch — the single choke point for both the Telegram "buy:" command and
  // POST /api/bot/trade. Off by default; must be turned on explicitly from /control.
  if (!getSetting('bot.enabled')) {
    const errorMsg = 'ربات معامله‌گر غیرفعال است. برای فعال‌سازی به Control → Trading Bot بروید. (bot disabled)';
    recordBotTrade({
      timestamp: now,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: '',
      token_id: '',
      amount_usd: signal.amountUsd || 0,
      shares: null,
      price: null,
      status: 'FAILED',
      order_id: null,
      tx_hash: null,
      source: signal.source || 'telegram',
      error_message: errorMsg,
    });
    return {
      success: false,
      simulated: true,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      amountUsd: signal.amountUsd || 0,
      totalSpentAfter: getTotalSpent(),
      maxBudget: getBotBudgetLimits().maxBudget,
      remainingBudget: 0,
      error: errorMsg,
      timestamp: now,
    };
  }

  const limits = getBotBudgetLimits();
  const totalSpentBefore = getTotalSpent();
  // never let a caller-supplied amountUsd exceed the configured per-trade cap
  const tradeAmount = clampTradeAmount(signal.amountUsd, limits.perTrade);

  // 1. Budget check
  if (totalSpentBefore + tradeAmount > limits.maxBudget) {
    const errorMsg = `🛑 سقف بودجه کل پر شده است! (خرج‌شده: $${totalSpentBefore.toFixed(2)} | سقف کل: $${limits.maxBudget.toFixed(2)} | سفارش جدید: $${tradeAmount.toFixed(2)})`;
    recordBotTrade({
      timestamp: now,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: '',
      token_id: '',
      amount_usd: tradeAmount,
      shares: null,
      price: null,
      status: 'FAILED',
      order_id: null,
      tx_hash: null,
      source: signal.source || 'telegram',
      error_message: errorMsg,
    });

    return {
      success: false,
      simulated: limits.simulationMode,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      amountUsd: tradeAmount,
      totalSpentAfter: totalSpentBefore,
      maxBudget: limits.maxBudget,
      remainingBudget: Math.max(0, limits.maxBudget - totalSpentBefore),
      error: errorMsg,
      timestamp: now,
    };
  }

  // 2. Resolve Active Market
  const coin = signal.symbol.toLowerCase().replace(/updow.*$/, '') || 'btc';
  const market = await resolveActiveMarket(coin, signal.timeframe, signal.outcome);

  if (!market) {
    const errorMsg = `❌ بازار فعال ۱ ساعته برای ${signal.symbol} پیدا نشد.`;
    recordBotTrade({
      timestamp: now,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: '',
      token_id: '',
      amount_usd: tradeAmount,
      shares: null,
      price: null,
      status: 'FAILED',
      order_id: null,
      tx_hash: null,
      source: signal.source || 'telegram',
      error_message: errorMsg,
    });

    return {
      success: false,
      simulated: limits.simulationMode,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      amountUsd: tradeAmount,
      totalSpentAfter: totalSpentBefore,
      maxBudget: limits.maxBudget,
      remainingBudget: Math.max(0, limits.maxBudget - totalSpentBefore),
      error: errorMsg,
      timestamp: now,
    };
  }

  if (!market.acceptingOrders || market.closed) {
    const errorMsg = `⚠️ بازار ${market.title} بسته شده و سفارش نمی‌پذیرد.`;
    recordBotTrade({
      timestamp: now,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: market.slug,
      token_id: market.selectedTokenId,
      amount_usd: tradeAmount,
      shares: null,
      price: null,
      status: 'FAILED',
      order_id: null,
      tx_hash: null,
      source: signal.source || 'telegram',
      error_message: errorMsg,
    });

    return {
      success: false,
      simulated: limits.simulationMode,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: market.slug,
      tokenId: market.selectedTokenId,
      amountUsd: tradeAmount,
      totalSpentAfter: totalSpentBefore,
      maxBudget: limits.maxBudget,
      remainingBudget: Math.max(0, limits.maxBudget - totalSpentBefore),
      error: errorMsg,
      timestamp: now,
    };
  }

  const fillPrice = market.selectedBestAsk || 0.5;
  const shares = Number((tradeAmount / fillPrice).toFixed(4));
  const totalSpentAfter = totalSpentBefore + tradeAmount;
  const remainingBudget = Math.max(0, limits.maxBudget - totalSpentAfter);

  const walletConfig = getBotWalletConfig();

  // 3. Execution: Simulation Mode
  if (limits.simulationMode || !walletConfig.isConfigured) {
    const simOrderId = `sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    recordBotTrade({
      timestamp: now,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: market.slug,
      token_id: market.selectedTokenId,
      amount_usd: tradeAmount,
      shares,
      price: fillPrice,
      status: 'SIMULATED',
      order_id: simOrderId,
      tx_hash: null,
      source: signal.source || 'telegram',
      error_message: null,
    });

    return {
      success: true,
      simulated: true,
      orderId: simOrderId,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: market.slug,
      tokenId: market.selectedTokenId,
      amountUsd: tradeAmount,
      shares,
      price: fillPrice,
      totalSpentAfter,
      maxBudget: limits.maxBudget,
      remainingBudget,
      timestamp: now,
    };
  }

  // 4. Execution: Live CLOB Trading
  try {
    const formattedKey = walletConfig.privateKey.startsWith('0x')
      ? (walletConfig.privateKey as `0x${string}`)
      : (`0x${walletConfig.privateKey}` as `0x${string}`);

    const account = privateKeyToAccount(formattedKey);
    const rpcUrl = getSetting('bot.rpcUrl') || DEFAULT_RPC;
    const walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: http(rpcUrl),
    });

    let sigType = SignatureType.EOA;
    if (walletConfig.walletType === 'POLY_PROXY') sigType = SignatureType.POLY_PROXY;
    if (walletConfig.walletType === 'POLY_GNOSIS_SAFE') sigType = SignatureType.POLY_GNOSIS_SAFE;

    const funderAddress = walletConfig.proxyAddress || undefined;

    // Check optional provided API creds
    const apiKey = process.env.POLYMARKET_API_KEY?.trim();
    const apiSecret = process.env.POLYMARKET_API_SECRET?.trim();
    const passphrase = process.env.POLYMARKET_PASSPHRASE?.trim();

    let client: ClobClient;
    if (apiKey && apiSecret && passphrase) {
      client = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        walletClient,
        { key: apiKey, secret: apiSecret, passphrase },
        sigType,
        funderAddress
      );
    } else {
      client = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        walletClient,
        undefined,
        sigType,
        funderAddress
      );
      // Automatically derive or create L2 API key via EIP-712 signature
      const creds = await client.createOrDeriveApiKey();
      client = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        walletClient,
        creds,
        sigType,
        funderAddress
      );
    }

    // Submit Market Order (FOK)
    const orderResponse = await client.createAndPostMarketOrder({
      tokenID: market.selectedTokenId,
      amount: tradeAmount,
      side: Side.BUY,
      orderType: OrderType.FOK,
    });

    const orderId = orderResponse?.orderID || orderResponse?.id || `ord_${Date.now()}`;
    const txHash = orderResponse?.transactionHash || null;

    recordBotTrade({
      timestamp: now,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: market.slug,
      token_id: market.selectedTokenId,
      amount_usd: tradeAmount,
      shares,
      price: fillPrice,
      status: 'FILLED',
      order_id: orderId,
      tx_hash: txHash,
      source: signal.source || 'telegram',
      error_message: null,
    });

    return {
      success: true,
      simulated: false,
      orderId,
      txHash,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: market.slug,
      tokenId: market.selectedTokenId,
      amountUsd: tradeAmount,
      shares,
      price: fillPrice,
      totalSpentAfter,
      maxBudget: limits.maxBudget,
      remainingBudget,
      timestamp: now,
    };
  } catch (err: any) {
    const errorMsg = `خطا در ارسال سفارش به CLOB: ${err.message || String(err)}`;
    console.error('CLOB Order execution failed:', err);

    recordBotTrade({
      timestamp: now,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: market.slug,
      token_id: market.selectedTokenId,
      amount_usd: tradeAmount,
      shares: null,
      price: fillPrice,
      status: 'FAILED',
      order_id: null,
      tx_hash: null,
      source: signal.source || 'telegram',
      error_message: errorMsg,
    });

    return {
      success: false,
      simulated: false,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      outcome: signal.outcome,
      slug: market.slug,
      tokenId: market.selectedTokenId,
      amountUsd: tradeAmount,
      totalSpentAfter: totalSpentBefore,
      maxBudget: limits.maxBudget,
      remainingBudget: Math.max(0, limits.maxBudget - totalSpentBefore),
      error: errorMsg,
      timestamp: now,
    };
  }
}

/** Get overall bot status for Telegram or UI */
export async function getBotStatus(): Promise<BotStatus> {
  const limits = getBotBudgetLimits();
  const totalSpent = getTotalSpent();
  const remainingBudget = Math.max(0, limits.maxBudget - totalSpent);
  const walletConfig = getBotWalletConfig();
  const recentTrades = getRecentTrades(5);

  let activeMarket = null;
  try {
    const m = await resolveActiveMarket('btc', '1H', 'UP');
    if (m) {
      activeMarket = {
        slug: m.slug,
        title: m.title,
        bestAskUp: m.bestAskUp,
        bestAskDown: m.bestAskDown,
      };
    }
  } catch {}

  return {
    walletAddress: walletConfig.address,
    walletType: walletConfig.walletType,
    isConfigured: walletConfig.isConfigured,
    simulationMode: limits.simulationMode,
    maxTotalBudget: limits.maxBudget,
    totalSpent,
    remainingBudget,
    perTradeAmount: limits.perTrade,
    totalTradesCount: recentTrades.length,
    recentTrades,
    activeMarket,
  };
}

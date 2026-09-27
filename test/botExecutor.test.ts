import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as dbModule from '../src/lib/db';
import { applySettingChanges } from '../src/lib/settings';
import { executeSignal, getBotWalletConfig } from '../src/lib/bot/executor';
import { getRecentTrades } from '../src/lib/bot/db';

const TEST_PRIVATE_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Resolves a market via the *local* /api/updown fallback only — never touches the Gamma API or
// ClobClient's own HTTP calls, so these tests need no real network access.
function mockLocalMarketFetch() {
  global.fetch = vi.fn((url: string | URL) => {
    const u = String(url);
    if (u.includes('gamma-api.polymarket.com')) {
      return Promise.resolve(new Response('[]', { status: 200 }));
    }
    if (u.includes('/api/updown')) {
      const m1h = {
        slug: 'test-btc-1h', title: 'Test BTC 1H', tokenUp: 'tok-up', tokenDown: 'tok-down',
        accepting: true, closed: false, live: 0.5, liveDown: 0.5, book: { ask: 0.55, bid: 0.45 },
      };
      return Promise.resolve(new Response(JSON.stringify({ m1h }), { status: 200 }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  }) as any;
}

describe('executeSignal', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    dbModule.initializeDb(db);
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db);
    global.fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('refuses to trade while the kill switch is off, without resolving any market', async () => {
    // bot.enabled defaults to false
    const res = await executeSignal({ symbol: 'BTC', timeframe: '1H', outcome: 'UP', source: 'api' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/disabled/i);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getRecentTrades(1)[0].status).toBe('FAILED');
  });

  it('clamps a caller-supplied amountUsd to the configured per-trade cap', async () => {
    mockLocalMarketFetch();
    applySettingChanges({ 'bot.enabled': true, 'bot.perTradeAmount': 10 }, db);
    const res = await executeSignal({ symbol: 'BTC', timeframe: '1H', outcome: 'UP', amountUsd: 9999, source: 'api' });
    expect(res.success).toBe(true);
    expect(res.simulated).toBe(true);
    expect(res.amountUsd).toBe(10);
    expect(getRecentTrades(1)[0]).toMatchObject({ amount_usd: 10, status: 'SIMULATED' });
  });

  it('honours a requested amount under the cap', async () => {
    mockLocalMarketFetch();
    applySettingChanges({ 'bot.enabled': true, 'bot.perTradeAmount': 10 }, db);
    const res = await executeSignal({ symbol: 'BTC', timeframe: '1H', outcome: 'UP', amountUsd: 3, source: 'api' });
    expect(res.amountUsd).toBe(3);
  });

  it('still enforces the total budget cap after the per-trade clamp', async () => {
    mockLocalMarketFetch();
    applySettingChanges({ 'bot.enabled': true, 'bot.maxBudget': 5, 'bot.perTradeAmount': 5 }, db);
    const first = await executeSignal({ symbol: 'BTC', timeframe: '1H', outcome: 'UP', source: 'api' });
    expect(first.success).toBe(true); // spends the full $5 budget (simulated)

    const second = await executeSignal({ symbol: 'BTC', timeframe: '1H', outcome: 'UP', source: 'api' });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/بودجه/);
  });

  it('derives the wallet address from a saved private key', () => {
    applySettingChanges({ 'bot.privateKey': TEST_PRIVATE_KEY }, db);
    const cfg = getBotWalletConfig();
    expect(cfg.address).toBe(TEST_ADDRESS);
    expect(cfg.isConfigured).toBe(true);
  });

  it('reports not configured with no private key saved', () => {
    expect(getBotWalletConfig().isConfigured).toBe(false);
  });
});

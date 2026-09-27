import { describe, it, expect } from 'vitest';
import { clampTradeAmount } from '../src/lib/bot/risk';

// A caller (Telegram command or the /api/bot/trade POST body) may pass an amountUsd override.
// It must never be able to place a single trade larger than the configured per-trade cap —
// that cap is the only thing standing between a $10 default trade and a $100 (full-budget) trade.
describe('clampTradeAmount', () => {
  it('uses the per-trade cap when no amount is requested', () => {
    expect(clampTradeAmount(undefined, 10)).toBe(10);
    expect(clampTradeAmount(0, 10)).toBe(10);
    expect(clampTradeAmount(-5, 10)).toBe(10);
  });

  it('honours a requested amount smaller than the cap', () => {
    expect(clampTradeAmount(3, 10)).toBe(3);
  });

  it('clamps a requested amount larger than the cap down to the cap', () => {
    expect(clampTradeAmount(99, 10)).toBe(10);
  });

  it('honours a requested amount exactly at the cap', () => {
    expect(clampTradeAmount(10, 10)).toBe(10);
  });
});

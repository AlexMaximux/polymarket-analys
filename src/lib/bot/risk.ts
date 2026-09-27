/**
 * Never let a caller-supplied trade amount exceed the configured per-trade cap. Both the Telegram
 * "buy:" command and POST /api/bot/trade accept an optional amountUsd override, and without this
 * clamp a single call could spend up to the entire remaining budget in one trade.
 */
export function clampTradeAmount(requestedUsd: number | undefined, perTradeCap: number): number {
  const requested = requestedUsd && requestedUsd > 0 ? requestedUsd : perTradeCap;
  return Math.min(requested, perTradeCap);
}

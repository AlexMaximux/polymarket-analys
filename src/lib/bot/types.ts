export type TradeOutcome = 'UP' | 'DOWN';

export interface SignalRequest {
  symbol: string;        // e.g. "BTCUPDOW" or "BTC"
  timeframe: string;     // e.g. "1H", "15M", "5M"
  outcome: TradeOutcome; // "UP" | "DOWN"
  amountUsd?: number;    // optional override, otherwise per_trade_amount
  source?: 'telegram' | 'api' | 'signal' | 'manual';
}

export interface ActiveMarketInfo {
  slug: string;
  title: string;
  coin: string;
  timeframe: string;
  endDate: string;
  acceptingOrders: boolean;
  closed: boolean;
  tokenUp: string;
  tokenDown: string;
  bestAskUp: number | null;
  bestBidUp: number | null;
  bestAskDown: number | null;
  bestBidDown: number | null;
  selectedTokenId: string;
  selectedBestAsk: number | null;
}

export interface TradeResult {
  success: boolean;
  simulated: boolean;
  orderId?: string;
  txHash?: string;
  symbol: string;
  timeframe: string;
  outcome: TradeOutcome;
  slug?: string;
  tokenId?: string;
  amountUsd: number;
  shares?: number;
  price?: number;
  totalSpentAfter: number;
  maxBudget: number;
  remainingBudget: number;
  error?: string;
  timestamp: number;
}

export interface BotStatus {
  enabled: boolean;
  walletAddress: string | null;
  walletType: 'EOA' | 'POLY_PROXY' | 'POLY_GNOSIS_SAFE';
  isConfigured: boolean;
  simulationMode: boolean;
  maxTotalBudget: number;
  totalSpent: number;
  remainingBudget: number;
  perTradeAmount: number;
  totalTradesCount: number;
  recentTrades: TradeRecord[];
  activeMarket?: {
    slug: string;
    title: string;
    bestAskUp: number | null;
    bestAskDown: number | null;
  } | null;
}

export interface TradeRecord {
  id: number;
  timestamp: number;
  symbol: string;
  timeframe: string;
  outcome: TradeOutcome;
  slug: string;
  token_id: string;
  amount_usd: number;
  shares: number | null;
  price: number | null;
  status: 'FILLED' | 'SIMULATED' | 'FAILED';
  order_id: string | null;
  tx_hash: string | null;
  source: string;
  error_message: string | null;
}

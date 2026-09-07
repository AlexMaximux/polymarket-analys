# Polymarket Pulse — Whale Hunter 🐋

A local dashboard + alerting system for hunting **new whales** on [Polymarket](https://polymarket.com): wallets whose **first-ever on-chain trade** happened recently with a large bet, plus full real-money profiling of any tracked wallet.

> داشبورد و سیستم هشدار محلی برای شکار «نهنگ‌های تازه» پلی‌مارکت — کیف‌پول‌هایی که اولین معامله‌ی آن‌چین‌شان اخیراً انجام شده و شرط‌بندی بزرگی داشته‌اند.

---

## Why this exists / چرا این ابزار ساخته شد

Polymarket's own APIs don't tell you who is *new*. This tool solves the real whale-hunting questions:

- **Is this wallet genuinely new?** Polymarket exposes no signup date. We resolve each wallet's **true first-ever trade** by querying its full on-chain activity ledger (`/activity?sortBy=TIMESTAMP&sortDirection=ASC&type=TRADE&limit=1` — the oldest trade is literally the first row).
- **What is a wallet's real money flow?** Polymarket's "PnL" is mark-to-market accounting. Whale hunters care about **actual cash**: how much went in, how much came back, per position and lifetime.
- **Tell me the moment something happens.** Telegram alerts for new whales and for watchlisted wallets opening positions.

## Architecture / معماری

```
┌────────────┐   every 30s    ┌───────────┐
│ /trades    │───────────────▶│  crawler  │──▶ SQLite (users, trades)
│ global feed│                └───────────┘
└────────────┘
┌────────────┐   one request per wallet
│ /activity  │───────────────▶ backfill worker ──▶ true_first_trade_at / _size
│ (ASC query)│
└────────────┘
┌────────────┐   every 60s
│  alert     │───────────────▶ alert worker ──▶ Telegram bot
│  rules     │   new_whale rules  +  starred_open rules (watchlist)
└────────────┘
```

- **Crawler** (`npm run crawl`): polls the global trade feed every ~30s, upserts users/trades into SQLite. Filters out non-trade rows (`side` must be BUY/SELL) — the raw feed sometimes carries REDEEM/rebate rows that poison aggregates.
- **Backfill worker** (`npm run backfill`): for every tracked wallet without a verified first trade, resolves `true_first_trade_at` / `true_first_trade_size` and marks it checked. This is the ground truth for "new whale" detection — *not* the crawler's `first_seen` (which only records when *our crawler* first saw the wallet).
- **Alert worker** (`npm run alerts`): evaluates all enabled rules every 60s and pushes Telegram messages via bot API.

## Key API discoveries / نکات مهم API (یادگرفته به سختی)

| Discovery | Why it matters |
|---|---|
| `data-api /positions` returns **only currently-held** positions | Wallets that exited via SELL or REDEEM vanish from it — you can't study their profitability from it |
| `data-api /activity` supports `sortBy=TIMESTAMP&sortDirection=ASC&type=TRADE` | The oldest trade = **first row** → true first trade in ONE request (no deep pagination, which 400s past ~10k rows) |
| In `/positions`, `redeemable=true` means the market is **resolved (dead)** | Classify open vs resolved by `redeemable`, NOT `curPrice` — a winner awaiting redemption has a frozen `curPrice > 0` |
| `user-pnl-api` PnL is mark-to-market | Real cashflow must be computed from the ledger: per `(conditionId, outcome)`: `invested = Σ BUY`, `returned = Σ SELL + Σ REDEEM`, `pnl = returned − invested` |
| Profitable SELL-exits never appear in `/positions` | Whale profitability views must come from the activity ledger |
| Global `/trades` feed sometimes carries rows with `side=''` / `price=0` (REDEEM echoes) | Filter `side IN ('BUY','SELL')` before inserting, or aggregates get poisoned |
| urllib (Python) gets 403/400 | Use curl; retry transient 400s with backoff |

## Features / قابلیت‌ها

### Pages
- **`/` Dashboard** — live trade feed + tracked-user metrics.
- **`/whales` New Whales** — wallets whose **first-ever on-chain trade** happened within the last N hours (1/6/24/72/168) with max single bet ≥ threshold (default $25k, editable). Shows the first-bet size and date.
- **`/users` User Directory** — searchable/sortable directory with ⭐ star column and "Starred only" filter.
- **`/users/[wallet]` Profile** —
  - **Realized Profit (all-time)** card: Closed History net + Resolved-on-hand result — real cashflow, not mark-to-market.
  - **Current Positions (Live)** — held positions with live markets (matches polymarket.com's "Open").
  - **Resolved Positions** — settled markets still on hand (lost, or REDEEMABLE winners).
  - **Closed Positions History** — every fully-exited market (sold or redeemed), rebuilt from the activity ledger: `Invested / Got Back / WON / Total Traded` — same accounting as polymarket.com's positions tab, down to the cent.
  - **Trade History** — the wallet's complete trade ledger live from Polymarket (not crawler cache).
  - Every table is sortable by clicking headers; every section is **collapsible** (long tables don't stretch the page).
  - ⭐ **Star button** to add the wallet to your watchlist.
- **`/alerts`** — Telegram alert rules:
  - **🐋 New whale** — first-ever trade within N hours & max bet ≥ $X.
  - **⭐ Watchlist opens position** — fires when any watched (or starred) wallet opens a **new position**.
  - Each rule: Test (connectivity), Run now, Pause/Resume, Delete. Dedupe per rule: each whale/position fires **once** even across restarts; dedupe marks are written only **after** a successful Telegram send, and long messages are auto-chunked (Telegram's 4096-char limit).

### Alert message sample
```
🚨 New whale > $25k in 24h
Rule: first-ever trade within last 24h & max single bet ≥ $25,000
1 new whale:

🐋 Thrifty-Brother-Deputy
• First-ever bet: $25,000 (2026-09-06 18:20 UTC)
• Max single bet: $25,000
• Total volume: $25,000
• https://polymarket.com/profile/0xde31…
```

### Money Flow Graph (`/flow`)

Paste 2-6 wallet addresses: an interactive graph shows each wallet as a node (lifetime net PnL under it) and shared markets as edges (edge number = how many markets both wallets bet on). Click any edge to drill into the exact trades both wallets made on every shared market - sides, sizes, prices, timestamps, redeems, and who entered first ("led"). This exposes money circulation between related wallets (same-side copy trading, opposing-side hedging, or round-tripping).

#### نمودار گردش پول

2 ta 6 address-e keif-pool vared konid: nemoodar-e taamoli har keif-pool ra besoorat gereh neshan midahad (sood/ziyan-e kol zir-e aan) va baazaar-haye moshtarak ra be soorat khat (adad rooy-e khat = tedaad-e baazaar-e moshtarak). Ba klik rooy-e har khat, taraakonsh-haye daghigh-e har do keif-pool rooy-e hame-ye baazaar-haye moshtarak baaz mishavad - jahat, hajm, gheymat, zaman, bardasht-ha va inke che kasi zoodtar vared shode. In ghabilat gardesh-e pool bein-e keif-pool-haye mortabet ra aashkaar mikonand.

### Running / اجرا


```bash
npm install

# three long-running processes (separate terminals or tmux):
npm run dev        # dashboard on :3000
npm run crawl      # feed poller
npm run backfill   # true-first-trade resolver
npm run alerts     # alert evaluator
```

Create your first alert at `/alerts` → fill Telegram bot token + chat ID → **Test**.

## Data model / مدل داده

- `users` — wallet, name/pseudonym, crawler `first_seen`, **`true_first_trade_at/_size`** (verified from history), aggregates (`trade_count`, `total_notional`, `max_single_bet`, …), `starred` flag.
- `trades` — crawler-seen trades with `dedupe_id` uniqueness (txHash-conditionId-timestamp-size-price-side).
- `alerts` — rules (`alert_type`: `new_whale` | `starred_open`), Telegram target, enabled flag.
- `alert_wallets` — watchlist wallets per `starred_open` alert.
- `alert_seen` / `alert_pos_seen` — dedupe ledgers (marked after successful send only).

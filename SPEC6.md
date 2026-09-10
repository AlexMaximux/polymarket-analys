# POLYMARKET PULSE — SPEC 6 (FILTER + CHARTS + LEADERBOARD FIX)

**EXISTING working app** (Next.js 15 + Tailwind v4 dark dashboard, SQLite via better-sqlite3, crawler). Surgical changes only; preserve all existing functionality, styling system (navy-ink dark theme, tabular-nums, badges), and the 4 existing vitest tests.

## TASK 1 — Min Trades filter on /users
Add a **"MIN TRADES"** number input to the filter bar (same styling as Min Single Bet / Min Volume, default empty/0). Wire it through:
- `/api/users` route: accept `minTrades` query param → `WHERE trade_count >= ?`
- `/users` page state + fetch URL
- Keep all existing filters working together (q, newWithinDays, minSingleBet, minVolume, minTrades, sort, page).

## TASK 2 — Performance charts on /users/[wallet]
Add a **charts section** to the user profile page, rendered **client-side with a tiny hand-rolled SVG line chart component (NO chart libraries, NO CDN — pure React + SVG)**. Charts derived from the user's stored trades in the local DB (`/trades` rows for that wallet) + live positions:
1. **Cumulative PnL % curve**: starting at 0, each trade updates a simple mark-to-market estimate — for each BUY at price p of size s: cost += s*p; value += s*current_price_of_that_outcome... SIMPLER AND HONEST: build equity curve from trade timestamps: running `net_flow = Σ(sell proceeds) − Σ(buy cost)` and running `position_value` using the latest traded price per asset as proxy mark. Chart shows **portfolio value + realized flow (cumulative $ deployed vs $ recovered)** and a second line **PnL % = (recovered+marked − deployed)/deployed × 100**.
2. **Cumulative $ volume over time** (line, area fill).
3. **Daily bet-size histogram** (bars: avg single-bet $ per active day, last 30 days).
Data endpoint: `GET /api/users/[wallet]/chart` → `{series:[{t, deployed, recovered, markValue, pnlPct, dayVolume, betCount}], generatedAt}` computed from DB trades (fallback: if wallet has no stored trades, fetch last 500 trades from `https://data-api.polymarket.com/activity?user=<wallet>&limit=500` server-side, cache in DB `trades` table best-effort, then compute).
Chart UX: one card per chart with title + current value badge; hover shows tooltip with date+values (simple mouse-position nearest-point); x-axis time labels (3-4 ticks), y-axis $ or % labels; cyan primary line, emerald/rose for +/-; empty-state message when no data. All numbers tabular-nums.
**Honesty rule**: label the section "Estimated from stored trade history — mark-to-market uses last traded price" so users know it's an approximation.

## TASK 3 — Fix leaderboard → profile "User not found"
Root cause (verified): `/users/[wallet]` only renders users present in the local SQLite `users` table; leaderboard wallets were never crawled → "User not found".
Fix: in the profile page/API, when wallet is NOT in DB:
1. Fetch live from public APIs server-side: `https://data-api.polymarket.com/positions?user=<w>`, `.../value?user=<w>`, `.../traded?user=<w>`, `.../activity?user=<w>&limit=100`.
2. Render a **"Not yet tracked by crawler" banner** (amber, with a "Track now" note that the next crawl cycle will pick them up if they trade) and show the LIVE data: portfolio value, markets traded, current positions table, recent activity table. Stats grid shows what's available (N/A where unknown) — never a dead-end "User not found" page.
3. If ALL live fetches fail (bad wallet / network), THEN show the styled not-found page.
4. Best-effort: upsert a minimal `users` row (wallet, first_seen=now, name from activity) so repeat visits are fast.

## QUALITY GATES — all previous gates STILL pass + new
1. `npm run build` → zero errors.
2. `npx vitest run` → existing 4 tests pass + NEW tests: (a) minTrades filter SQL builder, (b) chart series builder (given fixture trades, correct deployed/recovered/pnlPct math), (c) leaderboard-fallback logic: unknown wallet with mocked live-API responses returns live view model.
3. Live checks (curl): `/api/users?minTrades=5` filters correctly; `/users/<leaderboard-wallet>` returns 200 with live positions (NOT "User not found"); `/api/users/<wallet>/chart` returns valid JSON series for a crawled wallet.
4. No new npm dependencies.

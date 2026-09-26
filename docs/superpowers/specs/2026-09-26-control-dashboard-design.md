# Control Dashboard + Security Hardening — Design

Date: 2026-09-26
Status: approved in conversation, pending written-spec review

## 1. Intent

Polymarket Pulse is an analytics and Telegram-alerting app. It does not hold private keys or place orders. It runs as five separate processes (the Next.js web app plus the `crawl`, `backfill`, `alerts` and `jev` workers) that the owner currently starts by hand in terminals. Configuration is split between `.env.local`, hardcoded constants and a few SQLite tables.

The owner wants a web page to:

- start, stop and restart the workers, and see their live logs;
- see whether each worker is alive **and** actually doing work;
- edit settings (API keys, Telegram target, coins, models, intervals) without editing files.

Constraints stated by the owner:

- The dashboard is used **from this Mac only**. No login is required.
- Process control is done by a **custom supervisor** (approach A), not by Next.js itself and not by pm2.
- No new npm dependencies (existing project convention).

A security review of the current code found problems that must be fixed first, because a page that can start and stop processes must not be reachable from the network or from other websites.

### Success criteria

1. `npm run supervisor` starts the web app and all autostart workers; Ctrl+C stops everything with no orphan processes.
2. Killing a worker with `kill -9` results in an automatic restart that is visible on `/control`.
3. A worker in a crash loop stops being restarted after 5 crashes in 5 minutes and is shown as `crashed`.
4. Changing a setting on `/control` restarts only the affected workers, and the new value takes effect.
5. No API response contains a secret in clear text.
6. `curl http://192.168.1.141:8000/` (LAN address) fails; a cross-origin POST to any `/api/*` route is rejected with 403.
7. `npx tsc --noEmit`, `npx vitest run` and `npm run build` pass.

## 2. Security review findings (to be fixed in step 1)

| # | Finding | Location |
|---|---------|----------|
| S1 | Server listens on all interfaces (`*:8000`); every page and API is reachable from the LAN with no authentication. Verified from `192.168.1.141:8000`. | `package.json` scripts |
| S2 | `GET /api/alerts` returns `telegram_token` and `telegram_chat` for every alert rule. | `src/app/api/alerts/route.ts:8` |
| S3 | No CSRF protection. Route handlers parse JSON regardless of `Content-Type` and do not check `Origin`, so any website can POST to `localhost:8000`. | all write routes |
| S4 | `/api/jev/predict` triggers paid OpenRouter calls through a plain GET (`?force=true`), accepts `apiKey` in the query string, and puts an unvalidated `coin` into a file path. | `src/app/api/jev/predict/route.ts` |
| S5 | `PUT /api/llm` accepts any base URL (SSRF); the stored URL is a raw IP over plain HTTP (`http://178.104.62.47:20128/v1`), so the key and wallet data travel unencrypted to an unidentified host. | `src/app/api/llm/route.ts` |
| S6 | `wallet` path parameter under `/api/users/[wallet]/*` is interpolated into upstream URLs without validation. | `src/app/api/users/[wallet]/*` |

Positive findings: prepared statements everywhere, no `eval`/`exec`/`dangerouslySetInnerHTML`, `.env.local` and `polymarket.db` never committed, typecheck clean, 44/44 tests pass.

### Fixes

1. `dev` and `start` scripts become `next dev -H 127.0.0.1 -p 8000` and `next start -H 127.0.0.1 -p 8000`.
2. New `src/proxy.ts` (Next.js 16 renamed Middleware to Proxy), matcher `/api/:path*`:
   - Reject with 403 any request whose `Host` hostname is not `localhost` or `127.0.0.1` (any port, so a dev-server port fallback keeps working; defends against DNS rebinding).
   - For non-GET/HEAD requests: if an `Origin` header is present and its host (hostname + port) is not identical to the request's `Host` header, reject with 403. Requests with no `Origin` (curl, server-to-server) are allowed, because browsers always send `Origin` on cross-origin writes.
   - No `Content-Type` requirement: existing bodyless `DELETE /api/watchlist` calls must keep working.
3. `GET /api/alerts` selects explicit columns and returns `telegram_token_masked` (`…` + last 4) instead of the token. The `/alerts` page is updated to display the masked value.
4. `/api/jev/predict`:
   - `GET` never forces a new paid call; it only returns cached data or generates a snapshot when none exists (current non-force behaviour).
   - `force` is honoured only on `POST`.
   - `apiKey` is no longer accepted from query or body; the server key from settings is used.
   - `coin` must be in the supported-coin whitelist, else 400.
   - `/updown` page manual refresh switches to `POST { coin, force: true }`.
5. `PUT /api/llm` (and the new settings API for the same fields): base URL must use `https://`, except `http://localhost` and `http://127.0.0.1`. The existing stored value is left alone but shown with a warning on `/control`.
6. All `/api/users/[wallet]/*` routes validate `wallet` against `^0x[a-f0-9]{40}$` (after lowercasing) and return 400 otherwise.

## 3. Architecture

```
npm run supervisor   (scripts/supervisor.ts — one long-running process)
 ├─ web       next dev -H 127.0.0.1 -p 8000
 ├─ crawl     tsx scripts/crawl.ts
 ├─ backfill  tsx scripts/backfill.ts
 ├─ alerts    tsx scripts/alerts.ts
 ├─ jev       tsx scripts/jev.ts
 └─ control API  http://127.0.0.1:8001 (token-protected)

Browser ──> /control page ──> Next.js /api/control/*, /api/settings ──> supervisor control API
                                              │
                                              └──> SQLite: settings, worker_heartbeat
Workers ──> SQLite: read settings at startup, write heartbeat each cycle
```

Running the worker scripts directly (`npm run crawl`, etc.) keeps working. The supervisor is optional; without it `/control` shows a banner and disables process controls, but settings can still be saved.

### 3.1 Units

| Unit | File | Purpose | Depends on |
|------|------|---------|------------|
| Restart policy | `src/lib/supervisor/policy.ts` | Pure functions: next backoff delay, crash-loop detection | nothing |
| Log buffer | `src/lib/supervisor/logs.ts` | Append to `logs/<name>.log`, rotate at 5 MB keeping 2 old files, keep last 500 lines in memory | `fs` |
| Worker manager | `src/lib/supervisor/worker.ts` | One child process: start, stop, restart, state machine, uses policy + logs. Spawner is injected so tests can use a fake child | policy, logs |
| Supervisor entry | `scripts/supervisor.ts` | Builds the five workers, applies autostart, runs control HTTP server, handles SIGINT/SIGTERM | worker, settings |
| Control client | `src/lib/supervisor/client.ts` | Used by Next.js routes: reads `.supervisor-token`, calls control API with 2 s timeout, returns `null` when supervisor is down | `fs`, `fetch` |
| Settings | `src/lib/settings.ts` | Registry of setting keys (type, default, env fallback, secret flag, validation, affected workers); get/set/mask | db |
| Heartbeat | `src/lib/heartbeat.ts` | `beat(worker, ok, error?)` upserts into `worker_heartbeat` | db |
| API routes | `src/app/api/control/*`, `src/app/api/settings/*` | Thin HTTP layer over client + settings | client, settings |
| Page | `src/app/control/page.tsx` + small components in `src/components/control/` | UI | API routes |

## 4. Supervisor

### Worker definitions

| Name | Command | Controllable |
|------|---------|--------------|
| web | `npx next dev -H 127.0.0.1 -p 8000` | status only (dashboard cannot restart the server it runs on) |
| crawl | `npx tsx scripts/crawl.ts` | yes |
| backfill | `npx tsx scripts/backfill.ts` | yes |
| alerts | `npx tsx scripts/alerts.ts` | yes |
| jev | `npx tsx scripts/jev.ts` | yes |

Children are spawned with `cwd` = project root, inherited env, stdout and stderr piped into the log buffer (each line prefixed with an ISO timestamp; stderr lines are tagged so the UI can highlight them).

### State machine

States: `stopped`, `starting`, `running`, `restarting`, `crashed`.

- `start`: `stopped | crashed` → `starting` → `running` once spawned (pid known).
- Child exits while state is `running` and no stop was requested: record exit code and last stderr line, then `restarting`, wait backoff, spawn again.
- `stop`: send SIGTERM, wait up to 10 s, then SIGKILL; state `stopped`; no restart.
- `restart`: stop then start; resets the backoff counter.
- Backoff: 2 s, 4 s, 8 s, 16 s, 32 s, 60 s (cap). Counter resets after 5 minutes of continuous running.
- Crash loop: 5 unexpected exits within 5 minutes → state `crashed`, no further automatic restart until a manual `start`.

Status per worker: `name`, `state`, `pid`, `startedAt`, `restarts`, `lastExitCode`, `lastError`, `controllable`.

### Control API

Listens on `127.0.0.1:8001` only. At startup the supervisor writes 32 random bytes (hex) to `.supervisor-token` with mode `0600`; every request must send `Authorization: Bearer <token>`, else 401.

- `GET /status` → `{ supervisor: { pid, startedAt }, workers: WorkerStatus[] }`
- `POST /workers/:name/start|stop|restart` → updated `WorkerStatus`; 409 for `web`; 404 for unknown name
- `GET /workers/:name/logs?tail=N` → `{ lines: [{ t, stream, text }] }`, `N` capped at 500

### Shutdown

On SIGINT/SIGTERM: stop all workers in parallel (SIGTERM, 10 s grace, SIGKILL), close the HTTP server, delete `.supervisor-token`, exit 0.

## 5. Settings

### Storage

New table:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,      -- JSON
  updated_at INTEGER NOT NULL
);
```

Resolution order for `getSetting(key)`: DB value → env variable (if the key defines one) → registry default. The existing `llm_settings` row remains the store for the wallet-analysis LLM fields, so existing code keeps working; the settings module reads and writes that row for those three keys.

### Registry

| Key | Type | Default / env fallback | Secret | Validation | Restarts |
|-----|------|------------------------|--------|------------|----------|
| `openrouter.apiKey` | string | env `OPENROUTER_API_KEY` | yes | non-empty | jev |
| `jev.telegramToken` | string | env `JEV_TELEGRAM_BOT_TOKEN`, then `TELEGRAM_BOT_TOKEN` | yes | `^\d+:[A-Za-z0-9_-]{20,}$` | jev |
| `jev.telegramChat` | string | env `JEV_TELEGRAM_CHAT_ID`, then `TELEGRAM_CHAT_ID` | no | non-empty | jev |
| `llm.baseUrl` | string | `llm_settings.base_url` | no | https, or http on localhost/127.0.0.1 | none (web reads per request) |
| `llm.apiKey` | string | `llm_settings.api_key` | yes | non-empty | none |
| `llm.model` | string | `llm_settings.model` | no | non-empty | none |
| `jev.coins` | string[] | `btc eth sol xrp doge hype bnb` | no | non-empty subset of that list | jev |
| `jev.models` | `{jev,kev,span}: boolean` | all true | no | at least one true | jev |
| `jev.recordIntervalSec` | int | 300 | no | 60–3600 | jev |
| `jev.snapshotIntervalSec` | int | 30 | no | 10–600 | jev |
| `crawl.intervalSec` | int | 30 | no | 10–600 | crawl |
| `alerts.intervalSec` | int | 60 | no | 30–3600 | alerts |
| `supervisor.autostart` | `{crawl,backfill,alerts,jev}: boolean` | all true | no | — | none (read at supervisor start) |

Code changes to consume settings: `scripts/jev.ts` (coins, intervals), `src/lib/jevSnapshot.ts` (API key, which models are called — a disabled model is recorded as `null`, which the consensus code already handles for failed calls), `src/lib/jevAlerts.ts` (Telegram target), `scripts/crawl.ts`, `scripts/alerts.ts`, `src/app/api/users/[wallet]/analyze/route.ts` and `src/app/api/llm/route.ts` (LLM fields via the settings module).

### Secret handling

- `GET /api/settings` returns, for secret keys, `{ set: boolean, last4: string | null, source: 'db' | 'env' | 'default' }` — never the value.
- `PUT /api/settings` with an empty string for a secret means "keep current".
- Secrets remain plain text in the local SQLite file, as today. Acceptable for Mac-only use; `polymarket.db` must not be shared.

### Test endpoint

`POST /api/settings/test { target: 'telegram' | 'openrouter' | 'llm' }`, using stored values:

- `telegram`: send "Polymarket Pulse test message" via the existing `sendTelegram`.
- `openrouter`: `GET https://openrouter.ai/api/v1/key` (free); return credit limit/usage. Cached 5 minutes for the health strip.
- `llm`: the existing 5-token `chat/completions` ping.

### Apply flow

`PUT /api/settings { changes: { key: value } }`:

1. Validate every key; on any error return 400 `{ errors: { key: message } }` and save nothing.
2. Save all changes in one transaction.
3. Collect the union of affected workers; for each one that is currently `running`, call supervisor `restart`.
4. Return `{ ok: true, restarted: string[], supervisor: boolean }`. When the supervisor is down, `supervisor: false` and the UI says "Saved — restart workers manually to apply".

## 6. Heartbeats

```sql
CREATE TABLE IF NOT EXISTS worker_heartbeat (
  worker TEXT PRIMARY KEY,
  last_ok_at INTEGER,
  last_error_at INTEGER,
  last_error TEXT
);
```

`beat(worker, true)` after each successful loop iteration, `beat(worker, false, message)` in each loop's catch block. One call site per loop in `scripts/crawl.ts`, `scripts/backfill.ts`, `scripts/alerts.ts`, `scripts/jev.ts`. Heartbeat write failures are caught and ignored so they can never break a worker.

Staleness on the page: amber when `now - last_ok_at > 3 × interval`, red when `> 10 × interval` (backfill uses a fixed 60 s reference interval).

## 7. `/control` page

Client component, same dark visual system as existing pages (existing CSS tokens, no new UI libraries). New "Control" link in `src/components/Navigation.tsx`.

- **Supervisor banner:** if `/api/control/status` reports supervisor down, show "Supervisor not running — start it with `npm run supervisor`" and disable process buttons.
- **Workers panel:** one row per worker: state pill, uptime, restart count, "last cycle Ns ago" (with staleness colour), last error line, Start / Stop / Restart buttons (none for `web`). Buttons are disabled while a request is pending.
- **Logs panel:** worker selector, last 200 lines, refreshed every 3 s while the tab is visible (`document.visibilityState`), Pause, Clear view, Download (fetches 500 lines and saves as `.log`). stderr lines highlighted.
- **Health strip:** `polymarket.db` + WAL size, `jev/` directory size, OpenRouter credit remaining (from cached test), supervisor uptime. Served by `GET /api/control/health`.
- **Settings panel:** groups Keys, Jev, Crawl, Alerts, Supervisor. Secret inputs show `set …ab12 (db)` as placeholder; each key has a Test button. Each group has its own Save; response toast lists restarted workers or field errors. LLM base URL that fails the https rule shows an inline warning.

Polling: status every 3 s, health every 30 s. No websockets.

## 8. API routes (Next.js)

| Route | Method | Behaviour |
|-------|--------|-----------|
| `/api/control/status` | GET | supervisor status merged with `worker_heartbeat` rows; `{ supervisor: null }` when down |
| `/api/control/workers/[name]` | POST `{ action }` | proxy start/stop/restart; 503 when supervisor down |
| `/api/control/logs/[name]` | GET `?tail=N` | proxy logs |
| `/api/control/health` | GET | file sizes + cached OpenRouter credit |
| `/api/settings` | GET, PUT | section 5 |
| `/api/settings/test` | POST | section 5 |

All are covered by `src/proxy.ts`.

## 9. Error handling

- Supervisor unreachable: client returns `null` after a 2 s timeout; routes translate to `supervisor: null` or 503; UI shows the banner.
- Spawn failure (e.g. missing `tsx`): counts as an unexpected exit, so backoff and crash-loop rules apply; the error text becomes `lastError`.
- Settings validation: all-or-nothing save; field-level messages.
- A worker that reads an invalid stored setting (e.g. hand-edited DB) falls back to the registry default and logs a warning.

## 10. Testing

Vitest, written before the implementation of each unit:

- `test/settings.test.ts`: DB → env → default resolution; validation accepts and rejects boundary values; `GET` payload contains no secret values; empty secret on `PUT` keeps the current value; affected-worker mapping.
- `test/supervisorPolicy.test.ts`: backoff sequence and cap; counter reset after 5 minutes; crash-loop detection at 5 exits in 5 minutes.
- `test/supervisorWorker.test.ts`: state transitions with a fake spawner (start, unexpected exit → restarting → running, stop does not restart, crash loop → crashed, restart resets backoff).
- `test/supervisorLogs.test.ts`: in-memory ring keeps last 500; rotation at size limit keeps 2 old files (temp dir).
- `test/proxy.test.ts`: foreign `Origin` on POST → 403; localhost `Origin` → pass; no `Origin` → pass; GET with foreign `Origin` → pass; foreign `Host` → 403.
- `test/securityRegressions.test.ts`: alerts GET payload has no `telegram_token`; predict rejects unknown `coin` and ignores `apiKey`; LLM base URL rule.

Manual verification: success criteria 1–6 in section 1.

## 11. Order of work

All work on a new branch created from `feat/snapshot-book-and-inputs`; the owner's existing uncommitted changes are not modified or committed.

1. Security fixes (S1–S6) — own commit.
2. Settings module, table, `/api/settings`, `/api/settings/test`; wire workers and LLM routes to settings.
3. Supervisor (policy, logs, worker, entry script, control API, client) + `npm run supervisor`; `.gitignore` gains `logs/` and `.supervisor-token`.
4. Heartbeats in the four workers.
5. `/control` page and `/api/control/*` routes; nav link.

## 12. Out of scope

- Login / remote access (owner chose Mac-only).
- Hard cost cap on OpenRouter calls (models on/off covers basic cost control).
- Start at macOS boot (launchd).
- Encrypting secrets at rest.
- Editing per-alert rules (already handled by `/alerts`).

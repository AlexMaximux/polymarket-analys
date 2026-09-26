# Control Dashboard + Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the app to this Mac and block cross-site requests, then add a supervisor process and a `/control` page to start/stop workers, watch their health and logs, and edit settings.

**Architecture:** A pure request guard runs in `src/proxy.ts` for every `/api/*` call. A settings registry (`src/lib/settings.ts`) resolves values DB → env → default and is read by the workers at startup. `scripts/supervisor.ts` owns the child processes (restart policy, log files, external-process detection) and exposes a token-protected control API on `127.0.0.1:8001`; Next.js API routes proxy to it, and the `/control` client page polls those routes.

**Tech Stack:** Next.js 16.3 (App Router, `proxy.ts`), React 19, TypeScript, better-sqlite3, vitest 2, Node `child_process`/`http`, Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-26-control-dashboard-design.md`

## Global Constraints

- No new npm dependencies.
- Web app binds to `127.0.0.1` only, port `8000` (env `PMP_PORT` may override for the supervisor); supervisor control API binds to `127.0.0.1`, port `8001` (env `SUPERVISOR_PORT`).
- No API response may contain a secret value (Telegram bot tokens, OpenRouter key, LLM key).
- The supervisor never signals a process it did not start.
- Plain-HTTP LLM base URLs are allowed (owner's endpoint `http://178.104.62.47:20128/v1` must keep working).
- The owner's uncommitted changes must not be committed. Files that are dirty in the working tree (`src/components/Navigation.tsx`, all `src/app/*/page.tsx` except `alerts`) are edited in the working tree, and only our hunk is staged by writing an index blob from `HEAD` + our edit (procedure in Task 10).
- Run commands from the project root `/Users/nersibayat/.gemini/antigravity-cli/scratch/polymarket-pulse`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviation from spec (found while planning)

`alerts` already runs under launchd (`~/Library/LaunchAgents/com.polymarket-pulse.alerts.plist`, KeepAlive), and the web server and `jev` are started by the Antigravity IDE. A second copy would send duplicate Telegram alerts and double OpenRouter spend. The supervisor therefore detects a worker that is already running outside it (by `scripts/<name>.ts` command line + project cwd, or a listener on the web port) and marks it `external` instead of starting a copy. It never stops external processes. Also, the control client uses a 15 s timeout for POST actions (stop waits up to 10 s), 2 s for GET.

## Review Focus

1. Worker already running outside the supervisor (launchd `alerts`, IDE-started `jev`/web) → shown as `external`, never duplicated, never killed. Test: Task 7 (`detectExternal` returns a pid → state `external`, spawn not called) and Task 7 (`stop` on external does not call kill).
2. Supervisor not running while the dashboard is open → settings still save, process buttons disabled, banner shown, no 500s. Test: Task 9 (`PUT /api/settings` with client returning `null` → `supervisor: false`).
3. Child that fails to spawn (missing binary) → treated as a crash, backoff applies, no unhandled exception. Test: Task 7 (spawn throws → `restarting`).
4. Hand-edited or corrupt stored setting → worker falls back to default instead of crashing. Test: Task 3 (invalid JSON / out-of-range stored value → default).
5. Browser POST from another site, or with `Origin: null` → 403. Test: Task 1.

---

### Task 1: Localhost-only binding and CSRF/DNS-rebinding guard

**Files:**
- Create: `src/lib/requestGuard.ts`
- Create: `src/proxy.ts`
- Modify: `package.json` (scripts `dev`, `start`)
- Test: `test/requestGuard.test.ts`

**Interfaces:**
- Produces: `checkLocalRequest(method: string, host: string | null, origin: string | null): string | null` — rejection reason or `null`.

- [ ] **Step 1: Write the failing test**

```ts
// test/requestGuard.test.ts
import { describe, it, expect } from 'vitest';
import { checkLocalRequest } from '../src/lib/requestGuard';

describe('checkLocalRequest', () => {
  it('allows same-origin writes from localhost and 127.0.0.1 on any port', () => {
    expect(checkLocalRequest('POST', 'localhost:8000', 'http://localhost:8000')).toBeNull();
    expect(checkLocalRequest('DELETE', '127.0.0.1:3001', 'http://127.0.0.1:3001')).toBeNull();
  });
  it('allows writes without an Origin header (curl, server-to-server)', () => {
    expect(checkLocalRequest('POST', '127.0.0.1:8000', null)).toBeNull();
  });
  it('allows cross-origin reads', () => {
    expect(checkLocalRequest('GET', 'localhost:8000', 'https://evil.example')).toBeNull();
  });
  it('blocks cross-origin writes', () => {
    expect(checkLocalRequest('POST', 'localhost:8000', 'https://evil.example')).not.toBeNull();
    expect(checkLocalRequest('POST', 'localhost:8000', 'http://localhost:9999')).not.toBeNull();
  });
  it('blocks Origin: null (sandboxed iframe, file://)', () => {
    expect(checkLocalRequest('POST', 'localhost:8000', 'null')).not.toBeNull();
  });
  it('blocks foreign Host headers (DNS rebinding, LAN access) for every method', () => {
    expect(checkLocalRequest('GET', 'evil.example:8000', null)).not.toBeNull();
    expect(checkLocalRequest('GET', '192.168.1.141:8000', null)).not.toBeNull();
    expect(checkLocalRequest('GET', null, null)).not.toBeNull();
  });
  it('accepts IPv6 loopback', () => {
    expect(checkLocalRequest('POST', '[::1]:8000', 'http://[::1]:8000')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/requestGuard.test.ts`
Expected: FAIL — cannot resolve `../src/lib/requestGuard`.

- [ ] **Step 3: Implement**

```ts
// src/lib/requestGuard.ts
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0];
}

/**
 * Guard for /api/* (see src/proxy.ts). The app is meant to be used from this Mac only:
 * - Host must be a loopback name, which blocks LAN access and DNS rebinding.
 * - Writes carrying an Origin must come from the same host:port, which blocks CSRF from
 *   other websites. Browsers always send Origin on cross-origin writes; curl does not.
 * Returns the rejection reason, or null when the request may proceed.
 */
export function checkLocalRequest(method: string, host: string | null, origin: string | null): string | null {
  const h = (host || '').toLowerCase();
  if (!h || !LOCAL_HOSTNAMES.has(hostnameOf(h))) return 'host not allowed';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (!origin) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return 'bad origin';
  }
  return originHost === h ? null : 'cross-origin request blocked';
}
```

```ts
// src/proxy.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkLocalRequest } from '@/lib/requestGuard';

export function proxy(request: NextRequest) {
  const reason = checkLocalRequest(request.method, request.headers.get('host'), request.headers.get('origin'));
  if (reason) return NextResponse.json({ error: `forbidden: ${reason}` }, { status: 403 });
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
```

In `package.json` replace the two scripts:

```json
    "dev": "next dev -H 127.0.0.1 -p 8000",
    "build": "next build",
    "start": "next start -H 127.0.0.1 -p 8000",
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/requestGuard.test.ts && npx tsc --noEmit`
Expected: 7 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/requestGuard.ts src/proxy.ts package.json test/requestGuard.test.ts
git commit -m "fix(security): bind to localhost and block cross-site API writes"
```

---

### Task 2: Endpoint hardening (secrets, paid calls, input validation)

**Files:**
- Create: `src/lib/coins.ts`, `src/lib/validate.ts`, `src/lib/secrets.ts`, `src/lib/llmPing.ts`
- Modify: `src/app/api/alerts/route.ts` (GET)
- Modify: `src/app/api/jev/predict/route.ts` (argument parsing)
- Modify: `src/app/api/llm/route.ts` (PUT)
- Modify: `src/app/api/users/[wallet]/route.ts`, `.../chart/route.ts`, `.../closed/route.ts`, `.../entries/route.ts`, `.../pnl/route.ts`, `.../positions/route.ts`, `.../trades/route.ts`, `.../analyze/route.ts` (GET)
- Modify: `test/api.test.ts` (fixture wallet must now be a valid address)
- Test: `test/securityRegressions.test.ts`

**Interfaces:**
- Produces: `JEV_COINS: readonly ['btc','eth','sol','xrp','doge','hype','bnb']`, `type JevCoin`, `isJevCoin(c: string): c is JevCoin` (coins.ts)
- Produces: `parseWallet(raw: string): string | null`, `isHttpUrl(s: string): boolean` (validate.ts)
- Produces: `maskSecret(v: string | null | undefined): string | null` → `'…' + last 4` for values ≥ 12 chars, `'…'` for shorter non-empty, `null` for empty (secrets.ts)
- Produces: `pingLlm(baseUrl: string, apiKey: string, model: string): Promise<{ ok: boolean; error?: string }>` (llmPing.ts)

- [ ] **Step 1: Write the failing tests**

```ts
// test/securityRegressions.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as dbModule from '../src/lib/db';
import { GET as getAlerts } from '../src/app/api/alerts/route';
import { GET as predictGet, POST as predictPost } from '../src/app/api/jev/predict/route';
import { PUT as putLlm } from '../src/app/api/llm/route';
import { GET as getChart } from '../src/app/api/users/[wallet]/chart/route';
import { parseWallet, isHttpUrl } from '../src/lib/validate';
import { maskSecret } from '../src/lib/secrets';

const TOKEN = '123456789:AAHfakeTokenValueForTests_abcd';

describe('security regressions', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db);
    dbModule.initializeDb(db);
    global.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('GET /api/alerts never returns the Telegram token', async () => {
    db.prepare(`INSERT INTO alerts (name, hours, min_bet, telegram_token, telegram_chat, enabled, created_at)
                VALUES ('a', 24, 1000, ?, '42', 1, 0)`).run(TOKEN);
    const res = await getAlerts();
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    const body = JSON.parse(text);
    expect(body.alerts[0].telegram_token).toBeUndefined();
    expect(body.alerts[0].telegram_token_masked).toBe('…abcd');
    expect(body.alerts[0].telegram_chat).toBe('42');
  });

  it('predict rejects unknown coins (no path tricks)', async () => {
    const res = await predictGet(new Request('http://localhost/api/jev/predict?coin=../../etc/passwd'));
    expect(res.status).toBe(400);
    const res2 = await predictPost(new Request('http://localhost/api/jev/predict', { method: 'POST', body: JSON.stringify({ coin: 'zzz' }) }));
    expect(res2.status).toBe(400);
  });

  it('LLM settings reject non-http(s) base URLs but accept plain http', async () => {
    const bad = await putLlm(new Request('http://localhost/api/llm', { method: 'PUT', body: JSON.stringify({ baseUrl: 'file:///etc', apiKey: 'k', model: 'm' }) }));
    expect(bad.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
    (global.fetch as any).mockResolvedValue(new Response('{}', { status: 200 }));
    const ok = await putLlm(new Request('http://localhost/api/llm', { method: 'PUT', body: JSON.stringify({ baseUrl: 'http://178.104.62.47:20128/v1', apiKey: 'k', model: 'm' }) }));
    expect(ok.status).toBe(200);
  });

  it('wallet routes reject malformed wallets before any upstream fetch', async () => {
    const res = await getChart(new Request('http://localhost/x'), { params: Promise.resolve({ wallet: '0x1&limit=999' }) });
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('helpers', () => {
    expect(parseWallet('0xABCDEF0123456789abcdef0123456789ABCDEF01')).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
    expect(parseWallet('0x123')).toBeNull();
    expect(isHttpUrl('https://openrouter.ai/api/v1')).toBe(true);
    expect(isHttpUrl('http://178.104.62.47:20128/v1')).toBe(true);
    expect(isHttpUrl('ftp://x')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(maskSecret(TOKEN)).toBe('…abcd');
    expect(maskSecret('short')).toBe('…');
    expect(maskSecret('')).toBeNull();
  });
});
```

In `test/api.test.ts` replace every `'0xunknown'` with `'0x00000000000000000000000000000000000000aa'` (the fallback test uses it as the route param, the expected `data.user.wallet`, and the DB lookup).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/securityRegressions.test.ts`
Expected: FAIL — cannot resolve `../src/lib/validate`.

- [ ] **Step 3: Implement helpers**

```ts
// src/lib/coins.ts
/** Coins the Jev collector and /api/jev/predict support. */
export const JEV_COINS = ['btc', 'eth', 'sol', 'xrp', 'doge', 'hype', 'bnb'] as const;
export type JevCoin = (typeof JEV_COINS)[number];

export function isJevCoin(c: string): c is JevCoin {
  return (JEV_COINS as readonly string[]).includes(c);
}
```

```ts
// src/lib/validate.ts
const WALLET_RE = /^0x[a-f0-9]{40}$/;

/** Lowercased wallet address, or null when the input is not a 0x + 40 hex address. */
export function parseWallet(raw: string): string | null {
  const w = String(raw || '').trim().toLowerCase();
  return WALLET_RE.test(w) ? w : null;
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
```

```ts
// src/lib/secrets.ts
/** Display form of a secret: never more than the last 4 characters, and only for long values. */
export function maskSecret(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.length >= 12 ? `…${v.slice(-4)}` : '…';
}
```

```ts
// src/lib/llmPing.ts
/** 5-token chat/completions call used to check an OpenAI-compatible endpoint before saving it. */
export async function pingLlm(baseUrl: string, apiKey: string, model: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, stream: false, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'connection failed' };
  }
}
```

- [ ] **Step 4: Harden the routes**

`src/app/api/alerts/route.ts` — replace the body of `GET` and add the import:

```ts
import { maskSecret } from '@/lib/secrets';

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.*,
              (SELECT COUNT(*) FROM alert_seen s WHERE s.alert_id = a.id) as fired_count,
              (SELECT COUNT(*) FROM alert_wallets w WHERE w.alert_id = a.id) as wallet_count
       FROM alerts a ORDER BY a.id`
    )
    .all() as Array<Record<string, unknown> & { telegram_token: string }>;
  // Bot tokens stay server-side: anyone holding one controls the bot.
  const alerts = rows.map(({ telegram_token, ...rest }) => ({ ...rest, telegram_token_masked: maskSecret(telegram_token) }));
  return NextResponse.json({ alerts });
}
```

`src/app/api/jev/predict/route.ts` — change the imports and replace everything in `handlePredict` from `let apiKey = OPENROUTER_API_KEY;` down to (and including) the closing `}` of the `else { ... }` block that reads search params with:

```ts
    // POST = manual refresh (forces a paid model call); GET only serves cache or refreshes a stale one.
    // The API key always comes from server settings, never from the request.
    const force = req.method === 'POST';
    const { searchParams } = new URL(req.url);
    let coin = (searchParams.get('coin') || 'btc').toLowerCase();
    if (req.method === 'POST') {
      const body = await req.json().catch(() => null);
      if (body && typeof body.coin === 'string') coin = body.coin.toLowerCase();
    }
    if (!isJevCoin(coin)) {
      return NextResponse.json({ error: `unknown coin: ${coin}` }, { status: 400 });
    }
```

Import block becomes:

```ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { generateJevSnapshot, callMultiModelDecisions, saveHistoricalJevRecord } from '@/lib/jevSnapshot';
import { isJevCoin } from '@/lib/coins';
```

and the model call later in the file becomes `const multiPredictions = await callMultiModelDecisions(data);`. (The `/updown` page already POSTs with `?coin=` in the query; reading the query on POST also fixes its manual refresh always using BTC.)

`src/app/api/llm/route.ts` — in `PUT`, replace the inline test block (`let testOk = false;` … the `if (!testOk) {...}` return) with:

```ts
  if (!isHttpUrl(baseUrl)) {
    return NextResponse.json({ error: 'baseUrl must be an http:// or https:// URL' }, { status: 400 });
  }
  // test the connection before saving
  const test = await pingLlm(baseUrl, apiKey, model);
  if (!test.ok) {
    return NextResponse.json({ ok: false, testError: test.error }, { status: 400 });
  }
```

and add `import { isHttpUrl } from '@/lib/validate';` and `import { pingLlm } from '@/lib/llmPing';`.

Each wallet route (`src/app/api/users/[wallet]/route.ts`, `chart`, `closed`, `entries`, `pnl`, `positions`, `trades`, and the `GET` in `analyze`): replace the line `const { wallet } = await params;` with

```ts
  const wallet = parseWallet((await params).wallet);
  if (!wallet) return NextResponse.json({ error: 'valid wallet required' }, { status: 400 });
```

and add `import { parseWallet } from '@/lib/validate';` (add `import { NextResponse } from 'next/server';` where the file does not already import it). In `analyze/route.ts` `POST`, replace its two-line lowercase + regex check with the same two lines.

- [ ] **Step 5: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all test files pass (previous 44 + new); no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/coins.ts src/lib/validate.ts src/lib/secrets.ts src/lib/llmPing.ts src/app/api/alerts/route.ts src/app/api/jev/predict/route.ts src/app/api/llm/route.ts "src/app/api/users/[wallet]" test/securityRegressions.test.ts test/api.test.ts
git commit -m "fix(security): hide bot tokens, stop paid calls via GET, validate coins, wallets and LLM URL"
```

---

### Task 3: Settings registry

**Files:**
- Create: `src/lib/settings.ts`
- Test: `test/settings.test.ts`

**Interfaces:**
- Consumes: `JEV_COINS`, `isJevCoin` (Task 2), `isHttpUrl` (Task 2), `maskSecret` (Task 2), `getDb` (`src/lib/db.ts`)
- Produces:
  - `type WorkerName = 'crawl' | 'backfill' | 'alerts' | 'jev'`, `WORKER_NAMES: WorkerName[]`
  - `interface Settings` (keys below), `type SettingKey = keyof Settings`, `SETTINGS` registry
  - `getSetting<K extends SettingKey>(key: K, db?: Database.Database): Settings[K]`
  - `type PublicSetting = { secret: false; value: unknown; source: SettingSource } | { secret: true; set: boolean; masked: string | null; source: SettingSource }`
  - `publicSettings(db?): Record<SettingKey, PublicSetting>`
  - `applySettingChanges(changes: Record<string, unknown>, db?): { ok: true; restarts: WorkerName[] } | { ok: false; errors: Record<string, string> }`

- [ ] **Step 1: Write the failing test**

```ts
// test/settings.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDb } from '../src/lib/db';
import { getSetting, publicSettings, applySettingChanges } from '../src/lib/settings';

const KEY = 'sk-or-v1-0123456789abcdefWXYZ';
const TG = '123456789:AAHfakeTokenValueForTests_abcd';

describe('settings', () => {
  let db: Database.Database;
  const envBackup = { ...process.env };
  beforeEach(() => {
    db = new Database(':memory:');
    initializeDb(db);
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.JEV_TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });
  afterEach(() => { process.env = { ...envBackup }; });

  it('resolves db, then env, then default', () => {
    expect(getSetting('crawl.intervalSec', db)).toBe(30);
    expect(getSetting('openrouter.apiKey', db)).toBe('');
    process.env.OPENROUTER_API_KEY = 'from-env';
    expect(getSetting('openrouter.apiKey', db)).toBe('from-env');
    expect(applySettingChanges({ 'openrouter.apiKey': KEY, 'crawl.intervalSec': 45 }, db).ok).toBe(true);
    expect(getSetting('openrouter.apiKey', db)).toBe(KEY);
    expect(getSetting('crawl.intervalSec', db)).toBe(45);
  });

  it('falls back to the default when a stored value is corrupt or out of range', () => {
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('crawl.intervalSec', '1', 0)`).run();
    expect(getSetting('crawl.intervalSec', db)).toBe(30);
    db.prepare(`UPDATE settings SET value = '{not json' WHERE key = 'crawl.intervalSec'`).run();
    expect(getSetting('crawl.intervalSec', db)).toBe(30);
  });

  it('validates boundaries and saves nothing when any change is invalid', () => {
    const r = applySettingChanges({ 'crawl.intervalSec': 9, 'alerts.intervalSec': 120 }, db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(['crawl.intervalSec']);
    expect(getSetting('alerts.intervalSec', db)).toBe(60);
    expect(applySettingChanges({ 'crawl.intervalSec': 10 }, db).ok).toBe(true);
    expect(applySettingChanges({ 'jev.coins': [] }, db).ok).toBe(false);
    expect(applySettingChanges({ 'jev.coins': ['btc', 'zzz'] }, db).ok).toBe(false);
    expect(applySettingChanges({ 'jev.models': { jev: false, kev: false, span: false } }, db).ok).toBe(false);
    expect(applySettingChanges({ 'jev.telegramToken': 'nope' }, db).ok).toBe(false);
    expect(applySettingChanges({ 'nope.key': 1 }, db).ok).toBe(false);
  });

  it('keeps coins in canonical order without duplicates', () => {
    applySettingChanges({ 'jev.coins': ['SOL', 'btc', 'sol'] }, db);
    expect(getSetting('jev.coins', db)).toEqual(['btc', 'sol']);
  });

  it('never exposes secret values', () => {
    applySettingChanges({ 'openrouter.apiKey': KEY, 'jev.telegramToken': TG, 'jev.telegramChat': '42' }, db);
    const pub = publicSettings(db);
    const text = JSON.stringify(pub);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(TG);
    expect(pub['openrouter.apiKey']).toEqual({ secret: true, set: true, masked: '…WXYZ', source: 'db' });
    expect(pub['jev.telegramChat']).toEqual({ secret: false, value: '42', source: 'db' });
  });

  it('treats an empty secret as keep-current', () => {
    applySettingChanges({ 'openrouter.apiKey': KEY }, db);
    const r = applySettingChanges({ 'openrouter.apiKey': '' }, db);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.restarts).toEqual([]);
    expect(getSetting('openrouter.apiKey', db)).toBe(KEY);
  });

  it('reports which workers must restart', () => {
    const r = applySettingChanges({ 'crawl.intervalSec': 20, 'jev.coins': ['btc'], 'supervisor.autostart': { crawl: true, backfill: false, alerts: true, jev: true } }, db);
    expect(r).toEqual({ ok: true, restarts: ['crawl', 'jev'] });
  });

  it('stores wallet-analysis LLM fields in llm_settings and needs all three the first time', () => {
    expect(applySettingChanges({ 'llm.model': 'm' }, db).ok).toBe(false);
    expect(applySettingChanges({ 'llm.baseUrl': 'http://178.104.62.47:20128/v1/', 'llm.apiKey': 'sk-llm-0123456789', 'llm.model': 'm' }, db).ok).toBe(true);
    const row = db.prepare(`SELECT base_url, model FROM llm_settings WHERE id = 1`).get() as any;
    expect(row).toEqual({ base_url: 'http://178.104.62.47:20128/v1', model: 'm' });
    expect(applySettingChanges({ 'llm.model': 'm2' }, db).ok).toBe(true);
    expect(getSetting('llm.model', db)).toBe('m2');
    expect(applySettingChanges({ 'llm.baseUrl': 'ftp://x' }, db).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/settings.test.ts`
Expected: FAIL — cannot resolve `../src/lib/settings`.

- [ ] **Step 3: Implement**

```ts
// src/lib/settings.ts
import type Database from 'better-sqlite3';
import { getDb } from './db';
import { JEV_COINS, isJevCoin, type JevCoin } from './coins';
import { isHttpUrl } from './validate';
import { maskSecret } from './secrets';

/**
 * Editable settings for the workers and the web app (managed on /control).
 * Lookup order: stored value (settings table, or the llm_settings row for llm.*) → env var → default.
 * Workers read settings once at startup; saving a setting restarts the workers listed in `restarts`.
 */

export type WorkerName = 'crawl' | 'backfill' | 'alerts' | 'jev';
export const WORKER_NAMES: WorkerName[] = ['crawl', 'backfill', 'alerts', 'jev'];

export interface Settings {
  'openrouter.apiKey': string;
  'jev.telegramToken': string;
  'jev.telegramChat': string;
  'llm.baseUrl': string;
  'llm.apiKey': string;
  'llm.model': string;
  'jev.coins': JevCoin[];
  'jev.models': { jev: boolean; kev: boolean; span: boolean };
  'jev.recordIntervalSec': number;
  'jev.snapshotIntervalSec': number;
  'crawl.intervalSec': number;
  'alerts.intervalSec': number;
  'supervisor.autostart': Record<WorkerName, boolean>;
}
export type SettingKey = keyof Settings;
export type SettingSource = 'db' | 'env' | 'default';

export class SettingError extends Error {}

type LlmColumn = 'base_url' | 'api_key' | 'model';

interface SettingDef<T> {
  secret?: boolean;
  env?: string[];
  llmColumn?: LlmColumn;
  default: T;
  parse: (v: unknown) => T;
  restarts: WorkerName[];
}

const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;

const requiredString = (label: string) => (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim()) throw new SettingError(`${label} is required`);
  return v.trim();
};

const intRange = (min: number, max: number) => (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw new SettingError(`must be a whole number from ${min} to ${max}`);
  return n;
};

const flags = <K extends string>(keys: readonly K[], atLeastOne: boolean) => (v: unknown): Record<K, boolean> => {
  if (!v || typeof v !== 'object') throw new SettingError('expected on/off flags');
  const out = {} as Record<K, boolean>;
  for (const k of keys) {
    const b = (v as Record<string, unknown>)[k];
    if (typeof b !== 'boolean') throw new SettingError(`${k} must be on or off`);
    out[k] = b;
  }
  if (atLeastOne && !keys.some(k => out[k])) throw new SettingError('enable at least one');
  return out;
};

export const SETTINGS: { [K in SettingKey]: SettingDef<Settings[K]> } = {
  'openrouter.apiKey': { secret: true, env: ['OPENROUTER_API_KEY'], default: '', parse: requiredString('API key'), restarts: ['jev'] },
  'jev.telegramToken': {
    secret: true,
    env: ['JEV_TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN'],
    default: '',
    parse: v => {
      const s = requiredString('Bot token')(v);
      if (!TELEGRAM_TOKEN_RE.test(s)) throw new SettingError('bot token looks invalid (expected 123456:ABC…)');
      return s;
    },
    restarts: ['jev'],
  },
  'jev.telegramChat': { env: ['JEV_TELEGRAM_CHAT_ID', 'TELEGRAM_CHAT_ID'], default: '', parse: requiredString('Chat ID'), restarts: ['jev'] },
  'llm.baseUrl': {
    llmColumn: 'base_url',
    default: '',
    parse: v => {
      const s = requiredString('Base URL')(v).replace(/\/+$/, '');
      if (!isHttpUrl(s)) throw new SettingError('must be an http:// or https:// URL');
      return s;
    },
    restarts: [],
  },
  'llm.apiKey': { secret: true, llmColumn: 'api_key', default: '', parse: requiredString('API key'), restarts: [] },
  'llm.model': { llmColumn: 'model', default: '', parse: requiredString('Model'), restarts: [] },
  'jev.coins': {
    default: [...JEV_COINS],
    parse: v => {
      if (!Array.isArray(v) || v.length === 0) throw new SettingError('pick at least one coin');
      const picked = v.map(c => String(c).toLowerCase());
      for (const c of picked) if (!isJevCoin(c)) throw new SettingError(`unknown coin: ${c}`);
      return JEV_COINS.filter(c => picked.includes(c));
    },
    restarts: ['jev'],
  },
  'jev.models': { default: { jev: true, kev: true, span: true }, parse: flags(['jev', 'kev', 'span'] as const, true), restarts: ['jev'] },
  'jev.recordIntervalSec': { default: 300, parse: intRange(60, 3600), restarts: ['jev'] },
  'jev.snapshotIntervalSec': { default: 30, parse: intRange(10, 600), restarts: ['jev'] },
  'crawl.intervalSec': { default: 30, parse: intRange(10, 600), restarts: ['crawl'] },
  'alerts.intervalSec': { default: 60, parse: intRange(30, 3600), restarts: ['alerts'] },
  'supervisor.autostart': {
    default: { crawl: true, backfill: true, alerts: true, jev: true },
    parse: flags(WORKER_NAMES, false),
    restarts: [],
  },
};

const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

const prepared = new WeakSet<Database.Database>();
function ensureTables(db: Database.Database) {
  if (prepared.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS llm_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL,
    updated_at INTEGER
  )`);
  prepared.add(db);
}

type LlmRow = { base_url: string; api_key: string; model: string };
function readLlmRow(db: Database.Database): LlmRow | undefined {
  return db.prepare(`SELECT base_url, api_key, model FROM llm_settings WHERE id = 1`).get() as LlmRow | undefined;
}

function resolve<K extends SettingKey>(key: K, db: Database.Database): { value: Settings[K]; source: SettingSource } {
  const def = SETTINGS[key] as SettingDef<Settings[K]>;
  ensureTables(db);
  let stored: unknown = undefined;
  if (def.llmColumn) {
    stored = readLlmRow(db)?.[def.llmColumn];
  } else {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    if (row) {
      try {
        stored = JSON.parse(row.value);
      } catch {
        console.warn(`[settings] ignoring unreadable stored value for ${key}`);
      }
    }
  }
  if (stored !== undefined && stored !== null) {
    try {
      return { value: def.parse(stored), source: 'db' };
    } catch (e) {
      console.warn(`[settings] ignoring invalid stored value for ${key}: ${(e as Error).message}`);
    }
  }
  for (const name of def.env ?? []) {
    const v = process.env[name];
    if (v && v.trim()) return { value: v.trim() as Settings[K], source: 'env' };
  }
  return { value: structuredClone(def.default), source: 'default' };
}

export function getSetting<K extends SettingKey>(key: K, db: Database.Database = getDb()): Settings[K] {
  return resolve(key, db).value;
}

export type PublicSetting =
  | { secret: false; value: unknown; source: SettingSource }
  | { secret: true; set: boolean; masked: string | null; source: SettingSource };

/** Settings as sent to the browser: secrets are reduced to set/unset + last 4 characters. */
export function publicSettings(db: Database.Database = getDb()): Record<SettingKey, PublicSetting> {
  const out = {} as Record<SettingKey, PublicSetting>;
  for (const key of SETTING_KEYS) {
    const { value, source } = resolve(key, db);
    if (SETTINGS[key].secret) {
      const s = String(value || '');
      out[key] = { secret: true, set: s.length > 0, masked: maskSecret(s), source };
    } else {
      out[key] = { secret: false, value, source };
    }
  }
  return out;
}

export type ApplyResult = { ok: true; restarts: WorkerName[] } | { ok: false; errors: Record<string, string> };

/** Validate and save changes all-or-nothing. An empty value for a secret means "keep current". */
export function applySettingChanges(changes: Record<string, unknown>, db: Database.Database = getDb()): ApplyResult {
  ensureTables(db);
  const errors: Record<string, string> = {};
  const parsed: Array<[SettingKey, unknown]> = [];
  for (const [key, raw] of Object.entries(changes)) {
    if (!(key in SETTINGS)) {
      errors[key] = 'unknown setting';
      continue;
    }
    const k = key as SettingKey;
    const def = SETTINGS[k];
    if (def.secret && (raw === '' || raw === null || raw === undefined)) continue;
    try {
      parsed.push([k, def.parse(raw)]);
    } catch (e) {
      errors[key] = e instanceof SettingError ? e.message : 'invalid value';
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const llmChanges = parsed.filter(([k]) => SETTINGS[k].llmColumn);
  let llmRow: LlmRow | null = null;
  if (llmChanges.length) {
    const current = readLlmRow(db);
    llmRow = { base_url: current?.base_url ?? '', api_key: current?.api_key ?? '', model: current?.model ?? '' };
    for (const [k, v] of llmChanges) llmRow[SETTINGS[k].llmColumn as LlmColumn] = v as string;
    if (!llmRow.base_url || !llmRow.api_key || !llmRow.model) {
      return { ok: false, errors: { 'llm.baseUrl': 'set base URL, API key and model together the first time' } };
    }
  }

  const now = Math.floor(Date.now() / 1000);
  db.transaction(() => {
    const upsert = db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    for (const [k, v] of parsed) if (!SETTINGS[k].llmColumn) upsert.run(k, JSON.stringify(v), now);
    if (llmRow) {
      db.prepare(
        `INSERT INTO llm_settings (id, base_url, api_key, model, updated_at) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key,
           model = excluded.model, updated_at = excluded.updated_at`
      ).run(llmRow.base_url, llmRow.api_key, llmRow.model, now);
    }
  })();

  const affected = new Set(parsed.flatMap(([k]) => SETTINGS[k].restarts));
  return { ok: true, restarts: WORKER_NAMES.filter(w => affected.has(w)) };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/settings.test.ts && npx tsc --noEmit`
Expected: 8 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts test/settings.test.ts
git commit -m "feat(settings): add settings registry with db/env/default resolution and masked view"
```

---

### Task 4: Workers read settings

**Files:**
- Modify: `src/lib/jevSnapshot.ts` (key lookup, model on/off)
- Modify: `src/lib/jevAlerts.ts` (Telegram target)
- Modify: `scripts/jev.ts`, `scripts/crawl.ts`, `scripts/alerts.ts` (coins, intervals)
- Test: `test/jevModels.test.ts`

**Interfaces:**
- Consumes: `getSetting` (Task 3)
- Removes: `OPENROUTER_API_KEY` export from `jevSnapshot.ts` (its only importer, `predict/route.ts`, stopped using it in Task 2); `JEV_TELEGRAM_BOT_TOKEN`/`JEV_TELEGRAM_CHAT_ID` exports from `jevAlerts.ts` (no other importers).

- [ ] **Step 1: Write the failing test**

```ts
// test/jevModels.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as dbModule from '../src/lib/db';
import { applySettingChanges } from '../src/lib/settings';
import { callMultiModelDecisions } from '../src/lib/jevSnapshot';

describe('callMultiModelDecisions', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    dbModule.initializeDb(db);
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db);
    global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('makes no OpenRouter call for disabled models', async () => {
    applySettingChanges({ 'openrouter.apiKey': 'sk-test-0123456789', 'jev.models': { jev: false, kev: false, span: true } }, db);
    const r = await callMultiModelDecisions({ coin: 'btc', coin_label: 'Bitcoin', cards: {}, fair_values: {} });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(r.jev).toBeNull();
    expect(r.kev).toBeNull();
    const [, init] = (global.fetch as any).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-test-0123456789');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/jevModels.test.ts`
Expected: FAIL — fetch called 3 times.

- [ ] **Step 3: Implement**

`src/lib/jevSnapshot.ts`:
- add `import { getSetting } from './settings';`
- replace

```ts
export const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || '';
```

with

```ts
/** OpenRouter key from /control settings (falls back to OPENROUTER_API_KEY in .env.local). */
function openRouterKey(apiKey?: string): string {
  return apiKey || getSetting('openrouter.apiKey');
}
```

- in `callJevDecision`, `callKevDecision`, `callSpanDecision` replace `const key = apiKey || OPENROUTER_API_KEY;` with `const key = openRouterKey(apiKey);`
- in `callMultiModelDecisions` replace the `Promise.allSettled([...])` call with:

```ts
  const enabled = getSetting('jev.models');
  const off = Promise.resolve(null);
  const [jevRes, kevRes, spanRes] = await Promise.allSettled([
    enabled.jev ? callJevDecision(snapshotData, apiKey) : off,
    enabled.kev ? callKevDecision(snapshotData, apiKey) : off,
    enabled.span ? callSpanDecision(snapshotData, apiKey) : off,
  ]);
```

(Check the Authorization header shape used by the three calls with `grep -n "Authorization" src/lib/jevSnapshot.ts`; if it is not `` `Bearer ${key}` `` in a plain object, adjust the test's header assertion to match the actual shape.)

`src/lib/jevAlerts.ts`:
- add `import { getSetting } from './settings';`
- delete the `JEV_TELEGRAM_BOT_TOKEN` and `JEV_TELEGRAM_CHAT_ID` exports (lines 10–15)
- replace the two lines near line 397

```ts
    const botToken = alertRow?.telegram_token || JEV_TELEGRAM_BOT_TOKEN;
    const chatId = alertRow?.telegram_chat || JEV_TELEGRAM_CHAT_ID;
```

with

```ts
    const botToken = alertRow?.telegram_token || getSetting('jev.telegramToken');
    const chatId = alertRow?.telegram_chat || getSetting('jev.telegramChat');
```

`scripts/jev.ts`:
- add `import { getSetting } from '../src/lib/settings';`
- replace the three interval constants and `SUPPORTED_COINS` with:

```ts
const SNAPSHOT_INTERVAL_MS = getSetting('jev.snapshotIntervalSec') * 1000; // live cache refresh (default 30s)
const JEV_RECORD_INTERVAL_MS = getSetting('jev.recordIntervalSec') * 1000; // multi-model record (default 5 min)
const RESOLUTION_CHECK_INTERVAL_MS = 90000; // 90s market resolution checker (handles 10-30m UMA lag)
```

and, after `let lastResolutionCheckTime = 0;`:

```ts
const SUPPORTED_COINS: string[] = getSetting('jev.coins');
```

- in `runCoinRecord` replace `if (elapsed < 240000) {` with `if (elapsed < JEV_RECORD_INTERVAL_MS * 0.8) {` and its comment with `// Less than 80% of the record interval since last file for this coin`.

`scripts/crawl.ts`: add `import { getSetting } from '../src/lib/settings';` and replace the loop wait:

```ts
    await new Promise(r => setTimeout(r, getSetting('crawl.intervalSec') * 1000));
```

(Update the `// Poll every 30s` comment to `// Poll interval from /control settings (default 30s)`.)

`scripts/alerts.ts`: add `import { getSetting } from '../src/lib/settings';`, then inside `alertLoop` after `initializeDb();` add `const intervalMs = getSetting('alerts.intervalSec') * 1000;`, change the log line to `` `Starting alert evaluation loop (every ${intervalMs / 1000}s)...` ``, and replace `setTimeout(r, 60000)` with `setTimeout(r, intervalMs)`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jevSnapshot.ts src/lib/jevAlerts.ts scripts/jev.ts scripts/crawl.ts scripts/alerts.ts test/jevModels.test.ts
git commit -m "feat(settings): workers read keys, coins, models and intervals from settings"
```

---

### Task 5: Worker heartbeats

**Files:**
- Create: `src/lib/heartbeat.ts`
- Create: `src/lib/staleness.ts`
- Modify: `scripts/crawl.ts`, `scripts/backfill.ts`, `scripts/alerts.ts`, `scripts/jev.ts`
- Test: `test/heartbeat.test.ts`

**Interfaces:**
- Produces: `beat(worker: string, ok: boolean, error?: string, db?: Database.Database): void` — never throws
- Produces: `interface Heartbeat { worker: string; last_ok_at: number | null; last_error_at: number | null; last_error: string | null }`, `readHeartbeats(db?): Record<string, Heartbeat>`
- Produces: `type Freshness = 'fresh' | 'stale' | 'dead' | 'none'`, `heartbeatFreshness(lastOkAt: number | null | undefined, intervalSec: number | null, nowMs: number): Freshness`

- [ ] **Step 1: Write the failing test**

```ts
// test/heartbeat.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { beat, readHeartbeats } from '../src/lib/heartbeat';
import { heartbeatFreshness } from '../src/lib/staleness';

describe('heartbeat', () => {
  it('records success and error separately', () => {
    const db = new Database(':memory:');
    beat('crawl', true, undefined, db);
    beat('crawl', false, 'x'.repeat(900), db);
    const hb = readHeartbeats(db).crawl;
    expect(hb.last_ok_at).toBeGreaterThan(0);
    expect(hb.last_error_at).toBeGreaterThan(0);
    expect(hb.last_error!.length).toBe(500);
  });
  it('never throws, even on a closed database', () => {
    const db = new Database(':memory:');
    db.close();
    expect(() => beat('crawl', true, undefined, db)).not.toThrow();
  });
  it('classifies freshness by interval multiples', () => {
    const now = 1_000_000_000;
    expect(heartbeatFreshness(null, 30, now)).toBe('none');
    expect(heartbeatFreshness(now / 1000 - 60, 30, now)).toBe('fresh');
    expect(heartbeatFreshness(now / 1000 - 91, 30, now)).toBe('stale');
    expect(heartbeatFreshness(now / 1000 - 301, 30, now)).toBe('dead');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/heartbeat.test.ts`
Expected: FAIL — cannot resolve `../src/lib/heartbeat`.

- [ ] **Step 3: Implement**

```ts
// src/lib/heartbeat.ts
import type Database from 'better-sqlite3';
import { getDb } from './db';

/** "Last successful cycle" per worker, shown on /control to tell a stuck worker from a working one. */
export interface Heartbeat {
  worker: string;
  last_ok_at: number | null;
  last_error_at: number | null;
  last_error: string | null;
}

const prepared = new WeakSet<Database.Database>();
function ensureTable(db: Database.Database) {
  if (prepared.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS worker_heartbeat (
    worker TEXT PRIMARY KEY,
    last_ok_at INTEGER,
    last_error_at INTEGER,
    last_error TEXT
  )`);
  prepared.add(db);
}

/** Record one loop iteration. Never throws: a heartbeat must not be able to break a worker. */
export function beat(worker: string, ok: boolean, error?: string, db?: Database.Database): void {
  try {
    const d = db ?? getDb();
    ensureTable(d);
    const now = Math.floor(Date.now() / 1000);
    if (ok) {
      d.prepare(`INSERT INTO worker_heartbeat (worker, last_ok_at) VALUES (?, ?)
                 ON CONFLICT(worker) DO UPDATE SET last_ok_at = excluded.last_ok_at`).run(worker, now);
    } else {
      d.prepare(`INSERT INTO worker_heartbeat (worker, last_error_at, last_error) VALUES (?, ?, ?)
                 ON CONFLICT(worker) DO UPDATE SET last_error_at = excluded.last_error_at, last_error = excluded.last_error`)
        .run(worker, now, String(error ?? 'error').slice(0, 500));
    }
  } catch {
    // ignore
  }
}

export function readHeartbeats(db?: Database.Database): Record<string, Heartbeat> {
  const d = db ?? getDb();
  ensureTable(d);
  const rows = d.prepare(`SELECT worker, last_ok_at, last_error_at, last_error FROM worker_heartbeat`).all() as Heartbeat[];
  return Object.fromEntries(rows.map(r => [r.worker, r]));
}
```

```ts
// src/lib/staleness.ts
export type Freshness = 'fresh' | 'stale' | 'dead' | 'none';

/** Amber after 3 missed intervals, red after 10. */
export function heartbeatFreshness(lastOkAt: number | null | undefined, intervalSec: number | null, nowMs: number): Freshness {
  if (!lastOkAt || !intervalSec) return 'none';
  const age = nowMs / 1000 - lastOkAt;
  if (age > 10 * intervalSec) return 'dead';
  if (age > 3 * intervalSec) return 'stale';
  return 'fresh';
}
```

Call sites (add `import { beat } from '../src/lib/heartbeat';` to each script):

`scripts/crawl.ts` — inside `try` after the `console.log(... Fetched ...)` line: `beat('crawl', true);`; inside `catch` after `console.error(...)`: `beat('crawl', false, String((err as Error)?.message ?? err));`

`scripts/alerts.ts` — in `alertLoop`, after the `if (r.sent > 0 || r.failed > 0) {...}` block: `beat('alerts', true);`; in its `catch` after `console.error(...)`: `beat('alerts', false, String((err as Error)?.message ?? err));`

`scripts/backfill.ts` — in the `wallets.length === 0` branch, before the `await`: `beat('backfill', true);`; after `saveTrueFirst(r);`: `beat('backfill', true);`; in the `catch` after `console.error(...)`: `beat('backfill', false, String((err as Error)?.message ?? err));`

`scripts/jev.ts` — in `run30sUpdate`, after the final `console.log(... Multi-coin JEV live cache refreshed ...)`: `beat('jev', true);`; in its `catch` after `console.error(...)`: `beat('jev', false, err.message || String(err));`

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/heartbeat.ts src/lib/staleness.ts scripts/crawl.ts scripts/backfill.ts scripts/alerts.ts scripts/jev.ts test/heartbeat.test.ts
git commit -m "feat(workers): record per-cycle heartbeats"
```

---

### Task 6: Supervisor restart policy and log buffer

**Files:**
- Create: `src/lib/supervisor/policy.ts`, `src/lib/supervisor/logs.ts`
- Test: `test/supervisorPolicy.test.ts`, `test/supervisorLogs.test.ts`

**Interfaces:**
- Produces: `BACKOFF_STEPS_MS`, `CRASH_WINDOW_MS`, `CRASH_LIMIT`, `STABLE_RESET_MS`, `backoffDelay(attempt: number): number`, `recordCrash(history: number[], now: number): { history: number[]; crashLoop: boolean }`
- Produces: `type LogStream = 'out' | 'err' | 'sys'`, `interface LogLine { t: number; stream: LogStream; text: string }`, `class LogBuffer { constructor(opts?: { file?: string | null; maxLines?: number; maxBytes?: number; keepFiles?: number }); push(stream: LogStream, chunk: string): void; tail(n: number): LogLine[] }`

- [ ] **Step 1: Write the failing tests**

```ts
// test/supervisorPolicy.test.ts
import { describe, it, expect } from 'vitest';
import { backoffDelay, recordCrash, CRASH_WINDOW_MS } from '../src/lib/supervisor/policy';

describe('restart policy', () => {
  it('backs off 2s, 4s, 8s … capped at 60s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(backoffDelay)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(backoffDelay(-3)).toBe(2000);
  });
  it('flags a crash loop at 5 exits within 5 minutes', () => {
    let h: number[] = [];
    let loop = false;
    for (let i = 0; i < 5; i++) ({ history: h, crashLoop: loop } = recordCrash(h, 1000 + i * 1000));
    expect(loop).toBe(true);
  });
  it('forgets crashes older than the window', () => {
    const { history, crashLoop } = recordCrash([0, 1, 2, 3], CRASH_WINDOW_MS + 10);
    expect(history).toEqual([CRASH_WINDOW_MS + 10]);
    expect(crashLoop).toBe(false);
  });
});
```

```ts
// test/supervisorLogs.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LogBuffer } from '../src/lib/supervisor/logs';

describe('LogBuffer', () => {
  it('splits chunks into lines and keeps partial lines per stream', () => {
    const b = new LogBuffer();
    b.push('out', 'hello wo');
    b.push('err', 'boom\n');
    b.push('out', 'rld\nnext\r\n');
    expect(b.tail(10).map(l => `${l.stream}:${l.text}`)).toEqual(['err:boom', 'out:hello world', 'out:next']);
  });
  it('keeps only the last maxLines in memory', () => {
    const b = new LogBuffer({ maxLines: 3 });
    for (let i = 0; i < 10; i++) b.push('out', `${i}\n`);
    expect(b.tail(100).map(l => l.text)).toEqual(['7', '8', '9']);
    expect(b.tail(0)).toEqual([]);
  });
  it('writes to file and rotates keeping 2 old files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmp-logs-'));
    const file = path.join(dir, 'w.log');
    const b = new LogBuffer({ file, maxBytes: 200, keepFiles: 2 });
    for (let i = 0; i < 40; i++) b.push('out', `line ${i} ${'x'.repeat(20)}\n`);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(fs.existsSync(`${file}.2`)).toBe(true);
    expect(fs.existsSync(`${file}.3`)).toBe(false);
    expect(fs.statSync(file).size).toBeLessThanOrEqual(200);
    expect(fs.readFileSync(file, 'utf8')).toContain('line 39');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/supervisorPolicy.test.ts test/supervisorLogs.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/supervisor/policy.ts
export const BACKOFF_STEPS_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];
export const CRASH_WINDOW_MS = 5 * 60_000;
export const CRASH_LIMIT = 5;
/** A run this long counts as healthy and resets the backoff. */
export const STABLE_RESET_MS = 5 * 60_000;

export function backoffDelay(attempt: number): number {
  const i = Math.min(Math.max(attempt, 0), BACKOFF_STEPS_MS.length - 1);
  return BACKOFF_STEPS_MS[i];
}

/** Add a crash time; crashLoop is true once CRASH_LIMIT crashes fall inside CRASH_WINDOW_MS. */
export function recordCrash(history: number[], now: number): { history: number[]; crashLoop: boolean } {
  const recent = history.filter(t => now - t < CRASH_WINDOW_MS);
  recent.push(now);
  return { history: recent, crashLoop: recent.length >= CRASH_LIMIT };
}
```

```ts
// src/lib/supervisor/logs.ts
import fs from 'fs';
import path from 'path';

export type LogStream = 'out' | 'err' | 'sys';
export interface LogLine {
  t: number;
  stream: LogStream;
  text: string;
}

export interface LogBufferOptions {
  file?: string | null;
  maxLines?: number;
  maxBytes?: number;
  keepFiles?: number;
}

/** Last N lines in memory for the dashboard, plus a size-rotated log file. */
export class LogBuffer {
  private lines: LogLine[] = [];
  private partial: Record<LogStream, string> = { out: '', err: '', sys: '' };
  private size = 0;
  private readonly file: string | null;
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly keepFiles: number;

  constructor(opts: LogBufferOptions = {}) {
    this.file = opts.file ?? null;
    this.maxLines = opts.maxLines ?? 500;
    this.maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    this.keepFiles = opts.keepFiles ?? 2;
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      try {
        this.size = fs.statSync(this.file).size;
      } catch {
        this.size = 0;
      }
    }
  }

  push(stream: LogStream, chunk: string): void {
    const parts = (this.partial[stream] + chunk).split('\n');
    this.partial[stream] = parts.pop() ?? '';
    for (const p of parts) this.add(stream, p.replace(/\r$/, ''));
  }

  tail(n: number): LogLine[] {
    return n > 0 ? this.lines.slice(-n) : [];
  }

  private add(stream: LogStream, text: string) {
    const line = { t: Date.now(), stream, text };
    this.lines.push(line);
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
    if (this.file) this.write(`${new Date(line.t).toISOString()} [${stream}] ${text}\n`);
  }

  private write(s: string) {
    try {
      const bytes = Buffer.byteLength(s);
      if (this.size + bytes > this.maxBytes) this.rotate();
      fs.appendFileSync(this.file!, s);
      this.size += bytes;
    } catch {
      // disk problems must not take the supervisor down
    }
  }

  private rotate() {
    for (let i = this.keepFiles; i >= 1; i--) {
      const src = i === 1 ? this.file! : `${this.file}.${i - 1}`;
      if (fs.existsSync(src)) fs.renameSync(src, `${this.file}.${i}`);
    }
    this.size = 0;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/supervisorPolicy.test.ts test/supervisorLogs.test.ts && npx tsc --noEmit`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supervisor/policy.ts src/lib/supervisor/logs.ts test/supervisorPolicy.test.ts test/supervisorLogs.test.ts
git commit -m "feat(supervisor): add restart policy and rotating log buffer"
```

---

### Task 7: Worker process manager

**Files:**
- Create: `src/lib/supervisor/worker.ts`
- Test: `test/supervisorWorker.test.ts`

**Interfaces:**
- Consumes: `backoffDelay`, `recordCrash`, `STABLE_RESET_MS` (Task 6), `LogBuffer` (Task 6)
- Produces:
  - `type WorkerState = 'stopped' | 'starting' | 'running' | 'restarting' | 'crashed' | 'external'`
  - `interface ChildLike { pid?: number; stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null; once(event: 'exit' | 'error', listener: (...args: any[]) => void): unknown; kill(signal: NodeJS.Signals): void }`
  - `interface WorkerSpec { name: string; command: string; args: string[]; controllable: boolean }`
  - `interface WorkerStatus { name: string; state: WorkerState; pid: number | null; startedAt: number | null; restarts: number; lastExitCode: number | null; lastError: string | null; controllable: boolean; externalPid: number | null }`
  - `interface WorkerDeps { spawn: (command: string, args: string[]) => ChildLike; logs: LogBuffer; detectExternal?: () => number | null; stopGraceMs?: number }`
  - `class Worker { readonly spec: WorkerSpec; readonly logs: LogBuffer; status(): WorkerStatus; start(): WorkerStatus; stop(): Promise<WorkerStatus>; restart(): Promise<WorkerStatus> }`

- [ ] **Step 1: Write the failing test**

```ts
// test/supervisorWorker.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { Worker, type ChildLike } from '../src/lib/supervisor/worker';
import { LogBuffer } from '../src/lib/supervisor/logs';

class FakeChild extends EventEmitter implements ChildLike {
  static next = 100;
  pid = FakeChild.next++;
  stdout = new PassThrough();
  stderr = new PassThrough();
  signals: string[] = [];
  ignoreTerm = false;
  kill(signal: NodeJS.Signals) {
    this.signals.push(signal);
    if (signal === 'SIGTERM' && this.ignoreTerm) return;
    this.emit('exit', null, signal);
  }
  crash(code = 1) {
    this.emit('exit', code, null);
  }
}

function setup(opts: { external?: () => number | null } = {}) {
  const children: FakeChild[] = [];
  const spawn = vi.fn(() => {
    const c = new FakeChild();
    children.push(c);
    return c;
  });
  const w = new Worker(
    { name: 'crawl', command: 'tsx', args: ['scripts/crawl.ts'], controllable: true },
    { spawn, logs: new LogBuffer(), detectExternal: opts.external, stopGraceMs: 1000 }
  );
  return { w, spawn, children };
}

describe('Worker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts and reports running with pid', () => {
    const { w, spawn } = setup();
    const s = w.start();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(s.state).toBe('running');
    expect(s.pid).toBeGreaterThanOrEqual(100);
  });

  it('restarts after an unexpected exit with backoff', () => {
    const { w, spawn, children } = setup();
    w.start();
    children[0].stderr.write('Error: boom\n');
    children[0].crash(1);
    expect(w.status().state).toBe('restarting');
    expect(w.status().lastExitCode).toBe(1);
    expect(w.status().lastError).toBe('Error: boom');
    vi.advanceTimersByTime(1999);
    expect(spawn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(w.status().state).toBe('running');
    expect(w.status().restarts).toBe(1);
    children[1].crash(1);
    vi.advanceTimersByTime(3999);
    expect(spawn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('stops without restarting', async () => {
    const { w, spawn, children } = setup();
    w.start();
    const s = await w.stop();
    expect(children[0].signals).toEqual(['SIGTERM']);
    expect(s.state).toBe('stopped');
    vi.advanceTimersByTime(120_000);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('escalates to SIGKILL after the grace period', async () => {
    const { w, children } = setup();
    w.start();
    children[0].ignoreTerm = true;
    const p = w.stop();
    await vi.advanceTimersByTimeAsync(1000);
    const s = await p;
    expect(children[0].signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(s.state).toBe('stopped');
  });

  it('gives up after 5 crashes in 5 minutes until started manually', () => {
    const { w, spawn, children } = setup();
    w.start();
    for (let i = 0; i < 5; i++) {
      children[children.length - 1].crash(1);
      vi.advanceTimersByTime(60_000);
    }
    expect(w.status().state).toBe('crashed');
    const calls = spawn.mock.calls.length;
    vi.advanceTimersByTime(600_000);
    expect(spawn.mock.calls.length).toBe(calls);
    w.start();
    expect(w.status().state).toBe('running');
  });

  it('treats a spawn failure as a crash', () => {
    const spawn = vi.fn(() => {
      throw new Error('ENOENT tsx');
    });
    const w = new Worker({ name: 'x', command: 'nope', args: [], controllable: true }, { spawn, logs: new LogBuffer() });
    w.start();
    expect(w.status().state).toBe('restarting');
    expect(w.status().lastError).toBe('ENOENT tsx');
  });

  it('does not start a second copy when one runs outside the supervisor, and never kills it', async () => {
    const external = vi.fn(() => 4242);
    const { w, spawn } = setup({ external });
    const s = w.start();
    expect(spawn).not.toHaveBeenCalled();
    expect(s.state).toBe('external');
    expect(s.externalPid).toBe(4242);
    expect((await w.stop()).state).toBe('external');
    expect((await w.restart()).state).toBe('external');
    external.mockReturnValue(null as any);
    vi.advanceTimersByTime(11_000);
    expect(w.status().state).toBe('stopped');
  });

  it('restart resets a crashed worker', async () => {
    const { w, children } = setup();
    w.start();
    for (let i = 0; i < 5; i++) {
      children[children.length - 1].crash(1);
      vi.advanceTimersByTime(60_000);
    }
    expect(w.status().state).toBe('crashed');
    expect((await w.restart()).state).toBe('running');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/supervisorWorker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/supervisor/worker.ts
import { backoffDelay, recordCrash, STABLE_RESET_MS } from './policy';
import type { LogBuffer } from './logs';

export type WorkerState = 'stopped' | 'starting' | 'running' | 'restarting' | 'crashed' | 'external';

export interface ChildLike {
  pid?: number;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  once(event: 'exit' | 'error', listener: (...args: any[]) => void): unknown;
  kill(signal: NodeJS.Signals): void;
}

export interface WorkerSpec {
  name: string;
  command: string;
  args: string[];
  controllable: boolean;
}

export interface WorkerStatus {
  name: string;
  state: WorkerState;
  pid: number | null;
  startedAt: number | null;
  restarts: number;
  lastExitCode: number | null;
  lastError: string | null;
  controllable: boolean;
  externalPid: number | null;
}

export interface WorkerDeps {
  spawn: (command: string, args: string[]) => ChildLike;
  logs: LogBuffer;
  /** pid of a copy already running outside the supervisor, or null */
  detectExternal?: () => number | null;
  stopGraceMs?: number;
}

const EXTERNAL_RECHECK_MS = 10_000;

/** One supervised child process: start/stop/restart, crash backoff, crash-loop cut-off. */
export class Worker {
  private state: WorkerState = 'stopped';
  private child: ChildLike | null = null;
  private startedAt: number | null = null;
  private restarts = 0;
  private attempt = 0;
  private crashes: number[] = [];
  private lastExitCode: number | null = null;
  private lastError: string | null = null;
  private externalPid: number | null = null;
  private lastExternalCheck = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private exitWaiters: Array<() => void> = [];

  constructor(readonly spec: WorkerSpec, private readonly deps: WorkerDeps) {}

  get logs(): LogBuffer {
    return this.deps.logs;
  }

  status(): WorkerStatus {
    if (this.state === 'external' && Date.now() - this.lastExternalCheck >= EXTERNAL_RECHECK_MS) {
      this.lastExternalCheck = Date.now();
      const pid = this.deps.detectExternal?.() ?? null;
      if (pid) this.externalPid = pid;
      else {
        this.state = 'stopped';
        this.externalPid = null;
        this.sys('outside copy is gone; press Start to run it here');
      }
    }
    return {
      name: this.spec.name,
      state: this.state,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      restarts: this.restarts,
      lastExitCode: this.lastExitCode,
      lastError: this.lastError,
      controllable: this.spec.controllable,
      externalPid: this.externalPid,
    };
  }

  start(): WorkerStatus {
    if (this.state === 'running' || this.state === 'starting' || this.state === 'restarting') return this.status();
    this.crashes = [];
    this.attempt = 0;
    this.spawnNow();
    return this.status();
  }

  async stop(): Promise<WorkerStatus> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // never signal a process the supervisor did not start
    if (this.state === 'external') return this.status();
    const child = this.child;
    if (!child) {
      this.state = 'stopped';
      return this.status();
    }
    this.stopping = true;
    const exited = new Promise<void>(r => this.exitWaiters.push(r));
    child.kill('SIGTERM');
    const grace = this.deps.stopGraceMs ?? 10_000;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      exited.then(() => 'exited' as const),
      new Promise<'timeout'>(r => {
        graceTimer = setTimeout(() => r('timeout'), grace);
      }),
    ]);
    clearTimeout(graceTimer);
    if (outcome === 'timeout') {
      this.sys(`did not exit within ${grace / 1000}s; sending SIGKILL`);
      child.kill('SIGKILL');
      await Promise.race([exited, new Promise(r => setTimeout(r, 2_000))]);
    }
    return this.status();
  }

  async restart(): Promise<WorkerStatus> {
    await this.stop();
    if (this.state === 'external') return this.status();
    this.state = 'stopped';
    return this.start();
  }

  private sys(msg: string) {
    this.deps.logs.push('sys', `[supervisor] ${msg}\n`);
  }

  private spawnNow() {
    this.timer = null;
    const ext = this.deps.detectExternal?.() ?? null;
    this.lastExternalCheck = Date.now();
    if (ext) {
      this.state = 'external';
      this.externalPid = ext;
      this.sys(`already running outside the supervisor (pid ${ext}); not starting a second copy`);
      return;
    }
    this.externalPid = null;
    this.state = 'starting';
    this.stopping = false;
    let child: ChildLike;
    try {
      child = this.deps.spawn(this.spec.command, this.spec.args);
    } catch (err) {
      this.onExit(null, (err as Error).message);
      return;
    }
    this.child = child;
    this.startedAt = Date.now();
    child.stdout?.on('data', (d: Buffer | string) => this.deps.logs.push('out', String(d)));
    child.stderr?.on('data', (d: Buffer | string) => {
      const text = String(d);
      this.deps.logs.push('err', text);
      const last = text.trim().split('\n').pop();
      if (last) this.lastError = last.slice(0, 300);
    });
    let settled = false;
    const done = (code: number | null, errText?: string) => {
      if (settled) return;
      settled = true;
      this.onExit(code, errText);
    };
    child.once('exit', (code: number | null) => done(code));
    child.once('error', (err: Error) => done(null, err.message));
    if (this.child === child) {
      this.state = 'running';
      this.sys(`started (pid ${child.pid ?? '?'})`);
    }
  }

  private onExit(code: number | null, errText?: string) {
    const ranFor = this.startedAt ? Date.now() - this.startedAt : 0;
    this.child = null;
    this.startedAt = null;
    this.lastExitCode = code;
    if (errText) this.lastError = errText.slice(0, 300);
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    waiters.forEach(w => w());

    if (this.stopping) {
      this.stopping = false;
      this.state = 'stopped';
      this.sys(`stopped (exit ${code ?? 'signal'})`);
      return;
    }

    this.sys(`exited unexpectedly (code ${code ?? 'signal'})`);
    if (ranFor >= STABLE_RESET_MS) this.attempt = 0;
    const { history, crashLoop } = recordCrash(this.crashes, Date.now());
    this.crashes = history;
    if (crashLoop) {
      this.state = 'crashed';
      this.sys('crashed 5 times in 5 minutes; not restarting until started manually');
      return;
    }
    const delay = backoffDelay(this.attempt++);
    this.state = 'restarting';
    this.restarts++;
    this.sys(`restarting in ${delay / 1000}s`);
    this.timer = setTimeout(() => this.spawnNow(), delay);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/supervisorWorker.test.ts && npx tsc --noEmit`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supervisor/worker.ts test/supervisorWorker.test.ts
git commit -m "feat(supervisor): add worker process manager with backoff and external-copy detection"
```

---

### Task 8: Supervisor entry, control API and client

**Files:**
- Create: `src/lib/supervisor/config.ts`, `src/lib/supervisor/control.ts`, `src/lib/supervisor/client.ts`, `scripts/supervisor.ts`
- Modify: `package.json` (add `"supervisor": "tsx scripts/supervisor.ts"`), `.gitignore` (add `/logs/` and `/.supervisor-token`)
- Test: `test/supervisorControl.test.ts`

**Interfaces:**
- Consumes: `Worker`, `WorkerSpec`, `ChildLike` (Task 7), `LogBuffer` (Task 6), `getSetting`, `WORKER_NAMES` (Task 3), `initializeDb`
- Produces: `WEB_PORT: number`, `SUPERVISOR_PORT: number`, `TOKEN_FILE: string` (config.ts)
- Produces: `createControlHandler(ctx: { workers: Map<string, Worker>; token: string; startedAt: number }): (req: IncomingMessage, res: ServerResponse) => Promise<void>`
- Produces: `supervisorRequest<T = any>(pathname: string, method?: 'GET' | 'POST'): Promise<{ ok: boolean; status: number; body: T } | null>` — `null` when the supervisor is down

- [ ] **Step 1: Write the failing test**

```ts
// test/supervisorControl.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { AddressInfo } from 'net';
import { Worker } from '../src/lib/supervisor/worker';
import { LogBuffer } from '../src/lib/supervisor/logs';
import { createControlHandler } from '../src/lib/supervisor/control';

function fakeSpawn() {
  const c = Object.assign(new EventEmitter(), {
    pid: 777,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill(sig: string) {
      c.emit('exit', null, sig);
    },
  });
  return c;
}

describe('supervisor control API', () => {
  let server: http.Server;
  let base = '';
  const token = 't0k3n';
  const auth = { Authorization: `Bearer ${token}` };

  beforeAll(async () => {
    const mk = (name: string, controllable: boolean) =>
      new Worker({ name, command: 'x', args: [], controllable }, { spawn: fakeSpawn, logs: new LogBuffer() });
    const workers = new Map([['web', mk('web', false)], ['crawl', mk('crawl', true)]]);
    workers.get('crawl')!.logs.push('out', 'hello\n');
    server = http.createServer(createControlHandler({ workers, token, startedAt: 1 }));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  it('rejects requests without the token', async () => {
    expect((await fetch(`${base}/status`)).status).toBe(401);
    expect((await fetch(`${base}/status`, { headers: { Authorization: 'Bearer wrong!' } })).status).toBe(401);
  });
  it('reports status', async () => {
    const body = await (await fetch(`${base}/status`, { headers: auth })).json();
    expect(body.supervisor.startedAt).toBe(1);
    expect(body.workers.map((w: any) => w.name)).toEqual(['web', 'crawl']);
  });
  it('starts and stops a controllable worker', async () => {
    let r = await fetch(`${base}/workers/crawl/start`, { method: 'POST', headers: auth });
    expect((await r.json()).state).toBe('running');
    r = await fetch(`${base}/workers/crawl/stop`, { method: 'POST', headers: auth });
    expect((await r.json()).state).toBe('stopped');
  });
  it('refuses to control the web app and unknown workers', async () => {
    expect((await fetch(`${base}/workers/web/stop`, { method: 'POST', headers: auth })).status).toBe(409);
    expect((await fetch(`${base}/workers/nope/stop`, { method: 'POST', headers: auth })).status).toBe(404);
    expect((await fetch(`${base}/workers/crawl/explode`, { method: 'POST', headers: auth })).status).toBe(404);
  });
  it('returns log tails capped at 500', async () => {
    const body = await (await fetch(`${base}/workers/crawl/logs?tail=9999`, { headers: auth })).json();
    expect(body.lines.some((l: any) => l.text === 'hello')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/supervisorControl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/supervisor/config.ts
import path from 'path';

export const WEB_PORT = Number(process.env.PMP_PORT || 8000);
export const SUPERVISOR_PORT = Number(process.env.SUPERVISOR_PORT || 8001);
/** Random token written by the supervisor at startup; only local processes that can read it may call the control API. */
export const TOKEN_FILE = path.join(process.cwd(), '.supervisor-token');
```

```ts
// src/lib/supervisor/control.ts
import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Worker } from './worker';

export interface ControlContext {
  workers: Map<string, Worker>;
  token: string;
  startedAt: number;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(header || '');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

/** HTTP handler for the supervisor control API (bound to 127.0.0.1 by scripts/supervisor.ts). */
export function createControlHandler(ctx: ControlContext) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!tokenMatches(req.headers.authorization, ctx.token)) return send(401, { error: 'unauthorized' });

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const [section, name, action] = url.pathname.split('/').filter(Boolean);
    try {
      if (req.method === 'GET' && section === 'status' && !name) {
        return send(200, {
          supervisor: { pid: process.pid, startedAt: ctx.startedAt },
          workers: [...ctx.workers.values()].map(w => w.status()),
        });
      }
      if (section === 'workers' && name) {
        const w = ctx.workers.get(name);
        if (!w) return send(404, { error: 'unknown worker' });
        if (req.method === 'GET' && action === 'logs') {
          const tail = Math.min(Math.max(parseInt(url.searchParams.get('tail') || '200') || 200, 1), 500);
          return send(200, { lines: w.logs.tail(tail) });
        }
        if (req.method === 'POST' && (action === 'start' || action === 'stop' || action === 'restart')) {
          if (!w.spec.controllable) return send(409, { error: `${name} cannot be controlled from the dashboard` });
          const status = action === 'start' ? w.start() : action === 'stop' ? await w.stop() : await w.restart();
          return send(200, status);
        }
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      return send(500, { error: (e as Error).message });
    }
  };
}
```

```ts
// src/lib/supervisor/client.ts
import fs from 'fs';
import { SUPERVISOR_PORT, TOKEN_FILE } from './config';

export interface SupervisorResponse<T = any> {
  ok: boolean;
  status: number;
  body: T;
}

/** Call the local supervisor. Returns null when it is not running or does not answer. */
export async function supervisorRequest<T = any>(pathname: string, method: 'GET' | 'POST' = 'GET'): Promise<SupervisorResponse<T> | null> {
  let token: string;
  try {
    token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return null;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${SUPERVISOR_PORT}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      // stop waits up to 10s for a graceful exit
      signal: AbortSignal.timeout(method === 'POST' ? 15_000 : 2_000),
    });
    return { ok: res.ok, status: res.status, body: (await res.json().catch(() => null)) as T };
  } catch {
    return null;
  }
}
```

```ts
// scripts/supervisor.ts
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { initializeDb } from '../src/lib/db';
import { getSetting, WORKER_NAMES } from '../src/lib/settings';
import { LogBuffer } from '../src/lib/supervisor/logs';
import { Worker, type ChildLike, type WorkerSpec } from '../src/lib/supervisor/worker';
import { createControlHandler } from '../src/lib/supervisor/control';
import { SUPERVISOR_PORT, TOKEN_FILE, WEB_PORT } from '../src/lib/supervisor/config';

/**
 * Runs the web app and the background workers, restarts crashed workers, keeps logs in logs/<name>.log,
 * and serves the control API used by /control. A worker that is already running outside the supervisor
 * (launchd, another terminal, the IDE) is reported as "external" and not started twice.
 *
 * Env: PMP_PORT (web, default 8000), SUPERVISOR_PORT (default 8001),
 *      SUPERVISOR_AUTOSTART=comma list to override the autostart settings (e.g. "web,backfill").
 */

const ROOT = fs.realpathSync(process.cwd());
const bin = (name: string) => path.join(ROOT, 'node_modules', '.bin', name);
const childEnv = { ...process.env, PMP_BASE_URL: process.env.PMP_BASE_URL || `http://127.0.0.1:${WEB_PORT}` };

const specs: WorkerSpec[] = [
  { name: 'web', command: bin('next'), args: ['dev', '-H', '127.0.0.1', '-p', String(WEB_PORT)], controllable: false },
  ...WORKER_NAMES.map(name => ({ name, command: bin('tsx'), args: [`scripts/${name}.ts`], controllable: true })),
];

function spawnChild(command: string, args: string[]): ChildLike {
  // own process group, so stop() also reaches the grandchildren (tsx → node, next → next-server)
  const child = spawn(command, args, { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  return {
    pid: child.pid,
    stdout: child.stdout,
    stderr: child.stderr,
    once: (event, listener) => child.once(event, listener),
    kill: signal => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    },
  };
}

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function cwdOf(pid: number): string | null {
  const line = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find(l => l.startsWith('n'));
  return line ? line.slice(1) : null;
}

function detectExternalFor(name: string): () => number | null {
  if (name === 'web') {
    return () => {
      const pid = parseInt(run('lsof', ['-nP', `-iTCP:${WEB_PORT}`, '-sTCP:LISTEN', '-t']).split('\n')[0], 10);
      return pid > 0 ? pid : null;
    };
  }
  const needle = `scripts/${name}.ts`;
  return () => {
    for (const line of run('ps', ['-axo', 'pid=,command=']).split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const command = m[2];
      if (pid === process.pid || !command.includes(needle)) continue;
      if (command.includes(path.join(ROOT, needle)) || cwdOf(pid) === ROOT) return pid;
    }
    return null;
  };
}

function autostartNames(): Set<string> {
  const override = process.env.SUPERVISOR_AUTOSTART;
  if (override !== undefined) return new Set(override.split(',').map(s => s.trim()).filter(Boolean));
  const flags = getSetting('supervisor.autostart');
  return new Set(['web', ...WORKER_NAMES.filter(n => flags[n])]);
}

async function main() {
  initializeDb();
  const token = crypto.randomBytes(32).toString('hex');
  const workers = new Map<string, Worker>();
  for (const spec of specs) {
    workers.set(
      spec.name,
      new Worker(spec, {
        spawn: spawnChild,
        logs: new LogBuffer({ file: path.join(ROOT, 'logs', `${spec.name}.log`) }),
        detectExternal: detectExternalFor(spec.name),
      })
    );
  }

  const server = http.createServer(createControlHandler({ workers, token, startedAt: Date.now() }));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(SUPERVISOR_PORT, '127.0.0.1', () => resolve());
  });
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  console.log(`[supervisor] control API on http://127.0.0.1:${SUPERVISOR_PORT} — dashboard: http://127.0.0.1:${WEB_PORT}/control`);

  const autostart = autostartNames();
  for (const [name, w] of workers) {
    if (!autostart.has(name)) {
      console.log(`[supervisor] ${name}: autostart off`);
      continue;
    }
    const s = w.start();
    console.log(`[supervisor] ${name}: ${s.state}${s.externalPid ? ` (already running outside the supervisor, pid ${s.externalPid})` : ''}`);
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[supervisor] stopping workers…');
    await Promise.all([...workers.values()].map(w => w.stop()));
    server.close();
    try {
      fs.unlinkSync(TOKEN_FILE);
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[supervisor] failed to start:', err);
  process.exit(1);
});
```

`package.json` scripts: add `"supervisor": "tsx scripts/supervisor.ts",` after `"start"`.

`.gitignore`: append

```
# supervisor (scripts/supervisor.ts)
/logs/
/.supervisor-token
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/supervisorControl.test.ts && npx tsc --noEmit`
Expected: 5 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supervisor/config.ts src/lib/supervisor/control.ts src/lib/supervisor/client.ts scripts/supervisor.ts package.json .gitignore test/supervisorControl.test.ts
git commit -m "feat(supervisor): add supervisor entry script, token-protected control API and client"
```

---

### Task 9: Control and settings API routes

**Files:**
- Create: `src/lib/openrouterCredit.ts`
- Create: `src/app/api/control/status/route.ts`, `src/app/api/control/workers/[name]/route.ts`, `src/app/api/control/logs/[name]/route.ts`, `src/app/api/control/health/route.ts`
- Create: `src/app/api/settings/route.ts`, `src/app/api/settings/test/route.ts`
- Test: `test/controlApi.test.ts`

**Interfaces:**
- Consumes: `supervisorRequest` (Task 8), `publicSettings`, `applySettingChanges`, `getSetting`, `WORKER_NAMES` (Task 3), `readHeartbeats` (Task 5), `sendTelegram` (`src/lib/alerts.ts`), `pingLlm` (Task 2), `JEV_COINS` (Task 2)
- Produces (JSON shapes the page relies on):
  - `GET /api/control/status` → `{ supervisor: { pid: number; startedAt: number } | null; workers: Array<WorkerStatus-like & { name; state: WorkerState | 'unknown'; controllable: boolean; heartbeat: Heartbeat | null; intervalSec: number | null }>; now: number }`
  - `POST /api/control/workers/[name]` body `{ action: 'start' | 'stop' | 'restart' }` → worker status, or `{ error }` with 400/409/503
  - `GET /api/control/logs/[name]?tail=N` → `{ lines: LogLine[] }` or 503
  - `GET /api/control/health` → `{ dbBytes: number; walBytes: number; jevBytes: number; openrouter: OpenRouterCredit | null; openrouterError: string | null }`
  - `GET /api/settings` → `{ settings: Record<SettingKey, PublicSetting>; coins: string[] }`
  - `PUT /api/settings` body `{ changes: Record<string, unknown> }` → `{ ok: true; restarted: string[]; pending: string[]; supervisor: boolean }` or 400 `{ ok: false; errors }`
  - `POST /api/settings/test` body `{ target: 'telegram' | 'openrouter' | 'llm' }` → `{ ok: boolean; message: string }`
  - `getOpenRouterCredit(opts?: { fresh?: boolean }): Promise<OpenRouterCredit>`, `interface OpenRouterCredit { label: string | null; usage: number | null; limit: number | null; remaining: number | null }`

- [ ] **Step 1: Write the failing test**

```ts
// test/controlApi.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as dbModule from '../src/lib/db';

vi.mock('@/lib/supervisor/client', () => ({ supervisorRequest: vi.fn() }));
import { supervisorRequest } from '@/lib/supervisor/client';
import { GET as getSettings, PUT as putSettings } from '../src/app/api/settings/route';
import { GET as getStatus } from '../src/app/api/control/status/route';
import { POST as postWorker } from '../src/app/api/control/workers/[name]/route';

const KEY = 'sk-or-v1-0123456789abcdefWXYZ';
const put = (changes: Record<string, unknown>) =>
  putSettings(new Request('http://localhost/api/settings', { method: 'PUT', body: JSON.stringify({ changes }) }));

describe('control + settings API', () => {
  let db: Database.Database;
  const sup = supervisorRequest as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => {
    db = new Database(':memory:');
    dbModule.initializeDb(db);
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db);
    sup.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('GET /api/settings never includes secret values', async () => {
    await put({ 'openrouter.apiKey': KEY });
    const text = await (await getSettings()).text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).settings['openrouter.apiKey'].masked).toBe('…WXYZ');
  });

  it('PUT returns field errors and saves nothing', async () => {
    const res = await put({ 'crawl.intervalSec': 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).errors['crawl.intervalSec']).toMatch(/10 to 600/);
  });

  it('PUT restarts only affected workers that are running', async () => {
    sup.mockImplementation(async (p: string) =>
      p === '/status'
        ? { ok: true, status: 200, body: { supervisor: { pid: 1, startedAt: 1 }, workers: [{ name: 'jev', state: 'running' }, { name: 'crawl', state: 'external' }] } }
        : { ok: true, status: 200, body: {} }
    );
    const body = await (await put({ 'jev.coins': ['btc'], 'crawl.intervalSec': 20 })).json();
    expect(body).toEqual({ ok: true, restarted: ['jev'], pending: ['crawl'], supervisor: true });
    expect(sup).toHaveBeenCalledWith('/workers/jev/restart', 'POST');
    expect(sup).not.toHaveBeenCalledWith('/workers/crawl/restart', 'POST');
  });

  it('PUT still saves when the supervisor is down', async () => {
    sup.mockResolvedValue(null);
    const body = await (await put({ 'crawl.intervalSec': 20 })).json();
    expect(body).toEqual({ ok: true, restarted: [], pending: ['crawl'], supervisor: false });
  });

  it('status works without the supervisor and includes heartbeats', async () => {
    sup.mockResolvedValue(null);
    const body = await (await getStatus()).json();
    expect(body.supervisor).toBeNull();
    expect(body.workers.map((w: any) => w.name)).toEqual(['web', 'crawl', 'backfill', 'alerts', 'jev']);
    expect(body.workers[1]).toMatchObject({ state: 'unknown', intervalSec: 30, controllable: true });
  });

  it('worker actions validate input and report a missing supervisor', async () => {
    const call = (name: string, action: string) =>
      postWorker(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ action }) }), { params: Promise.resolve({ name }) });
    expect((await call('crawl', 'explode')).status).toBe(400);
    expect((await call('nope', 'stop')).status).toBe(400);
    sup.mockResolvedValue(null);
    expect((await call('crawl', 'stop')).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/controlApi.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/openrouterCredit.ts
import { getSetting } from './settings';

export interface OpenRouterCredit {
  label: string | null;
  usage: number | null;
  limit: number | null;
  remaining: number | null;
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; key: string; value: OpenRouterCredit } | null = null;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Key info from OpenRouter's free /api/v1/key endpoint (no model call), cached 5 minutes. */
export async function getOpenRouterCredit(opts: { fresh?: boolean } = {}): Promise<OpenRouterCredit> {
  const key = getSetting('openrouter.apiKey');
  if (!key) throw new Error('OpenRouter API key is not set');
  if (!opts.fresh && cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;
  const res = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OpenRouter answered HTTP ${res.status}`);
  const d = ((await res.json()) as any)?.data ?? {};
  const value = { label: d.label ?? null, usage: num(d.usage), limit: num(d.limit), remaining: num(d.limit_remaining) };
  cache = { at: Date.now(), key, value };
  return value;
}
```

```ts
// src/app/api/control/status/route.ts
import { NextResponse } from 'next/server';
import { supervisorRequest } from '@/lib/supervisor/client';
import { readHeartbeats } from '@/lib/heartbeat';
import { getSetting, WORKER_NAMES } from '@/lib/settings';

export const dynamic = 'force-dynamic';

function intervalSec(name: string): number | null {
  if (name === 'crawl') return getSetting('crawl.intervalSec');
  if (name === 'alerts') return getSetting('alerts.intervalSec');
  if (name === 'jev') return getSetting('jev.snapshotIntervalSec');
  if (name === 'backfill') return 60;
  return null;
}

export async function GET() {
  const sup = await supervisorRequest('/status');
  const heartbeats = readHeartbeats();
  const running: any[] = sup?.ok ? sup.body?.workers ?? [] : [];
  const workers = ['web', ...WORKER_NAMES].map(name => ({
    name,
    state: 'unknown',
    controllable: name !== 'web',
    ...(running.find(w => w.name === name) ?? {}),
    heartbeat: heartbeats[name] ?? null,
    intervalSec: intervalSec(name),
  }));
  return NextResponse.json({ supervisor: sup?.ok ? sup.body.supervisor : null, workers, now: Date.now() });
}
```

```ts
// src/app/api/control/workers/[name]/route.ts
import { NextResponse } from 'next/server';
import { supervisorRequest } from '@/lib/supervisor/client';
import { WORKER_NAMES } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const ACTIONS = ['start', 'stop', 'restart'];

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (!(WORKER_NAMES as string[]).includes(name) || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'unknown worker or action' }, { status: 400 });
  }
  const r = await supervisorRequest(`/workers/${name}/${action}`, 'POST');
  if (!r) return NextResponse.json({ error: 'supervisor is not running — start it with npm run supervisor' }, { status: 503 });
  return NextResponse.json(r.body, { status: r.status });
}
```

```ts
// src/app/api/control/logs/[name]/route.ts
import { NextResponse } from 'next/server';
import { supervisorRequest } from '@/lib/supervisor/client';
import { WORKER_NAMES } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!['web', ...WORKER_NAMES].includes(name)) return NextResponse.json({ error: 'unknown worker' }, { status: 400 });
  const tail = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('tail') || '200') || 200, 1), 500);
  const r = await supervisorRequest(`/workers/${name}/logs?tail=${tail}`);
  if (!r) return NextResponse.json({ error: 'supervisor is not running' }, { status: 503 });
  return NextResponse.json(r.body, { status: r.status });
}
```

```ts
// src/app/api/control/health/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getOpenRouterCredit } from '@/lib/openrouterCredit';

export const dynamic = 'force-dynamic';

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function dirSize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fileSize(p);
  }
  return total;
}

export async function GET() {
  const root = process.cwd();
  let openrouter = null;
  let openrouterError: string | null = null;
  try {
    openrouter = await getOpenRouterCredit();
  } catch (e) {
    openrouterError = (e as Error).message;
  }
  return NextResponse.json({
    dbBytes: fileSize(path.join(root, 'polymarket.db')),
    walBytes: fileSize(path.join(root, 'polymarket.db-wal')),
    jevBytes: dirSize(path.join(root, 'jev')),
    openrouter,
    openrouterError,
  });
}
```

```ts
// src/app/api/settings/route.ts
import { NextResponse } from 'next/server';
import { applySettingChanges, publicSettings } from '@/lib/settings';
import { supervisorRequest } from '@/lib/supervisor/client';
import { JEV_COINS } from '@/lib/coins';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ settings: publicSettings(), coins: JEV_COINS });
}

/** Save settings, then restart the affected workers that the supervisor is running. */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const changes = body?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return NextResponse.json({ ok: false, errors: { _: 'changes object required' } }, { status: 400 });
  }
  const result = applySettingChanges(changes);
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  const status = result.restarts.length ? await supervisorRequest('/status') : null;
  const states = new Map<string, string>((status?.ok ? status.body?.workers ?? [] : []).map((w: any) => [w.name, w.state]));
  const restarted: string[] = [];
  const pending: string[] = [];
  for (const name of result.restarts) {
    const state = states.get(name);
    if (state === 'running' || state === 'restarting') {
      const r = await supervisorRequest(`/workers/${name}/restart`, 'POST');
      (r?.ok ? restarted : pending).push(name);
    } else {
      pending.push(name);
    }
  }
  return NextResponse.json({ ok: true, restarted, pending, supervisor: !!status?.ok });
}
```

```ts
// src/app/api/settings/test/route.ts
import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';
import { sendTelegram } from '@/lib/alerts';
import { pingLlm } from '@/lib/llmPing';
import { getOpenRouterCredit } from '@/lib/openrouterCredit';

export const dynamic = 'force-dynamic';

/** Check saved credentials: Telegram test message, OpenRouter key info (free), or a 5-token LLM ping. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const target = body?.target;
  try {
    if (target === 'telegram') {
      const token = getSetting('jev.telegramToken');
      const chat = getSetting('jev.telegramChat');
      if (!token || !chat) return NextResponse.json({ ok: false, message: 'Save a bot token and chat ID first' });
      const ok = await sendTelegram(token, chat, '✅ Polymarket Pulse: Jev Telegram settings work.');
      return NextResponse.json({ ok, message: ok ? 'Test message sent' : 'Telegram rejected the message — check token and chat ID' });
    }
    if (target === 'openrouter') {
      const c = await getOpenRouterCredit({ fresh: true });
      const left = c.remaining != null ? `$${c.remaining.toFixed(2)} left` : 'no credit limit set';
      return NextResponse.json({ ok: true, message: `Key works — ${left}${c.usage != null ? `, $${c.usage.toFixed(2)} used` : ''}` });
    }
    if (target === 'llm') {
      const baseUrl = getSetting('llm.baseUrl');
      const apiKey = getSetting('llm.apiKey');
      const model = getSetting('llm.model');
      if (!baseUrl || !apiKey || !model) return NextResponse.json({ ok: false, message: 'Save base URL, API key and model first' });
      const r = await pingLlm(baseUrl, apiKey, model);
      return NextResponse.json({ ok: r.ok, message: r.ok ? 'LLM endpoint answered' : r.error || 'failed' });
    }
    return NextResponse.json({ ok: false, message: 'unknown test target' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openrouterCredit.ts src/app/api/control src/app/api/settings test/controlApi.test.ts
git commit -m "feat(control): add control, health and settings API routes"
```

---

### Task 10: `/control` page and navigation link

**Files:**
- Create: `src/components/control/types.ts`, `src/components/control/format.ts`, `src/components/control/WorkersPanel.tsx`, `src/components/control/LogsPanel.tsx`, `src/components/control/HealthStrip.tsx`, `src/components/control/SettingsPanel.tsx`
- Create: `src/app/control/page.tsx`
- Modify: `src/components/Navigation.tsx` (dirty file — stage only our hunk, see Step 3)

**Interfaces:**
- Consumes: the JSON shapes from Task 9; `heartbeatFreshness` (Task 5); `type PublicSetting`, `type SettingKey` (Task 3, type-only imports)

- [ ] **Step 1: Shared types and formatting**

```ts
// src/components/control/types.ts
import type { Heartbeat } from '@/lib/heartbeat';

export type WorkerState = 'stopped' | 'starting' | 'running' | 'restarting' | 'crashed' | 'external' | 'unknown';

export interface WorkerRow {
  name: string;
  state: WorkerState;
  controllable: boolean;
  pid?: number | null;
  startedAt?: number | null;
  restarts?: number;
  lastExitCode?: number | null;
  lastError?: string | null;
  externalPid?: number | null;
  heartbeat: Heartbeat | null;
  intervalSec: number | null;
}

export interface StatusPayload {
  supervisor: { pid: number; startedAt: number } | null;
  workers: WorkerRow[];
  now: number;
}

export interface LogLine {
  t: number;
  stream: 'out' | 'err' | 'sys';
  text: string;
}
```

```ts
// src/components/control/format.ts
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export const card = 'bg-white/[0.04] border border-[rgba(190,190,200,0.12)] rounded-2xl';
export const btn =
  'inline-flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.10] border border-[rgba(190,190,200,0.15)] text-[#e8e8e4] rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-35 disabled:cursor-not-allowed';
export const input =
  'w-full bg-white/[0.06] text-[#e8e8e4] border border-[rgba(190,190,200,0.15)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#9fb4ee] placeholder:text-[#73757c]';
```

- [ ] **Step 2: Components and page**

```tsx
// src/components/control/WorkersPanel.tsx
"use client";

import { Play, RotateCw, Square } from "lucide-react";
import { heartbeatFreshness } from "@/lib/staleness";
import { btn, card, formatDuration } from "./format";
import type { StatusPayload, WorkerState } from "./types";

const STATE_STYLE: Record<WorkerState, string> = {
  running: "bg-[#5fbf9a]/10 text-[#5fbf9a] border-[#5fbf9a]/30",
  starting: "bg-[#d4b063]/10 text-[#d4b063] border-[#d4b063]/30",
  restarting: "bg-[#d4b063]/10 text-[#d4b063] border-[#d4b063]/30",
  crashed: "bg-[#e5787f]/10 text-[#e5787f] border-[#e5787f]/30",
  stopped: "bg-white/[0.04] text-[#9a9ca3] border-[rgba(190,190,200,0.15)]",
  external: "bg-[#9fb4ee]/10 text-[#9fb4ee] border-[#9fb4ee]/30",
  unknown: "bg-white/[0.04] text-[#73757c] border-[rgba(190,190,200,0.15)]",
};

const FRESH_STYLE = { fresh: "text-[#5fbf9a]", stale: "text-[#d4b063]", dead: "text-[#e5787f]", none: "text-[#73757c]" };

const DESCRIPTIONS: Record<string, string> = {
  web: "Dashboard server (status only)",
  crawl: "Polls the global trade feed",
  backfill: "Resolves each wallet's true first trade",
  alerts: "Evaluates alert rules, sends Telegram",
  jev: "Snapshots + Jev/Kev/Span model calls",
};

export function WorkersPanel({
  status,
  busy,
  onAction,
}: {
  status: StatusPayload | null;
  busy: string | null;
  onAction: (name: string, action: "start" | "stop" | "restart") => void;
}) {
  const supervisorUp = !!status?.supervisor;
  const now = status?.now ?? Date.now();
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <h2 className="text-sm font-medium text-[#e8e8e4]">Workers</h2>
        {status?.supervisor && (
          <span className="text-[11px] text-[#73757c]">
            supervisor pid {status.supervisor.pid} · up {formatDuration(now - status.supervisor.startedAt)}
          </span>
        )}
      </div>
      <div className="divide-y divide-white/[0.06]">
        {(status?.workers ?? []).map(w => {
          const fresh = heartbeatFreshness(w.heartbeat?.last_ok_at, w.intervalSec, now);
          const lastOkAgo = w.heartbeat?.last_ok_at ? formatDuration(now - w.heartbeat.last_ok_at * 1000) : null;
          const isBusy = busy?.startsWith(`${w.name}:`);
          const canStart = supervisorUp && w.controllable && ["stopped", "crashed", "external"].includes(w.state);
          const canStop = supervisorUp && w.controllable && ["running", "starting", "restarting"].includes(w.state);
          const canRestart = supervisorUp && w.controllable && w.state !== "external" && w.state !== "unknown";
          return (
            <div key={w.name} className="px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="w-44">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-[#e8e8e4]">{w.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATE_STYLE[w.state]}`}>{w.state}</span>
                </div>
                <p className="text-[11px] text-[#73757c] mt-0.5">{DESCRIPTIONS[w.name]}</p>
              </div>
              <div className="flex-1 min-w-[220px] text-xs text-[#9a9ca3] tabular-nums space-y-0.5">
                {w.state === "external" ? (
                  <p>
                    Running outside the supervisor (pid {w.externalPid}). Stop that copy first to manage it here.
                  </p>
                ) : (
                  <p>
                    {w.pid ? `pid ${w.pid}` : "no process"}
                    {w.startedAt ? ` · up ${formatDuration(now - w.startedAt)}` : ""}
                    {w.restarts ? ` · ${w.restarts} restart${w.restarts === 1 ? "" : "s"}` : ""}
                    {w.lastExitCode != null ? ` · last exit ${w.lastExitCode}` : ""}
                  </p>
                )}
                {w.intervalSec != null && (
                  <p className={FRESH_STYLE[fresh]}>
                    {lastOkAgo ? `last good cycle ${lastOkAgo} ago` : "no successful cycle recorded yet"}
                    <span className="text-[#73757c]"> · every {w.intervalSec}s</span>
                  </p>
                )}
                {(w.lastError || w.heartbeat?.last_error) && (
                  <p className="text-[#e5787f]/90 truncate max-w-[560px]" title={w.lastError || w.heartbeat?.last_error || ""}>
                    {w.lastError || w.heartbeat?.last_error}
                  </p>
                )}
              </div>
              {w.controllable && (
                <div className="flex gap-2">
                  <button className={btn} disabled={!canStart || isBusy} onClick={() => onAction(w.name, "start")}>
                    <Play className="w-3.5 h-3.5" /> Start
                  </button>
                  <button className={btn} disabled={!canStop || isBusy} onClick={() => onAction(w.name, "stop")}>
                    <Square className="w-3.5 h-3.5" /> Stop
                  </button>
                  <button className={btn} disabled={!canRestart || isBusy} onClick={() => onAction(w.name, "restart")}>
                    <RotateCw className={`w-3.5 h-3.5 ${isBusy ? "animate-spin" : ""}`} /> Restart
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

```tsx
// src/components/control/LogsPanel.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Eraser, Pause, Play } from "lucide-react";
import { btn, card } from "./format";
import type { LogLine } from "./types";

const NAMES = ["web", "crawl", "backfill", "alerts", "jev"];

export function LogsPanel({ supervisorUp }: { supervisorUp: boolean }) {
  const [name, setName] = useState("crawl");
  const [lines, setLines] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines([]);
    setClearedAt(0);
  }, [name]);

  useEffect(() => {
    if (!supervisorUp || paused) return;
    let stop = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/control/logs/${name}?tail=200`, { cache: "no-store" });
        const d = await res.json();
        if (stop) return;
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
        setLines(d.lines || []);
        setError(null);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [name, paused, supervisorUp]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const download = async () => {
    const res = await fetch(`/api/control/logs/${name}?tail=500`, { cache: "no-store" });
    const d = await res.json();
    const text = (d.lines || []).map((l: LogLine) => `${new Date(l.t).toISOString()} [${l.stream}] ${l.text}`).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shown = lines.filter(l => l.t > clearedAt);
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="px-5 py-3 border-b border-white/[0.06] flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-[#e8e8e4] mr-2">Logs</h2>
        <div className="flex gap-1">
          {NAMES.map(n => (
            <button
              key={n}
              onClick={() => setName(n)}
              className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${n === name ? "bg-white/[0.10] text-[#e8e8e4]" : "text-[#9a9ca3] hover:bg-white/[0.05]"}`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto">
          <button className={btn} disabled={!supervisorUp} onClick={() => setPaused(p => !p)}>
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />} {paused ? "Resume" : "Pause"}
          </button>
          <button className={btn} disabled={!supervisorUp} onClick={() => setClearedAt(Date.now())}>
            <Eraser className="w-3.5 h-3.5" /> Clear view
          </button>
          <button className={btn} disabled={!supervisorUp} onClick={download}>
            <Download className="w-3.5 h-3.5" /> Download
          </button>
        </div>
      </div>
      <div ref={boxRef} className="h-80 overflow-auto px-5 py-3 font-mono text-[12px] leading-5 bg-black/20">
        {!supervisorUp ? (
          <p className="text-[#73757c]">Logs are available while the supervisor is running.</p>
        ) : error ? (
          <p className="text-[#e5787f]">{error}</p>
        ) : shown.length === 0 ? (
          <p className="text-[#73757c]">No output yet.</p>
        ) : (
          shown.map((l, i) => (
            <div
              key={`${l.t}-${i}`}
              className={`whitespace-pre-wrap break-all ${l.stream === "err" ? "text-[#e5787f]" : l.stream === "sys" ? "text-[#9fb4ee]" : "text-[#bdbdb8]"}`}
            >
              <span className="text-[#73757c]">{new Date(l.t).toLocaleTimeString()} </span>
              {l.text}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
```

```tsx
// src/components/control/HealthStrip.tsx
"use client";

import { useEffect, useState } from "react";
import { card, formatBytes } from "./format";

interface Health {
  dbBytes: number;
  walBytes: number;
  jevBytes: number;
  openrouter: { usage: number | null; limit: number | null; remaining: number | null } | null;
  openrouterError: string | null;
}

export function HealthStrip() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/control/health", { cache: "no-store" })
        .then(r => r.json())
        .then(d => !stop && setH(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const credit = h?.openrouter
    ? h.openrouter.remaining != null
      ? `$${h.openrouter.remaining.toFixed(2)} left`
      : h.openrouter.usage != null
      ? `$${h.openrouter.usage.toFixed(2)} used · no limit`
      : "key ok"
    : h?.openrouterError || "—";

  const items = [
    { label: "Database", value: h ? formatBytes(h.dbBytes) : "—" },
    { label: "WAL", value: h ? formatBytes(h.walBytes) : "—" },
    { label: "jev/ files", value: h ? formatBytes(h.jevBytes) : "—" },
    { label: "OpenRouter", value: credit },
  ];
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map(i => (
        <div key={i.label} className={`${card} px-4 py-3`}>
          <p className="text-[11px] uppercase tracking-wide text-[#73757c]">{i.label}</p>
          <p className="text-sm text-[#e8e8e4] tabular-nums mt-1 truncate" title={i.value}>
            {i.value}
          </p>
        </div>
      ))}
    </section>
  );
}
```

```tsx
// src/components/control/SettingsPanel.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Save } from "lucide-react";
import type { PublicSetting, SettingKey } from "@/lib/settings";
import { btn, card, input } from "./format";

type Kind = "secret" | "text" | "int" | "coins" | "flags";
interface Field {
  label: string;
  kind: Kind;
  hint?: string;
  flags?: Record<string, string>;
}

const FIELDS: Record<SettingKey, Field> = {
  "openrouter.apiKey": { label: "API key", kind: "secret" },
  "jev.telegramToken": { label: "Bot token", kind: "secret", hint: "Default target for Jev signal alerts" },
  "jev.telegramChat": { label: "Chat ID", kind: "text" },
  "llm.baseUrl": { label: "Base URL", kind: "text", hint: "OpenAI-compatible endpoint, e.g. https://…/v1" },
  "llm.apiKey": { label: "API key", kind: "secret" },
  "llm.model": { label: "Model", kind: "text" },
  "jev.coins": { label: "Coins", kind: "coins" },
  "jev.models": { label: "Models", kind: "flags", flags: { jev: "Jev", kev: "Kev-4b", span: "Span-01" }, hint: "Each enabled model is one paid OpenRouter call per coin per record" },
  "jev.recordIntervalSec": { label: "Record every (s)", kind: "int", hint: "60–3600" },
  "jev.snapshotIntervalSec": { label: "Snapshot refresh (s)", kind: "int", hint: "10–600" },
  "crawl.intervalSec": { label: "Crawl poll (s)", kind: "int", hint: "10–600" },
  "alerts.intervalSec": { label: "Alert evaluation (s)", kind: "int", hint: "30–3600" },
  "supervisor.autostart": { label: "Start with supervisor", kind: "flags", flags: { crawl: "crawl", backfill: "backfill", alerts: "alerts", jev: "jev" }, hint: "Applies next time the supervisor starts" },
};

const GROUPS: Array<{ title: string; keys: SettingKey[]; test?: "openrouter" | "telegram" | "llm" }> = [
  { title: "OpenRouter", keys: ["openrouter.apiKey"], test: "openrouter" },
  { title: "Jev Telegram", keys: ["jev.telegramToken", "jev.telegramChat"], test: "telegram" },
  { title: "Wallet-analysis LLM", keys: ["llm.baseUrl", "llm.apiKey", "llm.model"], test: "llm" },
  { title: "Jev collector", keys: ["jev.coins", "jev.models", "jev.recordIntervalSec", "jev.snapshotIntervalSec"] },
  { title: "Intervals", keys: ["crawl.intervalSec", "alerts.intervalSec"] },
  { title: "Supervisor", keys: ["supervisor.autostart"] },
];

export function SettingsPanel({ notify }: { notify: (ok: boolean, msg: string) => void }) {
  const [settings, setSettings] = useState<Record<SettingKey, PublicSetting> | null>(null);
  const [coins, setCoins] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<SettingKey, unknown>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/settings", { cache: "no-store" }).then(r => r.json());
    setSettings(d.settings);
    setCoins(d.coins);
  }, []);
  useEffect(() => {
    load().catch(() => notify(false, "Could not load settings"));
  }, [load, notify]);

  if (!settings) return <section className={`${card} p-5 text-sm text-[#73757c]`}>Loading settings…</section>;

  const current = (key: SettingKey): unknown => {
    if (key in drafts) return drafts[key];
    const s = settings[key];
    return s.secret ? "" : s.value;
  };
  const setDraft = (key: SettingKey, value: unknown) => setDrafts(d => ({ ...d, [key]: value }));

  const save = async (title: string, keys: SettingKey[]) => {
    const changes = Object.fromEntries(keys.filter(k => k in drafts).map(k => [k, drafts[k]]));
    if (!Object.keys(changes).length) return notify(true, "Nothing changed");
    setBusy(`save:${title}`);
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
      const d = await res.json();
      if (!res.ok) {
        setErrors(e => ({ ...e, ...d.errors }));
        return notify(false, "Not saved — fix the highlighted fields");
      }
      setErrors(e => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k as SettingKey))));
      setDrafts(dr => Object.fromEntries(Object.entries(dr).filter(([k]) => !keys.includes(k as SettingKey))));
      await load();
      const parts = ["Saved."];
      if (d.restarted.length) parts.push(`Restarted: ${d.restarted.join(", ")}.`);
      if (d.pending.length) parts.push(`Restart ${d.pending.join(", ")} to apply${d.supervisor ? "" : " (supervisor not running)"}.`);
      notify(true, parts.join(" "));
    } finally {
      setBusy(null);
    }
  };

  const test = async (target: string) => {
    setBusy(`test:${target}`);
    try {
      const d = await fetch("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) }).then(r => r.json());
      notify(!!d.ok, d.message);
    } finally {
      setBusy(null);
    }
  };

  const renderField = (key: SettingKey) => {
    const f = FIELDS[key];
    const s = settings[key];
    const value = current(key);
    const err = errors[key];
    let control: React.ReactNode;
    if (f.kind === "secret" && s.secret) {
      control = (
        <input
          type="password"
          autoComplete="off"
          className={input}
          value={String(value ?? "")}
          placeholder={s.set ? `set ${s.masked ?? ""} (${s.source}) — leave empty to keep` : "not set"}
          onChange={e => setDraft(key, e.target.value)}
        />
      );
    } else if (f.kind === "text") {
      control = <input className={input} value={String(value ?? "")} onChange={e => setDraft(key, e.target.value)} />;
    } else if (f.kind === "int") {
      control = <input className={`${input} w-32 tabular-nums`} inputMode="numeric" value={String(value ?? "")} onChange={e => setDraft(key, e.target.value)} />;
    } else if (f.kind === "coins") {
      const picked = new Set((value as string[]) ?? []);
      control = (
        <div className="flex flex-wrap gap-2">
          {coins.map(c => (
            <label key={c} className="flex items-center gap-1.5 text-xs text-[#bdbdb8] cursor-pointer uppercase">
              <input
                type="checkbox"
                className="accent-[#6aa9d8]"
                checked={picked.has(c)}
                onChange={e => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(c);
                  else next.delete(c);
                  setDraft(key, coins.filter(x => next.has(x)));
                }}
              />
              {c}
            </label>
          ))}
        </div>
      );
    } else {
      const flags = (value as Record<string, boolean>) ?? {};
      control = (
        <div className="flex flex-wrap gap-3">
          {Object.entries(f.flags ?? {}).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5 text-xs text-[#bdbdb8] cursor-pointer">
              <input type="checkbox" className="accent-[#6aa9d8]" checked={!!flags[k]} onChange={e => setDraft(key, { ...flags, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      );
    }
    return (
      <div key={key}>
        <label className="block text-[11px] font-medium text-[#9a9ca3] mb-1.5">
          {f.label}
          {!s.secret && s.source !== "db" && <span className="text-[#73757c] font-normal"> · {s.source === "env" ? "from .env.local" : "default"}</span>}
        </label>
        {control}
        {err ? <p className="text-[11px] text-[#e5787f] mt-1">{err}</p> : f.hint ? <p className="text-[11px] text-[#73757c] mt-1">{f.hint}</p> : null}
      </div>
    );
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-[#e8e8e4]">Settings</h2>
      <div className="grid md:grid-cols-2 gap-3">
        {GROUPS.map(g => (
          <div key={g.title} className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm text-[#e8e8e4]">{g.title}</h3>
              <div className="flex gap-2">
                {g.test && (
                  <button className={btn} disabled={busy === `test:${g.test}`} onClick={() => test(g.test!)} title="Uses the saved values">
                    <FlaskConical className="w-3.5 h-3.5" /> Test saved
                  </button>
                )}
                <button className={btn} disabled={busy === `save:${g.title}`} onClick={() => save(g.title, g.keys)}>
                  <Save className="w-3.5 h-3.5" /> Save
                </button>
              </div>
            </div>
            <div className="space-y-4">{g.keys.map(renderField)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

```tsx
// src/app/control/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { WorkersPanel } from "@/components/control/WorkersPanel";
import { LogsPanel } from "@/components/control/LogsPanel";
import { HealthStrip } from "@/components/control/HealthStrip";
import { SettingsPanel } from "@/components/control/SettingsPanel";
import type { StatusPayload } from "@/components/control/types";

export default function ControlPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const notify = useCallback((ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(t => (t?.msg === msg ? null : t)), 6000);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const d = await fetch("/api/control/status", { cache: "no-store" }).then(r => r.json());
      setStatus(d);
    } catch {
      // keep last status; the next poll retries
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadStatus();
    }, 3000);
    return () => clearInterval(id);
  }, [loadStatus]);

  const onAction = async (name: string, action: "start" | "stop" | "restart") => {
    setBusy(`${name}:${action}`);
    try {
      const res = await fetch(`/api/control/workers/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json();
      if (!res.ok) notify(false, d.error || `${action} failed`);
      else notify(true, `${name}: ${d.state}`);
      await loadStatus();
    } finally {
      setBusy(null);
    }
  };

  const supervisorUp = !!status?.supervisor;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#e8e8e4]">Control</h1>
        <p className="text-sm text-[#9a9ca3] mt-1">Workers, logs and settings. This page is only reachable from this Mac.</p>
      </div>

      {status && !supervisorUp && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#d4b063]/30 bg-[#d4b063]/10 px-5 py-3 text-sm text-[#e8d9ae]">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            Supervisor not running — start it with <code className="font-mono">npm run supervisor</code> to control workers and see logs.
            Settings can still be saved; restart workers manually to apply them.
          </div>
        </div>
      )}

      <HealthStrip />
      <WorkersPanel status={status} busy={busy} onAction={onAction} />
      <LogsPanel supervisorUp={supervisorUp} />
      <SettingsPanel notify={notify} />

      {toast && (
        <div
          className={`fixed bottom-5 right-5 max-w-md rounded-xl border px-4 py-3 text-sm shadow-lg ${toast.ok ? "border-[#5fbf9a]/30 bg-[#16241f] text-[#b9e5d3]" : "border-[#e5787f]/30 bg-[#2a1719] text-[#f1b9be]"}`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Navigation link (dirty file — stage only our hunk)**

In the working tree, in `src/components/Navigation.tsx` add after `{ href: "/flow", label: "Money Flow" },`:

```ts
    { href: "/control", label: "Control" },
```

Stage the same one-line addition against `HEAD` without the owner's changes:

```bash
git show HEAD:src/components/Navigation.tsx \
  | python3 -c 'import sys; s=sys.stdin.read(); a="    { href: \"/flow\", label: \"Money Flow\" },\n"; assert a in s; sys.stdout.write(s.replace(a, a+"    { href: \"/control\", label: \"Control\" },\n"))' \
  > "$TMPDIR/Navigation.head.tsx"
blob=$(git hash-object -w "$TMPDIR/Navigation.head.tsx")
git update-index --cacheinfo 100644,"$blob",src/components/Navigation.tsx
git diff --cached src/components/Navigation.tsx   # expect exactly one added line
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: no type errors; all tests pass; build succeeds and lists `/control` and the new API routes.

Then with the existing server on port 8000 (or `npm run dev`), open `http://127.0.0.1:8000/control` in the browser (Playwright) and check: banner shown when supervisor is down, health strip values, worker rows, settings groups render with masked secrets, no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/control src/app/control
git commit -m "feat(control): add /control page for workers, logs, health and settings"
```

(`Navigation.tsx` is already staged with only our line.)

---

### Task 11: End-to-end verification and README

**Files:**
- Modify: `README.md` (Running section)

- [ ] **Step 1: Supervisor run next to the owner's existing processes**

The owner's `alerts` (launchd), `jev` and web server (Antigravity IDE) keep running. Start a second supervisor on spare ports with only harmless workers:

```bash
PMP_PORT=8100 SUPERVISOR_PORT=8101 SUPERVISOR_AUTOSTART=web,backfill,alerts,jev npx tsx scripts/supervisor.ts > "$TMPDIR/sup.log" 2>&1 &
sleep 15; cat "$TMPDIR/sup.log"
```

Expected: `web: running` (port 8100 free), `backfill: running`, `alerts: external (… pid …)`, `jev: external (… pid …)`. No duplicate alerts/jev process in `ps`.

Note: this second supervisor overwrites `.supervisor-token` and runs a second `next dev` in the same directory. If Next refuses a second dev server in one directory, drop `web` from `SUPERVISOR_AUTOSTART` and use the owner's server on 8000 for the page (it then talks to the supervisor on 8101 only if started with `SUPERVISOR_PORT=8101`; in that case verify the control API with `curl` + token instead).

- [ ] **Step 2: Crash recovery**

```bash
TOKEN=$(cat .supervisor-token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8101/status | python3 -m json.tool | head -40
PID=$(curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8101/status | python3 -c 'import sys,json; print([w for w in json.load(sys.stdin)["workers"] if w["name"]=="backfill"][0]["pid"])')
kill -9 -$PID; sleep 4
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8101/status | python3 -c 'import sys,json; w=[w for w in json.load(sys.stdin)["workers"] if w["name"]=="backfill"][0]; print(w["state"], w["restarts"], w["pid"])'
```

Expected: `running 1 <new pid>`.

- [ ] **Step 3: Security checks**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -m 5 http://192.168.1.141:8100/api/alerts   # expect 000 (connection refused)
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}' http://127.0.0.1:8100/api/settings   # expect 403
curl -s http://127.0.0.1:8100/api/alerts | grep -c telegram_token\" || true   # expect 0
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer wrong" http://127.0.0.1:8101/status   # expect 401
```

- [ ] **Step 4: Dashboard walkthrough (Playwright)**

Open `http://127.0.0.1:8100/control`: workers panel shows states (backfill running, alerts/jev external), logs panel shows backfill output, Stop/Start on backfill works, settings save of `crawl.intervalSec` shows "Saved. Restart crawl to apply." Take a screenshot for the report.

- [ ] **Step 5: Stop the test supervisor and confirm no orphans**

```bash
kill -INT %1 2>/dev/null || pkill -INT -f "scripts/supervisor.ts"; sleep 12
ps -axo pid,command | grep -E "polymarket-pulse.*(backfill|supervisor)|next dev -H 127.0.0.1 -p 8100" | grep -v grep   # expect nothing
ls .supervisor-token 2>/dev/null   # expect nothing
```

- [ ] **Step 6: README**

Replace the `## Running / اجرا` section body with:

````markdown
```bash
npm install
npm run supervisor   # web app on http://127.0.0.1:8000 + crawl, backfill, alerts, jev workers
```

Open **http://127.0.0.1:8000/control** to start/stop/restart workers, read their logs, see heartbeats and edit settings
(OpenRouter key, Jev Telegram target, coins, models, intervals). Saving a setting restarts only the workers that use it.

- The app listens on `127.0.0.1` only and rejects cross-site API writes — it is meant to be used from this Mac.
- A worker already running elsewhere (another terminal, launchd, the IDE) is shown as **external** and is not started twice.
  To hand the launchd alerts worker to the supervisor: `launchctl unload ~/Library/LaunchAgents/com.polymarket-pulse.alerts.plist`.
- Logs: `logs/<worker>.log` (rotated at 5 MB). Ports: `PMP_PORT` (default 8000), `SUPERVISOR_PORT` (default 8001).

Running workers by hand still works: `npm run dev`, `npm run crawl`, `npm run backfill`, `npm run alerts`, `npm run jev`.

Create alert rules at `/alerts` → fill Telegram bot token + chat ID → **Test**.
````

- [ ] **Step 7: Final checks and commit**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green.

```bash
git add README.md
git commit -m "docs: document supervisor and /control dashboard"
```

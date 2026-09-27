import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as dbModule from '../src/lib/db';
import { applySettingChanges } from '../src/lib/settings';
import { getLlmHealth } from '../src/lib/llmHealth';

describe('getLlmHealth', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    dbModule.initializeDb(db);
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db);
    global.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('reports not configured without making a network call', async () => {
    const h = await getLlmHealth({ fresh: true });
    expect(h).toEqual({ ok: false, message: 'not configured' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('pings the configured endpoint and reports ok', async () => {
    applySettingChanges({ 'llm.baseUrl': 'http://178.104.62.47:20128/v1', 'llm.apiKey': 'sk-llm-0123456789', 'llm.model': 'm' }, db);
    (global.fetch as any).mockResolvedValue(new Response('{}', { status: 200 }));
    const h = await getLlmHealth({ fresh: true });
    expect(h.ok).toBe(true);
  });

  it('reports the failure reason when the endpoint rejects the ping', async () => {
    applySettingChanges({ 'llm.baseUrl': 'http://178.104.62.47:20128/v1', 'llm.apiKey': 'sk-llm-0123456789', 'llm.model': 'm' }, db);
    (global.fetch as any).mockResolvedValue(new Response('bad key', { status: 401 }));
    const h = await getLlmHealth({ fresh: true });
    expect(h.ok).toBe(false);
    expect(h.message).toMatch(/401/);
  });

  it('caches a successful result and does not re-ping within the TTL', async () => {
    applySettingChanges({ 'llm.baseUrl': 'http://178.104.62.47:20128/v1', 'llm.apiKey': 'sk-llm-0123456789', 'llm.model': 'm' }, db);
    (global.fetch as any).mockResolvedValue(new Response('{}', { status: 200 }));
    await getLlmHealth({ fresh: true });
    await getLlmHealth();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

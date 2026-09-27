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
        ? {
            ok: true,
            status: 200,
            body: { supervisor: { pid: 1, startedAt: 1 }, workers: [{ name: 'jev', state: 'running' }, { name: 'crawl', state: 'external' }] },
          }
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
    expect(body.workers.map((w: any) => w.name)).toEqual(['web', 'crawl', 'backfill', 'alerts', 'jev', 'bot']);
    expect(body.workers[1]).toMatchObject({ state: 'unknown', intervalSec: 30, controllable: true });
  });

  it('worker actions validate input and report a missing supervisor', async () => {
    const call = (name: string, action: string) =>
      postWorker(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ action }) }), {
        params: Promise.resolve({ name }),
      });
    expect((await call('crawl', 'explode')).status).toBe(400);
    expect((await call('nope', 'stop')).status).toBe(400);
    sup.mockResolvedValue(null);
    expect((await call('crawl', 'stop')).status).toBe(503);
  });
});

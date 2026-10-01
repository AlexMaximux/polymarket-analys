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
  afterEach(() => {
    process.env = { ...envBackup };
  });

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
    getSetting('crawl.intervalSec', db); // creates the table
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
    expect(applySettingChanges({ 'jev.models': { jev: false, kev: false, span: false, solar: false, tev: false, mercury: false } }, db).ok).toBe(false);
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
    const r = applySettingChanges(
      { 'crawl.intervalSec': 20, 'jev.coins': ['btc'], 'supervisor.autostart': { crawl: true, backfill: false, alerts: true, jev: true, bot: false } },
      db
    );
    expect(r).toEqual({ ok: true, restarts: ['crawl', 'jev'] });
  });

  it('stores wallet-analysis LLM fields in llm_settings and needs all three the first time', () => {
    expect(applySettingChanges({ 'llm.model': 'm' }, db).ok).toBe(false);
    expect(
      applySettingChanges({ 'llm.baseUrl': 'http://178.104.62.47:20128/v1/', 'llm.apiKey': 'sk-llm-0123456789', 'llm.model': 'm' }, db).ok
    ).toBe(true);
    const row = db.prepare(`SELECT base_url, model FROM llm_settings WHERE id = 1`).get() as any;
    expect(row).toEqual({ base_url: 'http://178.104.62.47:20128/v1', model: 'm' });
    expect(applySettingChanges({ 'llm.model': 'm2' }, db).ok).toBe(true);
    expect(getSetting('llm.model', db)).toBe('m2');
    expect(applySettingChanges({ 'llm.baseUrl': 'ftp://x' }, db).ok).toBe(false);
  });
});

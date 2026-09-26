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

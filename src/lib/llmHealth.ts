import { getSetting } from './settings';
import { pingLlm } from './llmPing';

export interface LlmHealth {
  ok: boolean;
  message: string;
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; key: string; value: LlmHealth } | null = null;

/** Automatic (not click-triggered) health check for the wallet-analysis LLM, cached 5 minutes. */
export async function getLlmHealth(opts: { fresh?: boolean } = {}): Promise<LlmHealth> {
  const baseUrl = getSetting('llm.baseUrl');
  const apiKey = getSetting('llm.apiKey');
  const model = getSetting('llm.model');
  if (!baseUrl || !apiKey || !model) return { ok: false, message: 'not configured' };

  const key = `${baseUrl}|${model}`;
  if (!opts.fresh && cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;

  const r = await pingLlm(baseUrl, apiKey, model);
  const value: LlmHealth = r.ok ? { ok: true, message: 'ok' } : { ok: false, message: r.error || 'failed' };
  cache = { at: Date.now(), key, value };
  return value;
}

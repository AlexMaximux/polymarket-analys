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

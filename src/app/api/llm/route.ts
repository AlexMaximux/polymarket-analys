import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isHttpUrl } from '@/lib/validate';
import { pingLlm } from '@/lib/llmPing';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/llm — current settings (api_key masked)
 * PUT  /api/llm { baseUrl, apiKey, model } — save + test connection
 */
export async function GET() {
  const db = getDb();
  const row = db.prepare(`SELECT base_url, api_key, model FROM llm_settings WHERE id = 1`).get() as any;
  if (!row) return NextResponse.json({ configured: false });
  return NextResponse.json({
    configured: true,
    baseUrl: row.base_url,
    model: row.model,
    apiKeyMasked: row.api_key.slice(0, 8) + '…' + row.api_key.slice(-4),
  });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const baseUrl = String(body?.baseUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(body?.apiKey || '').trim();
  const model = String(body?.model || '').trim();
  if (!baseUrl || !apiKey || !model) {
    return NextResponse.json({ error: 'baseUrl, apiKey and model are required' }, { status: 400 });
  }

  if (!isHttpUrl(baseUrl)) {
    return NextResponse.json({ error: 'baseUrl must be an http:// or https:// URL' }, { status: 400 });
  }
  // test the connection before saving
  const test = await pingLlm(baseUrl, apiKey, model);
  if (!test.ok) {
    return NextResponse.json({ ok: false, testError: test.error }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO llm_settings (id, base_url, api_key, model, updated_at) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET base_url = ?, api_key = ?, model = ?, updated_at = ?`
  ).run(baseUrl, apiKey, model, Math.floor(Date.now() / 1000),
        baseUrl, apiKey, model, Math.floor(Date.now() / 1000));
  return NextResponse.json({ ok: true });
}

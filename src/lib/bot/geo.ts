export interface PolymarketGeoStatus {
  checked: boolean;
  blocked: boolean;
  country: string | null;
  region: string | null;
}

const CACHE_MS = 60_000;
let cached: { at: number; value: PolymarketGeoStatus } | null = null;

/** Check Polymarket's own location decision without retaining or exposing the server IP. */
export async function getPolymarketGeoStatus(fresh = false): Promise<PolymarketGeoStatus> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  try {
    const response = await fetch('https://polymarket.com/api/geoblock', {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'PolymarketPulseBot/1.0' },
    });
    if (!response.ok) throw new Error('Geoblock endpoint failed');
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.blocked !== 'boolean') throw new Error('Invalid geoblock response');
    const value: PolymarketGeoStatus = {
      checked: true,
      blocked: body.blocked,
      country: typeof body.country === 'string' ? body.country : null,
      region: typeof body.region === 'string' ? body.region : null,
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return { checked: false, blocked: false, country: null, region: null };
  }
}

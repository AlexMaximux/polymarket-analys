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

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

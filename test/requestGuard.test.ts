import { describe, it, expect } from 'vitest';
import { checkLocalRequest } from '../src/lib/requestGuard';

describe('checkLocalRequest', () => {
  it('allows same-origin writes from localhost and 127.0.0.1 on any port', () => {
    expect(checkLocalRequest('POST', 'localhost:8000', 'http://localhost:8000')).toBeNull();
    expect(checkLocalRequest('DELETE', '127.0.0.1:3001', 'http://127.0.0.1:3001')).toBeNull();
  });
  it('allows writes without an Origin header (curl, server-to-server)', () => {
    expect(checkLocalRequest('POST', '127.0.0.1:8000', null)).toBeNull();
  });
  it('allows cross-origin reads', () => {
    expect(checkLocalRequest('GET', 'localhost:8000', 'https://evil.example')).toBeNull();
  });
  it('blocks cross-origin writes', () => {
    expect(checkLocalRequest('POST', 'localhost:8000', 'https://evil.example')).not.toBeNull();
    expect(checkLocalRequest('POST', 'localhost:8000', 'http://localhost:9999')).not.toBeNull();
  });
  it('blocks Origin: null (sandboxed iframe, file://)', () => {
    expect(checkLocalRequest('POST', 'localhost:8000', 'null')).not.toBeNull();
  });
  it('blocks foreign Host headers (DNS rebinding, LAN access) for every method', () => {
    expect(checkLocalRequest('GET', 'evil.example:8000', null)).not.toBeNull();
    expect(checkLocalRequest('GET', '192.168.1.141:8000', null)).not.toBeNull();
    expect(checkLocalRequest('GET', null, null)).not.toBeNull();
  });
  it('accepts IPv6 loopback', () => {
    expect(checkLocalRequest('POST', '[::1]:8000', 'http://[::1]:8000')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { buildPendingKey, buildRateLimitKey, parsePendingKey } from '../_lib/kv-keys.js';

describe('kv-keys', () => {
  it('buildPendingKey monta pending:<slug>:<id>', () => {
    expect(buildPendingKey('cachoeiras-urubici', 'abc123')).toBe('pending:cachoeiras-urubici:abc123');
  });

  it('parsePendingKey é o inverso de buildPendingKey', () => {
    const key = buildPendingKey('cachoeiras-urubici', 'abc123');
    expect(parsePendingKey(key)).toEqual({ slug: 'cachoeiras-urubici', id: 'abc123' });
  });

  it('parsePendingKey rejeita chave sem o prefixo pending:', () => {
    expect(parsePendingKey('ratelimit:abc123')).toBeNull();
  });

  it('parsePendingKey rejeita chave sem id (sem segundo ":")', () => {
    expect(parsePendingKey('pending:so-slug')).toBeNull();
  });

  it('parsePendingKey lida com id contendo ":"', () => {
    expect(parsePendingKey('pending:meu-slug:parte1:parte2')).toEqual({ slug: 'meu-slug', id: 'parte1:parte2' });
  });

  it('buildRateLimitKey monta ratelimit:<hash>', () => {
    expect(buildRateLimitKey('deadbeef')).toBe('ratelimit:deadbeef');
  });
});

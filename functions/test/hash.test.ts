import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../_lib/hash.js';

describe('sha256Hex', () => {
  it('produz o digest SHA-256 esperado (vetor conhecido)', async () => {
    // sha256("") -- vetor de teste padrão, qualquer implementação correta bate com isso.
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('é determinístico -- mesmo input, mesmo hash', async () => {
    const a = await sha256Hex('203.0.113.42');
    const b = await sha256Hex('203.0.113.42');
    expect(a).toBe(b);
  });

  it('IPs diferentes geram hashes diferentes', async () => {
    const a = await sha256Hex('203.0.113.42');
    const b = await sha256Hex('203.0.113.43');
    expect(a).not.toBe(b);
  });

  it('nunca devolve o input original (não é passthrough)', async () => {
    const hash = await sha256Hex('203.0.113.42');
    expect(hash).not.toContain('203.0.113.42');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractBearerToken, verifyAdminToken } from '../_lib/auth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('extractBearerToken', () => {
  it('extrai o token de "Bearer <token>"', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('é case-insensitive no "Bearer"', () => {
    expect(extractBearerToken('bearer abc123')).toBe('abc123');
  });

  it('devolve null sem header', () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it('devolve null em formato errado (sem "Bearer")', () => {
    expect(extractBearerToken('Token abc123')).toBeNull();
  });

  it('devolve null com token vazio', () => {
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});

describe('verifyAdminToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('token ausente -> 401, sem nem chamar o GitHub', async () => {
    const result = await verifyAdminToken('', 'urubiciguia-max', 'novo-guia-urubici');
    expect(result).toEqual({ ok: false, status: 401, reason: 'Token de autorização ausente.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GitHub responde 401 -> token inválido/expirado', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, 401));
    const result = await verifyAdminToken('token-ruim', 'urubiciguia-max', 'novo-guia-urubici');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 401 });
  });

  it('GitHub responde 404 -> sem acesso ao repo (403, não 401)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404));
    const result = await verifyAdminToken('token-sem-acesso', 'urubiciguia-max', 'novo-guia-urubici');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 403 });
  });

  it('GitHub responde 200 mas permissions.push=false -> 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: false, admin: false } }, 200));
    const result = await verifyAdminToken('token-so-leitura', 'urubiciguia-max', 'novo-guia-urubici');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 403 });
  });

  it('GitHub responde 200 com permissions.push=true -> ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true, admin: true } }, 200));
    const result = await verifyAdminToken('token-do-moises', 'urubiciguia-max', 'novo-guia-urubici');
    expect(result).toEqual({ ok: true });
  });

  it('chama a URL e headers certos', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }, 200));
    await verifyAdminToken('token-do-moises', 'urubiciguia-max', 'novo-guia-urubici');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/urubiciguia-max/novo-guia-urubici');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-do-moises');
  });

  it('erro de rede -> 401 (não lança)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const result = await verifyAdminToken('token-qualquer', 'urubiciguia-max', 'novo-guia-urubici');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 401 });
  });
});

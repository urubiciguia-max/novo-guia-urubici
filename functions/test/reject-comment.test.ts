import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRejectComment } from '../_lib/handlers/reject-comment.js';
import { FakeKv } from './helpers/fakeKv.js';
import type { Env } from '../_lib/env.js';
import { buildPendingKey } from '../_lib/kv-keys.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new Request('https://guiadeurubici.com.br/api/admin/comments/x/reject', { method: 'POST', headers });
}

describe('handleRejectComment', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeEnv(): { env: Env; kv: FakeKv } {
    const kv = new FakeKv();
    return { env: { COMMENTS_KV: kv as unknown as KVNamespace }, kv };
  }

  it('401 sem Authorization', async () => {
    const { env } = makeEnv();
    const res = await handleRejectComment(makeRequest(), env, buildPendingKey('slug', 'id1'));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403 quando o token não tem permissão de escrita', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: false } }));
    const { env } = makeEnv();
    const res = await handleRejectComment(makeRequest('Bearer token-leitura'), env, buildPendingKey('slug', 'id1'));
    expect(res.status).toBe(403);
  });

  it('400 pra id que não é uma chave pending: válida', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }));
    const { env } = makeEnv();
    const res = await handleRejectComment(makeRequest('Bearer token-ok'), env, 'nao-eh-key-pending');
    expect(res.status).toBe(400);
  });

  it('204 e remove a chave do KV quando ela existe', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }));
    const { env, kv } = makeEnv();
    const key = buildPendingKey('cachoeiras-urubici', 'id1');
    await kv.put(key, JSON.stringify({ id: 'id1' }));

    const res = await handleRejectComment(makeRequest('Bearer token-ok'), env, key);

    expect(res.status).toBe(204);
    expect(await kv.get(key)).toBeNull();
  });

  it('204 mesmo quando a chave já não existe (idempotente)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }));
    const { env } = makeEnv();
    const key = buildPendingKey('cachoeiras-urubici', 'id-ja-sumiu');

    const res = await handleRejectComment(makeRequest('Bearer token-ok'), env, key);

    expect(res.status).toBe(204);
  });

  it('não faz nenhuma chamada ao GitHub Contents API -- só apaga do KV', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }));
    const { env, kv } = makeEnv();
    const key = buildPendingKey('cachoeiras-urubici', 'id1');
    await kv.put(key, JSON.stringify({ id: 'id1' }));

    await handleRejectComment(makeRequest('Bearer token-ok'), env, key);

    // A ÚNICA chamada de rede é a verificação de auth -- nenhuma ao Contents API.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

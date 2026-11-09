import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApproveComment } from '../_lib/handlers/approve-comment.js';
import { FakeKv } from './helpers/fakeKv.js';
import type { Env } from '../_lib/env.js';
import { buildPendingKey } from '../_lib/kv-keys.js';
import type { PendingComment } from '../_lib/types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new Request('https://guiadeurubici.com.br/api/admin/comments/x/approve', { method: 'POST', headers });
}

const PENDING: PendingComment = {
  id: 'id1',
  slug: 'cachoeiras-urubici',
  name: 'Maria',
  text: 'Comentário pendente de teste, bem legal.',
  createdAt: '2026-11-09T12:00:00.000Z',
  ip: 'hash-fake',
};

describe('handleApproveComment', () => {
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
    const res = await handleApproveComment(makeRequest(), env, buildPendingKey(PENDING.slug, PENDING.id));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403 quando o token não tem permissão de escrita', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: false } }));
    const { env } = makeEnv();
    const res = await handleApproveComment(makeRequest('Bearer token-leitura'), env, buildPendingKey(PENDING.slug, PENDING.id));
    expect(res.status).toBe(403);
  });

  it('400 pra um id que não é uma chave pending: válida', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }));
    const { env } = makeEnv();
    const res = await handleApproveComment(makeRequest('Bearer token-ok'), env, 'nao-eh-uma-key-pending');
    expect(res.status).toBe(400);
  });

  it('404 quando o comentário pendente não existe mais no KV', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }));
    const { env } = makeEnv();
    const res = await handleApproveComment(makeRequest('Bearer token-ok'), env, buildPendingKey(PENDING.slug, 'id-inexistente'));
    expect(res.status).toBe(404);
  });

  it('fluxo feliz: cria src/content/comments/<slug>.json e remove do KV', async () => {
    const { env, kv } = makeEnv();
    const key = buildPendingKey(PENDING.slug, PENDING.id);
    await kv.put(key, JSON.stringify(PENDING));

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ permissions: { push: true } })) // verifyAdminToken
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404)) // GET contents (arquivo não existe ainda)
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: 'commit-sha-ok' } })); // PUT contents

    const res = await handleApproveComment(makeRequest('Bearer token-do-moises'), env, key);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; commitSha: string };
    expect(body).toEqual({ ok: true, slug: PENDING.slug, commitSha: 'commit-sha-ok' });
    expect(await kv.get(key)).toBeNull(); // removido do KV só depois do commit

    const putCall = fetchMock.mock.calls[2];
    const putUrl = putCall[0] as string;
    expect(putUrl).toContain(`src/content/comments/${PENDING.slug}.json`);
    const putBody = JSON.parse((putCall[1] as RequestInit).body as string);
    const written = JSON.parse(Buffer.from(putBody.content, 'base64').toString('utf8'));
    expect(written).toEqual([{ name: PENDING.name, text: PENDING.text, date: PENDING.createdAt }]);
  });

  it('se o GitHub falhar, mantém o comentário pendente no KV (não perde a submissão)', async () => {
    const { env, kv } = makeEnv();
    const key = buildPendingKey(PENDING.slug, PENDING.id);
    await kv.put(key, JSON.stringify(PENDING));

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: 'Internal Server Error' }, 500));

    const res = await handleApproveComment(makeRequest('Bearer token-do-moises'), env, key);

    expect(res.status).toBe(500);
    expect(await kv.get(key)).not.toBeNull(); // continua pendente
  });

  it('409 (conflito duplo) é repassado como 409, comentário continua pendente', async () => {
    const { env, kv } = makeEnv();
    const key = buildPendingKey(PENDING.slug, PENDING.id);
    await kv.put(key, JSON.stringify(PENDING));

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404)) // GET tentativa 1
      .mockResolvedValueOnce(jsonResponse({ message: 'Conflict' }, 409)) // PUT tentativa 1
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404)) // GET tentativa 2
      .mockResolvedValueOnce(jsonResponse({ message: 'Conflict' }, 409)); // PUT tentativa 2

    const res = await handleApproveComment(makeRequest('Bearer token-do-moises'), env, key);

    expect(res.status).toBe(409);
    expect(await kv.get(key)).not.toBeNull();
  });
});

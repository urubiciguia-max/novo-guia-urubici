import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleListPendingComments } from '../_lib/handlers/list-pending.js';
import { FakeKv } from './helpers/fakeKv.js';
import type { Env } from '../_lib/env.js';
import { buildPendingKey } from '../_lib/kv-keys.js';
import type { PendingComment } from '../_lib/types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeRequest(authHeader?: string, query = '?status=pending'): Request {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new Request(`https://guiadeurubici.com.br/api/admin/comments${query}`, { headers });
}

async function seedPending(kv: FakeKv, overrides: Partial<PendingComment> = {}): Promise<PendingComment> {
  const pending: PendingComment = {
    id: 'id1',
    slug: 'cachoeiras-urubici',
    name: 'Maria',
    text: 'Comentário pendente de teste.',
    createdAt: '2026-11-09T12:00:00.000Z',
    ip: 'hash-fake',
    ...overrides,
  };
  await kv.put(buildPendingKey(pending.slug, pending.id), JSON.stringify(pending));
  return pending;
}

describe('handleListPendingComments', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('401 sem header Authorization', async () => {
    const kv = new FakeKv();
    const res = await handleListPendingComments(makeRequest(), { COMMENTS_KV: kv as unknown as KVNamespace } as Env);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403 quando o token não tem permissão de escrita', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: false } }));
    const kv = new FakeKv();
    const res = await handleListPendingComments(makeRequest('Bearer token-leitura'), {
      COMMENTS_KV: kv as unknown as KVNamespace,
    } as Env);
    expect(res.status).toBe(403);
  });

  it('400 pra status diferente de "pending"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }));
    const kv = new FakeKv();
    const res = await handleListPendingComments(makeRequest('Bearer token-ok', '?status=approved'), {
      COMMENTS_KV: kv as unknown as KVNamespace,
    } as Env);
    expect(res.status).toBe(400);
  });

  it('lista os pendentes, sem o campo "ip", ordenados do mais recente pro mais antigo', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }));
    const kv = new FakeKv();
    await seedPending(kv, { id: 'id-antigo', createdAt: '2026-11-01T00:00:00.000Z', name: 'João' });
    await seedPending(kv, { id: 'id-novo', createdAt: '2026-11-09T00:00:00.000Z', name: 'Maria' });

    const res = await handleListPendingComments(makeRequest('Bearer token-ok'), {
      COMMENTS_KV: kv as unknown as KVNamespace,
    } as Env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { comments: Array<{ name: string; ip?: string }> };
    expect(body.comments).toHaveLength(2);
    expect(body.comments[0].name).toBe('Maria'); // mais recente primeiro
    expect(body.comments[1].name).toBe('João');
    expect(body.comments[0].ip).toBeUndefined(); // nunca expõe o hash do IP na listagem
  });

  it('pula entradas corrompidas no KV sem derrubar a listagem inteira', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ permissions: { push: true } }));
    const kv = new FakeKv();
    await seedPending(kv, { id: 'ok' });
    await kv.put(buildPendingKey('outro-slug', 'corrompido'), 'isto não é JSON válido {{{');

    const res = await handleListPendingComments(makeRequest('Bearer token-ok'), {
      COMMENTS_KV: kv as unknown as KVNamespace,
    } as Env);
    const body = (await res.json()) as { comments: unknown[] };
    expect(body.comments).toHaveLength(1);
  });
});

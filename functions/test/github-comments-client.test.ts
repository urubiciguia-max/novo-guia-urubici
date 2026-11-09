import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiError, GitHubCommentsClient, ShaConflictError } from '../_lib/github-comments-client.js';

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('GitHubCommentsClient.appendComment', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeClient() {
    return new GitHubCommentsClient({
      token: 'fake-token',
      owner: 'urubiciguia-max',
      repo: 'novo-guia-urubici',
      branch: 'main',
    });
  }

  it('cria o arquivo (sem sha) quando ele ainda não existe (404 no GET)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, { status: 404 })) // GET
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: 'commit-sha-1' } })); // PUT

    const result = await makeClient().appendComment('cachoeiras-urubici', {
      name: 'Maria',
      text: 'Muito bom!',
      date: '2026-11-09T12:00:00.000Z',
    });

    expect(result).toEqual({ commitSha: 'commit-sha-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [, putInit] = fetchMock.mock.calls[1];
    const putBody = JSON.parse(putInit.body as string);
    expect(putBody.sha).toBeUndefined();
    const written = JSON.parse(Buffer.from(putBody.content, 'base64').toString('utf8'));
    expect(written).toEqual([{ name: 'Maria', text: 'Muito bom!', date: '2026-11-09T12:00:00.000Z' }]);
  });

  it('anexa (com sha) quando o arquivo já existe com comentários', async () => {
    const existing = [{ name: 'João', text: 'Comentário antigo', date: '2026-11-01T00:00:00.000Z' }];
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ content: utf8ToBase64(JSON.stringify(existing)), sha: 'sha-atual', encoding: 'base64' })
      )
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: 'commit-sha-2' } }));

    const result = await makeClient().appendComment('cachoeiras-urubici', {
      name: 'Maria',
      text: 'Comentário novo',
      date: '2026-11-09T12:00:00.000Z',
    });

    expect(result).toEqual({ commitSha: 'commit-sha-2' });
    const [, putInit] = fetchMock.mock.calls[1];
    const putBody = JSON.parse(putInit.body as string);
    expect(putBody.sha).toBe('sha-atual');
    const written = JSON.parse(Buffer.from(putBody.content, 'base64').toString('utf8'));
    expect(written).toEqual([...existing, { name: 'Maria', text: 'Comentário novo', date: '2026-11-09T12:00:00.000Z' }]);
  });

  it('tenta de novo UMA vez em caso de 409, e na segunda tentativa funciona', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, { status: 404 })) // GET (tentativa 1)
      .mockResolvedValueOnce(jsonResponse({ message: 'Conflict' }, { status: 409 })) // PUT (tentativa 1) -- conflito
      .mockResolvedValueOnce(
        jsonResponse({ content: utf8ToBase64(JSON.stringify([])), sha: 'sha-apos-conflito', encoding: 'base64' })
      ) // GET (tentativa 2)
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: 'commit-sha-3' } })); // PUT (tentativa 2) -- ok

    const result = await makeClient().appendComment('cachoeiras-urubici', {
      name: 'Maria',
      text: 'Depois do conflito',
      date: '2026-11-09T12:00:00.000Z',
    });

    expect(result).toEqual({ commitSha: 'commit-sha-3' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('lança ShaConflictError se colidir DUAS vezes seguidas', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Conflict' }, { status: 409 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Conflict' }, { status: 409 }));

    await expect(
      makeClient().appendComment('cachoeiras-urubici', { name: 'Maria', text: 'x', date: '2026-11-09T12:00:00.000Z' })
    ).rejects.toThrow(ShaConflictError);
  });

  it('lança GitHubApiError se o arquivo existente não for um array JSON válido', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: utf8ToBase64('{"isto": "nao e array"}'), sha: 'sha-1', encoding: 'base64' })
    );

    await expect(
      makeClient().appendComment('cachoeiras-urubici', { name: 'Maria', text: 'x', date: '2026-11-09T12:00:00.000Z' })
    ).rejects.toThrow(GitHubApiError);
  });

  it('rejeita slug inválido (path traversal) antes de qualquer requisição', async () => {
    await expect(
      makeClient().appendComment('../../etc/passwd', { name: 'Maria', text: 'x', date: '2026-11-09T12:00:00.000Z' })
    ).rejects.toThrow(GitHubApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

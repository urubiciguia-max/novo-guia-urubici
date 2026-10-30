import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubPostsClient } from '../src/github-client.js';
import {
  GitHubApiError,
  PostAlreadyExistsError,
  PostNotFoundError,
  RateLimitError,
  ShaConflictError,
  ValidationError,
} from '../src/errors.js';
import type { PostFrontmatter } from '../src/types.js';

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

const VALID_FRONTMATTER: PostFrontmatter = {
  title: 'Cachoeiras secretas de Urubici',
  description: 'Descrição válida',
  pubDate: '2026-01-15',
  tags: ['cachoeiras'],
  draft: false,
  author: 'Equipe Guia de Urubici',
  category: 'Geral',
  legacySlug: 'cachoeiras-secretas-urubici',
};

const POST_MD = `---
title: "Cachoeiras secretas de Urubici"
description: "Descrição válida"
pubDate: 2026-01-15
tags: ["cachoeiras"]
draft: false
author: "Equipe Guia de Urubici"
category: "Geral"
legacySlug: "cachoeiras-secretas-urubici"
---

Corpo do post.
`;

describe('GitHubPostsClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeClient() {
    return new GitHubPostsClient({
      token: 'fake-token',
      owner: 'urubiciguia-max',
      repo: 'novo-guia-urubici',
      branch: 'main',
    });
  }

  // -- listPosts -----------------------------------------------------------

  describe('listPosts', () => {
    it('faz UMA única requisição (GraphQL) e lista os posts válidos', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: {
            repository: {
              object: {
                entries: [
                  { name: 'cachoeiras-secretas-urubici.md', type: 'blob', object: { text: POST_MD, oid: 'sha-1', isBinary: false } },
                ],
              },
            },
          },
        })
      );

      const items = await makeClient().listPosts();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.github.com/graphql');
      expect(init.method).toBe('POST');

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        slug: 'cachoeiras-secretas-urubici',
        title: 'Cachoeiras secretas de Urubici',
        category: 'Geral',
        draft: false,
        sha: 'sha-1',
        valid: true,
      });
    });

    it('ignora entries que não são arquivo .md (ex: subpastas)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: { repository: { object: { entries: [{ name: 'imagens', type: 'tree' }] } } },
        })
      );
      const items = await makeClient().listPosts();
      expect(items).toEqual([]);
    });

    it('post com frontmatter inválido entra com valid: false em vez de quebrar a listagem', async () => {
      const brokenMd = `---\ntitle: "Sem categoria valida"\ndescription: "x"\npubDate: 2026-01-15\ntags: []\ndraft: false\nauthor: "Equipe"\ncategory: "Categoria Que Nao Existe"\nlegacySlug: "sem-categoria"\n---\n\nCorpo.\n`;
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: {
            repository: {
              object: {
                entries: [{ name: 'sem-categoria.md', type: 'blob', object: { text: brokenMd, oid: 'sha-2', isBinary: false } }],
              },
            },
          },
        })
      );

      const items = await makeClient().listPosts();
      expect(items).toHaveLength(1);
      expect(items[0].valid).toBe(false);
      expect(items[0].validationErrors?.length).toBeGreaterThan(0);
    });

    it('pasta vazia (repository.object null) devolve lista vazia sem erro', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { repository: { object: null } } }));
      const items = await makeClient().listPosts();
      expect(items).toEqual([]);
    });

    it('rate limit (403 + X-RateLimit-Remaining: 0) lança RateLimitError', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('{}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60) },
        })
      );
      await expect(makeClient().listPosts()).rejects.toBeInstanceOf(RateLimitError);
    });

    it('erro GraphQL do tipo RATE_LIMITED também lança RateLimitError', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }));
      await expect(makeClient().listPosts()).rejects.toBeInstanceOf(RateLimitError);
    });

    it('erro de rede (fetch rejeitado) vira GitHubApiError, não escapa o TypeError cru', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(makeClient().listPosts()).rejects.toBeInstanceOf(GitHubApiError);
    });
  });

  // -- getPost ---------------------------------------------------------------

  describe('getPost', () => {
    it('busca o post, decodifica base64 e devolve frontmatter + body + sha', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ content: utf8ToBase64(POST_MD), encoding: 'base64', sha: 'blob-sha-abc' })
      );

      const post = await makeClient().getPost('cachoeiras-secretas-urubici');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('/repos/urubiciguia-max/novo-guia-urubici/contents/src/content/posts/cachoeiras-secretas-urubici.md');
      expect(url).toContain('ref=main');

      expect(post.sha).toBe('blob-sha-abc');
      expect(post.valid).toBe(true);
      expect(post.frontmatter.title).toBe('Cachoeiras secretas de Urubici');
      expect(post.body.trim()).toBe('Corpo do post.');
    });

    it('404 lança PostNotFoundError', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
      await expect(makeClient().getPost('nao-existe')).rejects.toBeInstanceOf(PostNotFoundError);
    });

    it('token sem escopo (403 que NÃO é rate limit) ainda vira GitHubApiError, não RateLimitError', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 403 }));
      await expect(makeClient().getPost('qualquer')).rejects.toBeInstanceOf(GitHubApiError);
    });
  });

  // -- createPost --------------------------------------------------------

  describe('createPost', () => {
    it('valida ANTES de chamar fetch -- frontmatter inválido nunca gera requisição', async () => {
      const invalid = { ...VALID_FRONTMATTER, category: 'Categoria Invalida' } as unknown as PostFrontmatter;
      await expect(makeClient().createPost('novo-post', invalid, 'corpo')).rejects.toBeInstanceOf(ValidationError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cria com sucesso (PUT sem sha) e devolve sha novo + commit sha', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ content: { sha: 'novo-sha' }, commit: { sha: 'commit-sha-1' } })
      );

      const result = await makeClient().createPost('novo-post', VALID_FRONTMATTER, 'Corpo novo.');

      expect(result).toEqual({ sha: 'novo-sha', commitSha: 'commit-sha-1' });
      const [, init] = fetchMock.mock.calls[0];
      const sentBody = JSON.parse(init.body as string);
      expect(sentBody.sha).toBeUndefined();
      expect(sentBody.branch).toBe('main');
    });

    it('arquivo já existe (422 "sha" wasn\'t supplied) lança PostAlreadyExistsError', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }), { status: 422 })
      );
      await expect(makeClient().createPost('ja-existe', VALID_FRONTMATTER, 'x')).rejects.toBeInstanceOf(PostAlreadyExistsError);
    });
  });

  // -- updatePost --------------------------------------------------------

  describe('updatePost', () => {
    it('atualiza com sucesso enviando o sha recebido', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ content: { sha: 'sha-atualizado' }, commit: { sha: 'commit-sha-2' } })
      );
      const result = await makeClient().updatePost('cachoeiras-secretas-urubici', VALID_FRONTMATTER, 'Corpo editado.', 'sha-antigo');
      expect(result.sha).toBe('sha-atualizado');

      const [, init] = fetchMock.mock.calls[0];
      const sentBody = JSON.parse(init.body as string);
      expect(sentBody.sha).toBe('sha-antigo');
    });

    it('conflito de sha (409) lança ShaConflictError', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'does not match' }), { status: 409 }));
      await expect(
        makeClient().updatePost('cachoeiras-secretas-urubici', VALID_FRONTMATTER, 'x', 'sha-desatualizado')
      ).rejects.toBeInstanceOf(ShaConflictError);
    });

    it('post não existe mais (404) lança PostNotFoundError', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
      await expect(makeClient().updatePost('removido', VALID_FRONTMATTER, 'x', 'sha')).rejects.toBeInstanceOf(PostNotFoundError);
    });

    it('frontmatter inválido lança ValidationError sem chamar fetch', async () => {
      const invalid = { ...VALID_FRONTMATTER, pubDate: '15/01/2026' } as unknown as PostFrontmatter;
      await expect(makeClient().updatePost('x', invalid, 'corpo', 'sha')).rejects.toBeInstanceOf(ValidationError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // -- deletePost ----------------------------------------------------------

  describe('deletePost', () => {
    it('remove com sucesso (204)', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(makeClient().deletePost('cachoeiras-secretas-urubici', 'sha-atual')).resolves.toBeUndefined();

      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('DELETE');
      const sentBody = JSON.parse(init.body as string);
      expect(sentBody.sha).toBe('sha-atual');
    });

    it('404 lança PostNotFoundError', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
      await expect(makeClient().deletePost('nao-existe', 'sha')).rejects.toBeInstanceOf(PostNotFoundError);
    });

    it('409 (sha desatualizado) lança ShaConflictError', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'conflict' }), { status: 409 }));
      await expect(makeClient().deletePost('post', 'sha-velho')).rejects.toBeInstanceOf(ShaConflictError);
    });
  });

  // -- token nunca aparece em lugar nenhum da requisição exceto o header --

  it('nunca inclui o token no body ou na URL das requisições, só no header Authorization', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: utf8ToBase64(POST_MD), encoding: 'base64', sha: 'x' }));
    await makeClient().getPost('cachoeiras-secretas-urubici');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('fake-token');
    expect(JSON.stringify(init.body ?? '')).not.toContain('fake-token');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fake-token');
  });
});

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

  // -- integridade do slug (path traversal) -----------------------------
  // Achado da auditoria de segurança do Severino (2026-10-30): `slug` É o
  // caminho do arquivo na Contents API (`${postsPath}/${slug}.md`). Sem
  // validação NA CAMADA DE DADOS, um `slug` como `../../.github/workflows/x`
  // escaparia da pasta de posts quando o `fetch`/`URL` resolve `../` na
  // montagem da URL -- alcançável tanto chamando o client direto via
  // DevTools/console (pulando o form) quanto via rota `#/posts/:slug/editar`
  // com `%2F` (decodificado depois do regex de rota `[^/]+`, que não bloqueia
  // o encoded). Estes testes garantem que a validação é a MESMA pra todos os
  // métodos que tocam o filesystem do repo, independente de quem chama.
  describe('integridade do slug (path traversal)', () => {
    const MALICIOUS_SLUGS = ['../../.github/workflows/evil', '../secrets', 'a/b', '', '  ', 'Capitais-Invalidas'];

    it.each(MALICIOUS_SLUGS)('getPost(%j) lança ValidationError sem chamar fetch', async (slug) => {
      await expect(makeClient().getPost(slug)).rejects.toBeInstanceOf(ValidationError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(MALICIOUS_SLUGS)('createPost(%j) lança ValidationError sem chamar fetch', async (slug) => {
      await expect(makeClient().createPost(slug, VALID_FRONTMATTER, 'corpo')).rejects.toBeInstanceOf(ValidationError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(MALICIOUS_SLUGS)('updatePost(%j) lança ValidationError sem chamar fetch', async (slug) => {
      await expect(makeClient().updatePost(slug, VALID_FRONTMATTER, 'corpo', 'sha')).rejects.toBeInstanceOf(ValidationError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(MALICIOUS_SLUGS)('deletePost(%j) lança ValidationError sem chamar fetch', async (slug) => {
      await expect(makeClient().deletePost(slug, 'sha')).rejects.toBeInstanceOf(ValidationError);
      expect(fetchMock).not.toHaveBeenCalled();
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

  // -- uploadCoverImage ----------------------------------------------------

  describe('uploadCoverImage', () => {
    // Magic bytes reais de JPEG (`FF D8 FF ...`) -- desde a correção do
    // Severino (2026-10-30), `uploadCoverImage` confere o conteúdo real do
    // `base64Content`, não só o `mimeType` declarado. Ver teste dedicado
    // abaixo ("mimeType declarado não bate com os bytes reais").
    const VALID_FILE = { name: 'foto.jpg', mimeType: 'image/jpeg', base64Content: '/9j/4AAAAAAAAAAA' };

    it('upload novo: GET 404 (sem capa existente) seguido de PUT sem sha', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }))
        .mockResolvedValueOnce(jsonResponse({ content: { sha: 'img-sha-1' }, commit: { sha: 'commit-sha-img-1' } }));

      const result = await makeClient().uploadCoverImage('cachoeiras-secretas-urubici', VALID_FILE);

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [getUrl, getInit] = fetchMock.mock.calls[0];
      expect(getUrl).toContain(
        '/repos/urubiciguia-max/novo-guia-urubici/contents/src/content/posts/cachoeiras-secretas-urubici-capa.jpg'
      );
      expect(getInit.method).toBe('GET');

      const [putUrl, putInit] = fetchMock.mock.calls[1];
      expect(putUrl).toContain('cachoeiras-secretas-urubici-capa.jpg');
      expect(putInit.method).toBe('PUT');
      const sentBody = JSON.parse(putInit.body as string);
      expect(sentBody.sha).toBeUndefined();
      expect(sentBody.content).toBe(VALID_FILE.base64Content);
      expect(sentBody.message).toBe('content: atualiza capa do post "cachoeiras-secretas-urubici"');

      expect(result).toEqual({
        path: './cachoeiras-secretas-urubici-capa.jpg',
        sha: 'img-sha-1',
        commitSha: 'commit-sha-img-1',
      });
    });

    it('substituição: GET 200 (capa existente) seguido de PUT incluindo o sha atual', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ content: 'base64-antigo', encoding: 'base64', sha: 'img-sha-velho' }))
        .mockResolvedValueOnce(jsonResponse({ content: { sha: 'img-sha-novo' }, commit: { sha: 'commit-sha-img-2' } }));

      const result = await makeClient().uploadCoverImage('cachoeiras-secretas-urubici', VALID_FILE);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [, putInit] = fetchMock.mock.calls[1];
      const sentBody = JSON.parse(putInit.body as string);
      expect(sentBody.sha).toBe('img-sha-velho');

      expect(result.sha).toBe('img-sha-novo');
      expect(result.commitSha).toBe('commit-sha-img-2');
    });

    it('rejeita mimeType fora da allowlist (SVG) ANTES de qualquer chamada de rede', async () => {
      const svgFile = { ...VALID_FILE, name: 'icone.svg', mimeType: 'image/svg+xml' };
      await expect(makeClient().uploadCoverImage('cachoeiras-secretas-urubici', svgFile)).rejects.toBeInstanceOf(
        ValidationError
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejeita mimeType fora da allowlist (PDF disfarçado de imagem) ANTES de qualquer chamada de rede', async () => {
      const fakeFile = { ...VALID_FILE, name: 'documento.pdf', mimeType: 'application/pdf' };
      await expect(makeClient().uploadCoverImage('cachoeiras-secretas-urubici', fakeFile)).rejects.toBeInstanceOf(
        ValidationError
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejeita base64Content acima do limite de tamanho ANTES de qualquer chamada de rede', async () => {
      const bigFile = { ...VALID_FILE, base64Content: 'A'.repeat(1_400_001) };
      await expect(makeClient().uploadCoverImage('cachoeiras-secretas-urubici', bigFile)).rejects.toBeInstanceOf(
        ValidationError
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['../../.github/workflows/evil', '../secrets', 'a/b', '', '  ', 'Capitais-Invalidas'])(
      'uploadCoverImage(%j) lança ValidationError sem chamar fetch',
      async (slug) => {
        await expect(makeClient().uploadCoverImage(slug, VALID_FILE)).rejects.toBeInstanceOf(ValidationError);
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );

    it('deriva extensão correta pros 3 mimeTypes aceitos (com magic bytes reais correspondentes)', async () => {
      const cases: Array<[string, string, string]> = [
        ['image/jpeg', 'jpg', '/9j/4AAAAAAAAAAA'],
        ['image/png', 'png', 'iVBORw0KGgoAAAAA'],
        ['image/webp', 'webp', 'UklGRgAAAABXRUJQ'],
      ];

      for (const [mimeType, ext, base64Content] of cases) {
        fetchMock
          .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }))
          .mockResolvedValueOnce(jsonResponse({ content: { sha: 'sha' }, commit: { sha: 'commit-sha' } }));

        const result = await makeClient().uploadCoverImage('cachoeiras-secretas-urubici', {
          name: `foto.${ext}`,
          mimeType,
          base64Content,
        });

        expect(result.path).toBe(`./cachoeiras-secretas-urubici-capa.${ext}`);
      }
    });

    it('rejeita quando o mimeType declarado não bate com os bytes reais (chamada forjada via DevTools/console, pulando a validação da UI)', async () => {
      // Cenário do achado de segurança do Severino (2026-10-30): um caller
      // com acesso direto à instância de `GitHubPostsClient` (console do
      // navegador) declara `mimeType: 'image/jpeg'` mas manda conteúdo que
      // na real é texto/HTML/JS, não uma imagem de verdade.
      const forgedFile = {
        name: 'foto.jpg',
        mimeType: 'image/jpeg',
        base64Content: Buffer.from('<script>alert(1)</script>').toString('base64'),
      };
      await expect(
        makeClient().uploadCoverImage('cachoeiras-secretas-urubici', forgedFile)
      ).rejects.toBeInstanceOf(ValidationError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejeita quando os bytes são de um tipo real porém diferente do mimeType declarado (PNG disfarçado de JPEG)', async () => {
      const mismatchedFile = {
        name: 'foto.jpg',
        mimeType: 'image/jpeg',
        base64Content: 'iVBORw0KGgoAAAAA', // magic bytes reais de PNG
      };
      await expect(
        makeClient().uploadCoverImage('cachoeiras-secretas-urubici', mismatchedFile)
      ).rejects.toBeInstanceOf(ValidationError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('conflito de sha na substituição (409) lança ShaConflictError', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ content: 'base64-antigo', encoding: 'base64', sha: 'img-sha-velho' }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'does not match' }), { status: 409 }));

      await expect(makeClient().uploadCoverImage('cachoeiras-secretas-urubici', VALID_FILE)).rejects.toBeInstanceOf(
        ShaConflictError
      );
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

import {
  PostAlreadyExistsError,
  PostNotFoundError,
  ShaConflictError,
  postFrontmatterSchema,
  ValidationError,
} from '@admin-data/index.js';
import type { PostFrontmatter, PostListItem, PostRecord, WriteResult } from '@admin-data/index.js';
// `zodIssuesToErrors` não é exportado pelo barrel (`index.ts`) -- só por `schema.ts` direto.
import { zodIssuesToErrors } from '@admin-data/schema.js';
import type { PostsClient } from './postsClient';

/**
 * Client mock, SÓ pra dev local (ver `postsClient.ts` -- `USE_MOCK` é
 * `false` estático em build de produção). Deixa eu clicar em Dashboard /
 * Artigos / criar / editar / deletar sem precisar de um token real do
 * GitHub nem de um OAuth App configurado -- útil justamente porque o
 * handoff do Jurandir marca "testar `listPosts()` com token real" como
 * pendência de risco que eu não consigo validar nesta sessão (sem
 * credenciais do GitHub OAuth App ainda).
 *
 * Reaproveita o schema Zod real (`postFrontmatterSchema`) e os erros
 * tipados reais do `admin-app/src` -- o mock se comporta o mais parecido
 * possível com o client de verdade (valida antes de "salvar", lança
 * `ShaConflictError`/`PostNotFoundError`/`PostAlreadyExistsError` nos mesmos
 * casos), pra eu exercitar os caminhos de erro da UI sem rede.
 */

interface MockPost {
  slug: string;
  frontmatter: PostFrontmatter;
  body: string;
  sha: string;
  valid: boolean;
  validationErrors?: string[];
}

function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(value), ms));
}

function nextSha(prev: string): string {
  const n = Number(prev.replace('sha-', '')) || 0;
  return `sha-${n + 1}`;
}

function seed(): MockPost[] {
  return [
    {
      slug: 'cachoeiras-secretas-urubici',
      sha: 'sha-1',
      valid: true,
      body: '## As cachoeiras menos conhecidas\n\nUrubici tem dezenas de quedas d\'água fora do roteiro turístico padrão...',
      frontmatter: {
        title: 'Cachoeiras secretas de Urubici que (quase) ninguém conhece',
        description: 'Um roteiro pelas cachoeiras menos visitadas da Serra Catarinense, longe das trilhas mais cheias.',
        pubDate: '2026-01-15',
        tags: ['cachoeiras', 'trilhas', 'roteiro'],
        draft: false,
        author: 'Equipe Guia de Urubici',
        category: 'O Que Fazer',
        legacySlug: 'cachoeiras-secretas-urubici',
      },
    },
    {
      slug: 'onde-comer-centro-urubici',
      sha: 'sha-1',
      valid: true,
      body: '## Os melhores restaurantes do centro\n\nSeparamos as opções com melhor relação custo-benefício...',
      frontmatter: {
        title: 'Onde comer no centro de Urubici: 8 restaurantes testados',
        description: 'Guia prático com os restaurantes do centro de Urubici testados pela nossa equipe, com preço médio.',
        pubDate: '2026-02-02',
        tags: ['gastronomia'],
        draft: false,
        author: 'Equipe Guia de Urubici',
        category: 'Onde Comer',
        legacySlug: 'onde-comer-centro-urubici',
      },
    },
    {
      slug: 'quando-ir-urubici-neve',
      sha: 'sha-1',
      valid: true,
      body: '## Quando a neve acontece\n\nRascunho -- falta revisar os dados históricos de temperatura.',
      frontmatter: {
        title: 'Quando ir a Urubici pra ver neve (ou quase)',
        description: 'Entenda a época certa do ano pra ter mais chance de pegar frio de verdade em Urubici.',
        pubDate: '2026-03-10',
        tags: ['clima', 'inverno'],
        draft: true,
        author: 'Equipe Guia de Urubici',
        category: 'Guia Prático',
        legacySlug: 'quando-ir-urubici-neve',
      },
    },
    {
      slug: 'post-legado-sem-categoria',
      sha: 'sha-1',
      valid: false,
      body: 'Post migrado do WordPress antigo, frontmatter incompleto.',
      validationErrors: ['category: Invalid enum value', 'legacySlug: Required'],
      frontmatter: {
        title: 'Post legado com frontmatter incompleto',
        description: 'Exemplo de post que veio da migração sem todos os campos obrigatórios preenchidos.',
        pubDate: '2025-11-01',
        tags: [],
        draft: false,
        author: 'Equipe Guia de Urubici',
        // @ts-expect-error -- de propósito: simula frontmatter que não bate com o schema (migração antiga).
        category: 'Sem categoria',
        legacySlug: '',
      },
    },
  ];
}

export function createMockPostsClient(): PostsClient {
  const posts = seed();

  return {
    async listPosts(): Promise<PostListItem[]> {
      return delay(
        posts.map((p) => ({
          slug: p.slug,
          title: p.frontmatter.title,
          category: p.valid ? p.frontmatter.category : null,
          author: p.frontmatter.author,
          pubDate: p.frontmatter.pubDate,
          updatedDate: p.frontmatter.updatedDate ?? null,
          draft: p.frontmatter.draft,
          legacySlug: p.valid ? p.frontmatter.legacySlug : null,
          sha: p.sha,
          valid: p.valid,
          validationErrors: p.validationErrors,
        }))
      );
    },

    async getPost(slug: string): Promise<PostRecord> {
      const found = posts.find((p) => p.slug === slug);
      if (!found) throw new PostNotFoundError(slug);
      return delay({
        slug: found.slug,
        frontmatter: found.frontmatter,
        body: found.body,
        sha: found.sha,
        valid: found.valid,
        validationErrors: found.validationErrors,
      });
    },

    async createPost(slug: string, frontmatter: PostFrontmatter, body: string): Promise<WriteResult> {
      const parsed = postFrontmatterSchema.safeParse(frontmatter);
      if (!parsed.success) throw new ValidationError(zodIssuesToErrors(parsed.error.issues));
      if (posts.some((p) => p.slug === slug)) throw new PostAlreadyExistsError(slug);
      const sha = 'sha-1';
      posts.push({ slug, frontmatter: parsed.data, body, sha, valid: true });
      return delay({ sha, commitSha: `commit-${Date.now()}` });
    },

    async updatePost(slug: string, frontmatter: PostFrontmatter, body: string, sha: string): Promise<WriteResult> {
      const idx = posts.findIndex((p) => p.slug === slug);
      if (idx === -1) throw new PostNotFoundError(slug);
      if (posts[idx].sha !== sha) throw new ShaConflictError(slug);
      const parsed = postFrontmatterSchema.safeParse(frontmatter);
      if (!parsed.success) throw new ValidationError(zodIssuesToErrors(parsed.error.issues));
      const newSha = nextSha(sha);
      posts[idx] = { slug, frontmatter: parsed.data, body, sha: newSha, valid: true };
      return delay({ sha: newSha, commitSha: `commit-${Date.now()}` });
    },

    async deletePost(slug: string, sha: string): Promise<void> {
      const idx = posts.findIndex((p) => p.slug === slug);
      if (idx === -1) throw new PostNotFoundError(slug);
      if (posts[idx].sha !== sha) throw new ShaConflictError(slug);
      posts.splice(idx, 1);
      await delay(undefined);
    },
  };
}

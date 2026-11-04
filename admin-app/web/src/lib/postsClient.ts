import { GitHubPostsClient } from '@admin-data/index.js';
import type { PostFrontmatter, PostListItem, PostRecord, RenamePostResult, WriteResult } from '@admin-data/index.js';
import { GH_BRANCH, GH_OWNER, GH_REPO, USE_MOCK } from './env';
import { createMockPostsClient } from './mockClient';

/**
 * Interface estrutural que `GitHubPostsClient` e `MockPostsClient` (dev-only,
 * ver `mockClient.ts`) implementam. Extraída aqui pra UI/contexts
 * dependerem de uma interface, não da classe concreta -- deixa a troca
 * real/mock transparente pro resto do app.
 */
export interface UploadCoverImageFile {
  name: string;
  mimeType: string;
  base64Content: string;
}

export interface UploadCoverImageResult {
  path: string;
  sha: string;
  commitSha: string;
}

/** Arquivo de imagem de CONTEÚDO (corpo do post/página, toolbar do editor) -- mesmo shape de `UploadCoverImageFile`, tipo próprio pra não confundir os dois fluxos na assinatura dos métodos. */
export interface UploadContentImageFile {
  name: string;
  mimeType: string;
  base64Content: string;
}

export interface UploadContentImageResult {
  path: string;
  sha: string;
  commitSha: string;
}

export interface PostsClient {
  listPosts(): Promise<PostListItem[]>;
  getPost(slug: string): Promise<PostRecord>;
  createPost(slug: string, frontmatter: PostFrontmatter, body: string): Promise<WriteResult>;
  updatePost(slug: string, frontmatter: PostFrontmatter, body: string, sha: string): Promise<WriteResult>;
  deletePost(slug: string, sha: string): Promise<void>;
  /**
   * Commita o binário já validado/comprimido (ver `lib/imageUpload.ts` --
   * validação de magic bytes e compressão client-side acontecem ANTES de
   * chegar aqui, essa camada só chama o client). Contrato combinado com o
   * Jurandir (TRACK B, `.agents/inbox/genilson.md`):
   * `GitHubPostsClient.uploadCoverImage()` decide upsert (criar vs.
   * substituir) sozinho e devolve o path relativo já pronto pro campo
   * `cover` do form.
   */
  uploadCoverImage(legacySlug: string, file: UploadCoverImageFile): Promise<UploadCoverImageResult>;
  /**
   * Commita o binário já validado/comprimido direto no corpo do post
   * (toolbar do editor) -- SEM upsert, diferente de `uploadCoverImage`:
   * cada upload é um arquivo novo (nome único gerado pelo
   * `GitHubPostsClient`, não existe "substituir imagem de conteúdo X").
   * Contrato combinado com o Jurandir: `GitHubPostsClient.uploadContentImage()`.
   */
  uploadContentImage(slug: string, file: UploadContentImageFile): Promise<UploadContentImageResult>;
  /**
   * Renomeia o slug de um post JÁ PUBLICADO -- move o arquivo pro path do
   * `newSlug`, copia a capa junto (se seguir a convenção de nome) e grava
   * um redirect 301 de `oldSlug` pra `newSlug` em `public/_redirects`
   * (regra inegociável de SEO técnico, ver CLAUDE.md). `newSlug === oldSlug`
   * é tratado como um `updatePost` normal pelo `GitHubPostsClient`. Exige o
   * `sha` atual do post ANTIGO (mesma otimistic-lock de `updatePost`/
   * `deletePost`). Contrato combinado com o Jurandir (spec do Genilson,
   * 2026-11-04): `GitHubPostsClient.renamePost()`.
   */
  renamePost(
    oldSlug: string,
    newSlug: string,
    frontmatter: PostFrontmatter,
    body: string,
    sha: string
  ): Promise<RenamePostResult>;
}

/**
 * Fábrica do client de dados. `USE_MOCK` só é `true` em dev com
 * `VITE_MOCK=1` explícito (ver `lib/env.ts`) -- em build de produção essa
 * constante é `false` estático, então o branch do mock nem entra no bundle
 * final (dead-code elimination do esbuild/Rollup). Existe pra eu conseguir
 * validar manualmente Dashboard/Artigos/Form sem precisar de um token real
 * do GitHub nem de um OAuth App configurado nesta fase.
 */
export function createPostsClient(token: string): PostsClient {
  if (USE_MOCK) {
    return createMockPostsClient();
  }
  return new GitHubPostsClient({ token, owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH });
}

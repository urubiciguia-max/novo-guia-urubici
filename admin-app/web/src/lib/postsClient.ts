import { GitHubPostsClient } from '@admin-data/index.js';
import type { PostFrontmatter, PostListItem, PostRecord, WriteResult } from '@admin-data/index.js';
import { GH_BRANCH, GH_OWNER, GH_REPO, USE_MOCK } from './env';
import { createMockPostsClient } from './mockClient';

/**
 * Interface estrutural que `GitHubPostsClient` e `MockPostsClient` (dev-only,
 * ver `mockClient.ts`) implementam. Extraída aqui pra UI/contexts
 * dependerem de uma interface, não da classe concreta -- deixa a troca
 * real/mock transparente pro resto do app.
 */
export interface PostsClient {
  listPosts(): Promise<PostListItem[]>;
  getPost(slug: string): Promise<PostRecord>;
  createPost(slug: string, frontmatter: PostFrontmatter, body: string): Promise<WriteResult>;
  updatePost(slug: string, frontmatter: PostFrontmatter, body: string, sha: string): Promise<WriteResult>;
  deletePost(slug: string, sha: string): Promise<void>;
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

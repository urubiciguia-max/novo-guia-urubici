import { GitHubPostsClient } from '@admin-data/index.js';
import type { PageFrontmatter, PageListItem, PageRecord, WriteResult } from '@admin-data/index.js';
import { GH_BRANCH, GH_OWNER, GH_REPO, USE_MOCK } from './env';
import { createMockPagesClient } from './mockClient';

/**
 * Equivalente de `PostsClient` (ver `postsClient.ts`) pra páginas
 * institucionais -- SEM `createPage`/`deletePage` de propósito: lista
 * fechada de 4 arquivos (sobre-nos, contato, politica-de-privacidade,
 * termos-de-uso), não existe fluxo de criar/apagar página nesta fase (ver
 * spec do Genilson).
 */
export interface PagesClient {
  listPages(): Promise<PageListItem[]>;
  getPage(slug: string): Promise<PageRecord>;
  updatePage(slug: string, frontmatter: PageFrontmatter, body: string, sha: string): Promise<WriteResult>;
}

/**
 * Fábrica do client de dados pra páginas -- mesmo princípio de
 * `createPostsClient`: `USE_MOCK` é `false` estático em build de produção,
 * então o branch do mock nem entra no bundle final.
 */
export function createPagesClient(token: string): PagesClient {
  if (USE_MOCK) {
    return createMockPagesClient();
  }
  return new GitHubPostsClient({ token, owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH });
}

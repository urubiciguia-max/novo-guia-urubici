import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PostFrontmatter, PostListItem, PostRecord, WriteResult } from '@admin-data/index.js';
import { useAuth } from '../auth/AuthContext';
import { isUnauthorized } from '../lib/errorMessage';
import type { UploadCoverImageFile, UploadCoverImageResult } from '../lib/postsClient';

interface PostsState {
  items: PostListItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getPost: (slug: string) => Promise<PostRecord>;
  createPost: (slug: string, frontmatter: PostFrontmatter, body: string) => Promise<WriteResult>;
  updatePost: (slug: string, frontmatter: PostFrontmatter, body: string, sha: string) => Promise<WriteResult>;
  deletePost: (slug: string, sha: string) => Promise<void>;
  uploadCoverImage: (legacySlug: string, file: UploadCoverImageFile) => Promise<UploadCoverImageResult>;
}

const PostsContext = createContext<PostsState | null>(null);

/**
 * Único lugar que chama o `PostsClient` -- Dashboard e tela de Artigos
 * consomem só `items`/`loading`/`error` daqui, nunca instanciam o client
 * direto. Qualquer 401 (token morto) borbulha pro `AuthContext` via
 * `handleUnauthorized()`, que desloga e manda pra tela de login -- nenhuma
 * página precisa saber disso.
 */
export function PostsProvider({ children }: { children: ReactNode }) {
  const { client, handleUnauthorized } = useAuth();
  const [items, setItems] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const list = await client.listPosts();
      setItems(list);
    } catch (err) {
      if (isUnauthorized(err)) {
        handleUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : 'Erro desconhecido ao carregar os posts.');
    } finally {
      setLoading(false);
    }
  }, [client, handleUnauthorized]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh já depende de `client`.
  }, [client]);

  const wrap = useCallback(
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        try {
          return await fn(...args);
        } catch (err) {
          if (isUnauthorized(err)) handleUnauthorized();
          throw err;
        }
      },
    [handleUnauthorized]
  );

  const getPost = useCallback(
    (slug: string) => {
      if (!client) throw new Error('Sem sessão ativa.');
      return wrap(client.getPost.bind(client))(slug);
    },
    [client, wrap]
  );

  const createPost = useCallback(
    (slug: string, frontmatter: PostFrontmatter, body: string) => {
      if (!client) throw new Error('Sem sessão ativa.');
      return wrap(client.createPost.bind(client))(slug, frontmatter, body);
    },
    [client, wrap]
  );

  const updatePost = useCallback(
    (slug: string, frontmatter: PostFrontmatter, body: string, sha: string) => {
      if (!client) throw new Error('Sem sessão ativa.');
      return wrap(client.updatePost.bind(client))(slug, frontmatter, body, sha);
    },
    [client, wrap]
  );

  const deletePost = useCallback(
    (slug: string, sha: string) => {
      if (!client) throw new Error('Sem sessão ativa.');
      return wrap(client.deletePost.bind(client))(slug, sha);
    },
    [client, wrap]
  );

  const uploadCoverImage = useCallback(
    (legacySlug: string, file: UploadCoverImageFile) => {
      if (!client) throw new Error('Sem sessão ativa.');
      return wrap(client.uploadCoverImage.bind(client))(legacySlug, file);
    },
    [client, wrap]
  );

  const value = useMemo<PostsState>(
    () => ({ items, loading, error, refresh, getPost, createPost, updatePost, deletePost, uploadCoverImage }),
    [items, loading, error, refresh, getPost, createPost, updatePost, deletePost, uploadCoverImage]
  );

  return <PostsContext.Provider value={value}>{children}</PostsContext.Provider>;
}

export function usePosts(): PostsState {
  const ctx = useContext(PostsContext);
  if (!ctx) throw new Error('usePosts precisa estar dentro de <PostsProvider>.');
  return ctx;
}

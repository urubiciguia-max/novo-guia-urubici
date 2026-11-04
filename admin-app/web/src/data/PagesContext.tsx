import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PageFrontmatter, PageListItem, PageRecord, WriteResult } from '@admin-data/index.js';
import { useAuth } from '../auth/AuthContext';
import { isUnauthorized } from '../lib/errorMessage';
import type { UploadContentImageFile, UploadContentImageResult } from '../lib/postsClient';

interface PagesState {
  items: PageListItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getPage: (slug: string) => Promise<PageRecord>;
  updatePage: (slug: string, frontmatter: PageFrontmatter, body: string, sha: string) => Promise<WriteResult>;
  /** Upload de imagem inserida no CORPO da página (toolbar) -- ver `PagesClient.uploadPageContentImage`. */
  uploadContentImage: (slug: string, file: UploadContentImageFile) => Promise<UploadContentImageResult>;
}

const PagesContext = createContext<PagesState | null>(null);

/**
 * Equivalente de `PostsContext` pras 4 páginas institucionais -- consome o
 * `pagesClient` já instanciado pelo `AuthContext` (mesmo token de sessão
 * que o client de Artigos, ver `auth/AuthContext.tsx`). Sem
 * `createPage`/`deletePage` de propósito: lista fechada de 4 arquivos.
 * Qualquer 401 borbulha pro `AuthContext` (`handleUnauthorized`), mesma
 * lógica de `PostsContext`.
 */
export function PagesProvider({ children }: { children: ReactNode }) {
  const { pagesClient: client, handleUnauthorized } = useAuth();
  const [items, setItems] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const list = await client.listPages();
      setItems(list);
    } catch (err) {
      if (isUnauthorized(err)) {
        handleUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : 'Erro desconhecido ao carregar as páginas.');
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

  const getPage = useCallback(
    (slug: string) => {
      if (!client) throw new Error('Sem sessão ativa.');
      return wrap(client.getPage.bind(client))(slug);
    },
    [client, wrap]
  );

  const updatePage = useCallback(
    (slug: string, frontmatter: PageFrontmatter, body: string, sha: string) => {
      if (!client) throw new Error('Sem sessão ativa.');
      return wrap(client.updatePage.bind(client))(slug, frontmatter, body, sha);
    },
    [client, wrap]
  );

  const uploadContentImage = useCallback(
    (slug: string, file: UploadContentImageFile) => {
      if (!client) throw new Error('Sem sessão ativa.');
      return wrap(client.uploadPageContentImage.bind(client))(slug, file);
    },
    [client, wrap]
  );

  const value = useMemo<PagesState>(
    () => ({ items, loading, error, refresh, getPage, updatePage, uploadContentImage }),
    [items, loading, error, refresh, getPage, updatePage, uploadContentImage]
  );

  return <PagesContext.Provider value={value}>{children}</PagesContext.Provider>;
}

export function usePages(): PagesState {
  const ctx = useContext(PagesContext);
  if (!ctx) throw new Error('usePages precisa estar dentro de <PagesProvider>.');
  return ctx;
}

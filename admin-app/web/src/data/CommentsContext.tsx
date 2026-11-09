import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { loadToken } from '../lib/session';
import { approveComment, rejectComment, listPendingComments, CommentsApiError, type PendingComment } from '../lib/commentsClient';

interface CommentsState {
  items: PendingComment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** `true` = aprovado, removido da fila. Lança se bloqueado por 409 (deixa o botão disponível pra tentar de novo). */
  approve: (comment: PendingComment) => Promise<void>;
  reject: (comment: PendingComment) => Promise<void>;
}

const CommentsContext = createContext<CommentsState | null>(null);

/**
 * Equivalente de `PostsContext`/`PagesContext` pra fila de comentários
 * pendentes -- MAS não usa `client`/`pagesClient` do `AuthContext` (esses
 * dois só sabem falar com a API do GitHub). Lê o token direto de
 * `lib/session.ts` (mesmo storage, mesma sessão) porque `/api/admin/comments`
 * é uma Cloudflare Pages Function própria do site, não a API do GitHub --
 * ver `lib/commentsClient.ts`.
 *
 * Exposto num Provider próprio (como os outros dois) pra `Sidebar` poder
 * mostrar o contador de pendentes sem duplicar a chamada de fetch.
 */
export function CommentsProvider({ children }: { children: ReactNode }) {
  const { status, handleUnauthorized } = useAuth();
  const [items, setItems] = useState<PendingComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const token = loadToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listPendingComments(token);
      setItems(list);
    } catch (err) {
      if (err instanceof CommentsApiError && err.status === 401) {
        handleUnauthorized();
      } else {
        setError(err instanceof Error ? err.message : 'Erro desconhecido ao carregar os comentários.');
      }
    } finally {
      setLoading(false);
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    if (status === 'logged-in') {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh já é estável, só precisa reagir à sessão.
  }, [status]);

  const approve = useCallback(
    async (comment: PendingComment) => {
      const token = loadToken();
      if (!token) throw new Error('Sem sessão ativa.');
      try {
        await approveComment(token, comment.key);
        setItems((prev) => prev.filter((c) => c.key !== comment.key));
      } catch (err) {
        if (err instanceof CommentsApiError) {
          if (err.status === 401) {
            handleUnauthorized();
          } else if (err.status === 404) {
            // Outra aba já moderou -- some da lista aqui também, sem contar como falha do usuário.
            setItems((prev) => prev.filter((c) => c.key !== comment.key));
          }
        }
        throw err;
      }
    },
    [handleUnauthorized]
  );

  const reject = useCallback(
    async (comment: PendingComment) => {
      const token = loadToken();
      if (!token) throw new Error('Sem sessão ativa.');
      try {
        await rejectComment(token, comment.key);
        setItems((prev) => prev.filter((c) => c.key !== comment.key));
      } catch (err) {
        if (err instanceof CommentsApiError && err.status === 401) {
          handleUnauthorized();
        }
        throw err;
      }
    },
    [handleUnauthorized]
  );

  const value = useMemo<CommentsState>(
    () => ({ items, loading, error, refresh, approve, reject }),
    [items, loading, error, refresh, approve, reject]
  );

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}

export function useComments(): CommentsState {
  const ctx = useContext(CommentsContext);
  if (!ctx) throw new Error('useComments precisa estar dentro de <CommentsProvider>.');
  return ctx;
}

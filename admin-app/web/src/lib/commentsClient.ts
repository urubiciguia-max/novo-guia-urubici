import { SITE_URL } from './env';

/**
 * Client pra moderação de comentários -- DIFERENTE de `postsClient.ts`/
 * `pagesClient.ts`: esses dois falam direto com a API do GitHub
 * (api.github.com), enquanto comentários falam com a Cloudflare Pages
 * Function do PRÓPRIO site (`/api/admin/comments...`, ver `functions/` na
 * raiz do repo e o handoff do Jurandir em
 * `.agents/inbox/francisgleydisson.md`). Por isso não reusa
 * `GitHubPostsClient`/`@admin-data` -- é um fetch simples com o MESMO
 * token OAuth que o resto do admin já guarda (`lib/session.ts`).
 *
 * `SITE_URL` (não caminho relativo) porque em dev a SPA roda no Vite
 * (porta própria) enquanto as Functions só existem no domínio do Cloudflare
 * Pages -- em produção a SPA é servida do MESMO domínio (`public/admin/`),
 * então a URL absoluta funciona nos dois casos.
 */
export interface PendingComment {
  key: string;
  id: string;
  slug: string;
  name: string;
  text: string;
  createdAt: string;
}

export class CommentsApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'CommentsApiError';
  }
}

async function safeJsonError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? null;
  } catch {
    return null;
  }
}

async function request(path: string, token: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${SITE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new CommentsApiError(0, 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
  }
}

function throwIfAuthError(res: Response): void {
  if (res.status === 401) {
    throw new CommentsApiError(401, 'Sua sessão expirou ou o token perdeu acesso. Entre novamente.');
  }
  if (res.status === 403) {
    throw new CommentsApiError(403, 'Seu token não tem permissão de escrita no repositório.');
  }
}

export async function listPendingComments(token: string): Promise<PendingComment[]> {
  const res = await request('/api/admin/comments?status=pending', token);
  throwIfAuthError(res);
  if (!res.ok) {
    throw new CommentsApiError(res.status, (await safeJsonError(res)) ?? 'Não foi possível carregar os comentários pendentes.');
  }
  const data = (await res.json()) as { comments: PendingComment[] };
  return data.comments;
}

/** 404 = outra aba já moderou esse comentário; 409 = colisão de aprovação em paralelo (raro) -- ambos tratados pela tela, não aqui. */
export async function approveComment(token: string, key: string): Promise<{ slug: string; commitSha: string }> {
  const res = await request(`/api/admin/comments/${encodeURIComponent(key)}/approve`, token, { method: 'POST' });
  throwIfAuthError(res);
  if (res.status === 404) {
    throw new CommentsApiError(404, 'Esse comentário já foi moderado em outra aba.');
  }
  if (res.status === 409) {
    throw new CommentsApiError(409, 'Deu conflito ao aprovar (outra aprovação em paralelo). Tenta de novo.');
  }
  if (!res.ok) {
    throw new CommentsApiError(res.status, (await safeJsonError(res)) ?? 'Não foi possível aprovar o comentário.');
  }
  return res.json();
}

/** Sempre 204, idempotente -- rejeitar algo que já não existe também não é erro (ver handoff). */
export async function rejectComment(token: string, key: string): Promise<void> {
  const res = await request(`/api/admin/comments/${encodeURIComponent(key)}/reject`, token, { method: 'POST' });
  throwIfAuthError(res);
  if (res.status !== 204 && !res.ok) {
    throw new CommentsApiError(res.status, (await safeJsonError(res)) ?? 'Não foi possível rejeitar o comentário.');
  }
}

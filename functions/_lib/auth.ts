const GITHUB_API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export type AdminAuthResult = { ok: true } | { ok: false; status: 401 | 403; reason: string };

interface RepoResponseBody {
  permissions?: { push?: boolean; admin?: boolean };
}

/**
 * Confere que o `Authorization: Bearer <token>` recebido nos endpoints
 * `/api/admin/*` é um token OAuth do GitHub válido E com permissão de
 * escrita no repo -- `GET /repos/{owner}/{repo}` autenticado devolve
 * `permissions.push` quando quem chama é owner/collaborator com acesso de
 * escrita (mesma checagem que o GitHub faz internamente antes de aceitar
 * um `PUT .../contents/...`, então isso reflete exatamente a permissão
 * que `GitHubCommentsClient.appendComment` vai precisar de verdade).
 *
 * Decisão de segurança (spec do Genilson, 2026-11-09): NÃO existe token
 * "bot" fixo aqui. O token é sempre o do PRÓPRIO Moises, repassado do
 * browser dele (mesmo token que `admin-app/web` já usa pra tudo) -- uma
 * aprovação só acontece com o dono do site autenticado no admin. Token
 * inválido/expirado -> 401. Token válido mas sem escopo/permissão de
 * escrita -> 403 (nunca deixamos passar achando que "autenticado" basta).
 */
export async function verifyAdminToken(token: string, owner: string, repo: string): Promise<AdminAuthResult> {
  if (!token) {
    return { ok: false, status: 401, reason: 'Token de autorização ausente.' };
  }

  let res: Response;
  try {
    res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        // Obrigatório -- GitHub rejeita com 403 "Request forbidden by
        // administrative rules" qualquer chamada à API sem User-Agent.
        // Browsers mandam isso sozinhos (por isso postsClient.ts/pagesClient.ts
        // nunca precisaram disso), mas o fetch() do Cloudflare Workers não
        // seta um default -- achado em produção, 2026-11-09 (ver
        // github-comments-client.ts, mesmo fix aplicado lá).
        'User-Agent': 'guia-urubici-admin',
      },
    });
  } catch {
    return { ok: false, status: 401, reason: 'Erro de rede ao validar o token com o GitHub.' };
  }

  // DIAGNÓSTICO TEMPORÁRIO (Genilson, 2026-11-09) -- confirmando se o fix
  // de User-Agent resolveu de vez, remover depois.
  if (!res.ok) {
    console.log('[DIAG2] github status', res.status, 'body', (await res.clone().text()).slice(0, 300));
  }

  if (res.status === 401) {
    return { ok: false, status: 401, reason: 'Token inválido ou expirado.' };
  }
  // 404 aqui significa "repo não encontrado PARA ESTE TOKEN" -- em repo
  // privado seria ambíguo (não existe vs. sem acesso), mas este repo é
  // público (ver admin-app/web/src/lib/env.ts, OAUTH_SCOPE default
  // `public_repo`), então 404 só acontece com token sem nenhum acesso
  // relevante configurado -- tratamos como falta de permissão, não 401.
  if (res.status === 404) {
    return { ok: false, status: 403, reason: 'Token sem acesso a este repositório.' };
  }
  if (!res.ok) {
    return { ok: false, status: 401, reason: `GitHub respondeu ${res.status} ao validar o token.` };
  }

  const body = (await res.json().catch(() => null)) as RepoResponseBody | null;
  if (!body?.permissions?.push) {
    return { ok: false, status: 403, reason: 'Token válido, mas sem permissão de escrita neste repositório.' };
  }

  return { ok: true };
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

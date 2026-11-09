import type { Env } from '../env.js';
import { extractBearerToken, verifyAdminToken } from '../auth.js';
import { GITHUB_OWNER, GITHUB_REPO } from '../github-repo.js';
import type { PendingComment, PendingCommentListItem } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * `GET /api/admin/comments?status=pending` -- lista todos os comentários
 * pendentes (todos os slugs) pro painel de moderação do admin-app. Só
 * `status=pending` é suportado hoje (comentário rejeitado é apagado do
 * KV, não existe estado "rejected" pra listar depois; comentário aprovado
 * já virou arquivo estático no repo, consultável via GitHub/Astro, não
 * por esta API).
 */
export async function handleListPendingComments(request: Request, env: Env): Promise<Response> {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token) return jsonResponse({ error: 'Token de autorização ausente.' }, 401);

  const auth = await verifyAdminToken(token, GITHUB_OWNER, GITHUB_REPO);
  if (!auth.ok) return jsonResponse({ error: auth.reason }, auth.status);

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'pending';
  if (status !== 'pending') {
    return jsonResponse({ error: 'Só o status "pending" é suportado hoje.' }, 400);
  }

  const list = await env.COMMENTS_KV.list({ prefix: 'pending:' });
  const items: PendingCommentListItem[] = [];

  for (const entry of list.keys) {
    const raw = await env.COMMENTS_KV.get(entry.name);
    if (!raw) continue; // apagado entre o list() e o get() (aprovado/rejeitado em paralelo) -- ignora, não é erro.
    try {
      const parsed = JSON.parse(raw) as PendingComment;
      items.push({ key: entry.name, id: parsed.id, slug: parsed.slug, name: parsed.name, text: parsed.text, createdAt: parsed.createdAt });
    } catch {
      continue; // entrada corrompida no KV -- não derruba a listagem inteira, só pula essa.
    }
  }

  // Mais recente primeiro -- `createdAt` é ISO 8601, ordena lexicograficamente igual a Date.
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return jsonResponse({ comments: items });
}

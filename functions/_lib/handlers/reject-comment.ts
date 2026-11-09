import type { Env } from '../env.js';
import { extractBearerToken, verifyAdminToken } from '../auth.js';
import { GITHUB_OWNER, GITHUB_REPO } from '../github-repo.js';
import { parsePendingKey } from '../kv-keys.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * `POST /api/admin/comments/:id/reject` -- só remove a entrada do KV,
 * nada mais (nenhum commit, nenhum arquivo criado). Idempotente de
 * propósito: rejeitar um id que já não existe (já foi rejeitado/aprovado
 * antes, ou nunca existiu) devolve 204 igual, nunca 404 -- do ponto de
 * vista de quem rejeita, "não está mais pendente" é sempre sucesso.
 */
export async function handleRejectComment(request: Request, env: Env, rawId: string): Promise<Response> {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token) return jsonResponse({ error: 'Token de autorização ausente.' }, 401);

  const auth = await verifyAdminToken(token, GITHUB_OWNER, GITHUB_REPO);
  if (!auth.ok) return jsonResponse({ error: auth.reason }, auth.status);

  let key: string;
  try {
    key = decodeURIComponent(rawId);
  } catch {
    return jsonResponse({ error: 'Id inválido.' }, 400);
  }

  if (!parsePendingKey(key)) {
    return jsonResponse({ error: 'Id inválido -- não é uma chave de comentário pendente.' }, 400);
  }

  await env.COMMENTS_KV.delete(key);
  return new Response(null, { status: 204 });
}

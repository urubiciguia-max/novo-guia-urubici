import type { Env } from '../env.js';
import { extractBearerToken, verifyAdminToken } from '../auth.js';
import { GitHubApiError, GitHubCommentsClient, ShaConflictError } from '../github-comments-client.js';
import { GITHUB_OWNER, GITHUB_REPO } from '../github-repo.js';
import { parsePendingKey } from '../kv-keys.js';
import type { PendingComment } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * `POST /api/admin/comments/:id/approve` -- `:id` é a key do KV
 * (`pending:<slug>:<id>`), url-encoded pelo caller. Faz o append em
 * `src/content/comments/<slug>.json` via GitHub Contents API e só então
 * remove do KV -- nessa ordem de propósito: se o commit no GitHub falhar,
 * o comentário continua pendente (nunca perdemos uma aprovação por um
 * erro de rede no meio do caminho).
 */
export async function handleApproveComment(request: Request, env: Env, rawId: string): Promise<Response> {
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

  const parsedKey = parsePendingKey(key);
  if (!parsedKey) {
    return jsonResponse({ error: 'Id inválido -- não é uma chave de comentário pendente.' }, 400);
  }

  const raw = await env.COMMENTS_KV.get(key);
  if (!raw) {
    return jsonResponse({ error: 'Comentário pendente não encontrado (talvez já tenha sido moderado por outra aba).' }, 404);
  }

  let pending: PendingComment;
  try {
    pending = JSON.parse(raw) as PendingComment;
  } catch {
    return jsonResponse({ error: 'Comentário pendente corrompido no KV -- remova manualmente e avise o Jurandir.' }, 500);
  }

  if (pending.slug !== parsedKey.slug) {
    // Nunca deveria acontecer (quem grava a key é o próprio `submit-comment.ts`, sempre coerente) -- defesa contra dado inconsistente.
    return jsonResponse({ error: 'Inconsistência entre a chave do KV e o slug gravado -- nada foi alterado.' }, 500);
  }

  // Token usado aqui é o MESMO do header Authorization -- o do Moises, nunca um token bot fixo (ver auth.ts).
  const client = new GitHubCommentsClient({ token, owner: GITHUB_OWNER, repo: GITHUB_REPO });

  try {
    const result = await client.appendComment(pending.slug, {
      name: pending.name,
      text: pending.text,
      date: pending.createdAt,
    });
    await env.COMMENTS_KV.delete(key);
    return jsonResponse({ ok: true, slug: pending.slug, commitSha: result.commitSha });
  } catch (err) {
    if (err instanceof ShaConflictError) {
      return jsonResponse({ error: err.message }, 409);
    }
    if (err instanceof GitHubApiError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      return jsonResponse({ error: err.message }, status);
    }
    return jsonResponse({ error: 'Erro inesperado ao aprovar o comentário.' }, 500);
  }
}

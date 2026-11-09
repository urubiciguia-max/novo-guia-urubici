/**
 * Convenção de chaves do `COMMENTS_KV` -- centralizada aqui pra
 * `submit-comment.ts` (escreve), `list-pending.ts` (lista) e
 * `approve-comment.ts`/`reject-comment.ts` (leem/apagam) nunca divergirem
 * sobre o formato.
 */
export const PENDING_PREFIX = 'pending:';
export const RATE_LIMIT_PREFIX = 'ratelimit:';

export function buildPendingKey(slug: string, id: string): string {
  return `${PENDING_PREFIX}${slug}:${id}`;
}

/**
 * Quebra `pending:<slug>:<id>` de volta em `{ slug, id }`. `slug` é
 * kebab-case estrito (nunca contém `:`, ver `SLUG_PATTERN`), então separar
 * pelo PRIMEIRO `:` depois do prefixo é suficiente mesmo que `id` algum
 * dia venha a conter `:` (não é o caso hoje -- `generatePendingId` só usa
 * base36 -- mas não custa a garantia).
 */
export function parsePendingKey(key: string): { slug: string; id: string } | null {
  if (!key.startsWith(PENDING_PREFIX)) return null;
  const rest = key.slice(PENDING_PREFIX.length);
  const firstColon = rest.indexOf(':');
  if (firstColon === -1) return null;
  const slug = rest.slice(0, firstColon);
  const id = rest.slice(firstColon + 1);
  if (!slug || !id) return null;
  return { slug, id };
}

export function buildRateLimitKey(ipHash: string): string {
  return `${RATE_LIMIT_PREFIX}${ipHash}`;
}

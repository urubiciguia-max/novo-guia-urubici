/** Valor gravado no KV em `pending:<slug>:<id>` -- ver `kv-keys.ts`. */
export interface PendingComment {
  id: string;
  slug: string;
  name: string;
  text: string;
  /** ISO 8601 (`new Date().toISOString()`). */
  createdAt: string;
  /** SHA-256 hex do IP -- NUNCA o IP cru (ver `hash.ts`). */
  ip: string;
}

/**
 * Mesmo shape do schema zod da collection `comments` em
 * `src/content/config.ts` -- um array destes é o conteúdo de
 * `src/content/comments/<slug>.json`.
 */
export interface ApprovedComment {
  name: string;
  text: string;
  /** ISO 8601. */
  date: string;
}

/** Item devolvido por `GET /api/admin/comments` -- mesmo `PendingComment` sem o `ip` (a UI de moderação não precisa disso) e com a `key` do KV (pra montar `:id` de approve/reject). */
export type PendingCommentListItem = Omit<PendingComment, 'ip'> & { key: string };

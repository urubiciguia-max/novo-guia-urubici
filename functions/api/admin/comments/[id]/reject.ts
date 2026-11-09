import type { Env } from '../../../../_lib/env.js';
import { handleRejectComment } from '../../../../_lib/handlers/reject-comment.js';

/** Rota: `POST /api/admin/comments/:id/reject` -- `:id` é a key do KV, url-encoded. Ver `handleRejectComment`. */
export const onRequestPost: PagesFunction<Env> = (context) =>
  handleRejectComment(context.request, context.env, String(context.params.id));

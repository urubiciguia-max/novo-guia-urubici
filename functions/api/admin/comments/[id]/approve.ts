import type { Env } from '../../../../_lib/env.js';
import { handleApproveComment } from '../../../../_lib/handlers/approve-comment.js';

/** Rota: `POST /api/admin/comments/:id/approve` -- `:id` é a key do KV, url-encoded. Ver `handleApproveComment`. */
export const onRequestPost: PagesFunction<Env> = (context) =>
  handleApproveComment(context.request, context.env, String(context.params.id));

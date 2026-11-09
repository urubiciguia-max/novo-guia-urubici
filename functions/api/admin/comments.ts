import type { Env } from '../../_lib/env.js';
import { handleListPendingComments } from '../../_lib/handlers/list-pending.js';

/** Rota: `GET /api/admin/comments?status=pending` -- exige `Authorization: Bearer <token>`. Ver `handleListPendingComments`. */
export const onRequestGet: PagesFunction<Env> = (context) => handleListPendingComments(context.request, context.env);

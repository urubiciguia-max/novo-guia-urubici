import type { Env } from '../_lib/env.js';
import { handleSubmitComment } from '../_lib/handlers/submit-comment.js';

/** Rota: `POST /api/comments` -- PÚBLICO, sem auth. Ver `handleSubmitComment` pra toda a lógica real. */
export const onRequestPost: PagesFunction<Env> = (context) => handleSubmitComment(context.request, context.env);

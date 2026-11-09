import { z } from 'zod';
import { SLUG_PATTERN } from './slug.js';

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const TEXT_MIN = 10;
export const TEXT_MAX = 2000;

/**
 * Valida os campos de NEGÓCIO da submissão (slug/name/text). `consent` e
 * `honeypot` são checados ANTES disso, em `submit-comment.ts`, fora do
 * zod -- têm semântica de "presença"/"silêncio" (checkbox marcado? campo
 * preenchido por um bot?), não de forma de string, então não fazem
 * sentido misturados neste schema.
 */
export const commentSubmissionSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(SLUG_PATTERN, 'slug inválido -- só minúsculas, números e hífen'),
  name: z.string().trim().min(NAME_MIN, `nome precisa ter pelo menos ${NAME_MIN} caracteres`).max(NAME_MAX),
  text: z.string().trim().min(TEXT_MIN, `comentário precisa ter pelo menos ${TEXT_MIN} caracteres`).max(TEXT_MAX),
});

export type CommentSubmissionInput = z.infer<typeof commentSubmissionSchema>;

export interface SubmissionValidationResult {
  ok: boolean;
  data?: CommentSubmissionInput;
}

export function validateSubmissionFields(raw: { slug: unknown; name: unknown; text: unknown }): SubmissionValidationResult {
  const parsed = commentSubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, data: parsed.data };
}

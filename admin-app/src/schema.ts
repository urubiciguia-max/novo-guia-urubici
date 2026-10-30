import { z } from 'zod';
import { AFFILIATE_PROVIDERS, CATEGORIES } from './types.js';

/** "YYYY-MM-DD" -- mesmo formato que `date_format` grava em public/admin/config.yml. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kebab-case estrito -- só minúsculas, números e hífen. Usado em dois
 * lugares que PRECISAM ficar em sync (daí virar constante compartilhada em
 * vez de duas regex literais que podem divergir):
 *  - aqui, pra validar o campo `legacySlug` do frontmatter;
 *  - `github-client.ts`, pra validar o parâmetro `slug` que vira nome de
 *    arquivo/caminho na Contents API (`getPost`/`createPost`/`updatePost`/
 *    `deletePost`) -- essa segunda validação é a que de fato bloqueia path
 *    traversal (`../`, `/`), porque é a camada de dados, não a UI (ver
 *    auditoria do Severino em `.agents/inbox/marivone.md`).
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const dateString = z
  .string()
  .regex(DATE_RE, 'Data precisa estar no formato YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Data inválida');

/**
 * Espelha `src/content/config.ts` (fonte de verdade). Diferenças
 * deliberadas -- ver comentário em `types.ts`:
 *  - `cover`: `z.string().optional()` em vez de `image()` (helper de build
 *    do Astro, não existe nesse contexto).
 *  - `pubDate`/`updatedDate`: string validada por regex em vez de
 *    `z.coerce.date()`, pra não virar `Date` nativo e reformatar na hora
 *    de serializar de volta pro YAML.
 */
export const postFrontmatterSchema = z.object({
  title: z.string().min(1).max(90),
  description: z.string().min(1).max(160),
  pubDate: dateString,
  updatedDate: dateString.optional(),
  tags: z.array(z.string()).default([]),
  cover: z.string().optional(),
  coverAlt: z.string().optional(),
  draft: z.boolean().default(false),
  author: z.string().default('Equipe Guia de Urubici'),
  category: z.enum(CATEGORIES),
  faq: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
      })
    )
    .optional(),
  affiliates: z
    .array(
      z.object({
        label: z.string().min(1),
        url: z.url(),
        provider: z.enum(AFFILIATE_PROVIDERS),
      })
    )
    .optional(),
  relatedSlugs: z.array(z.string()).optional(),
  // Obrigatório mesmo quando igual ao slug novo -- ver nota em config.ts.
  // Pattern alinhado com o `pattern` do widget em config.yml (kebab-case).
  legacySlug: z
    .string()
    .min(1)
    .regex(SLUG_PATTERN, 'Só minúsculas, números e hífen (kebab-case), sem espaço ou acento'),
});

export type ValidatedPostFrontmatter = z.infer<typeof postFrontmatterSchema>;

/** Formata os `issues` do Zod no shape simples que `ValidationError` espera. */
export function zodIssuesToErrors(issues: z.core.$ZodIssue[]): { path: string; message: string }[] {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

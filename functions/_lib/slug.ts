/**
 * Kebab-case estrito -- mesma regra que `admin-app/src/schema.ts`
 * (`SLUG_PATTERN`) já usa pra validar `legacySlug`/nome de arquivo.
 *
 * Duplicada aqui de propósito, não importada de `admin-app/`: são dois
 * pacotes npm separados -- o build das Cloudflare Pages Functions só
 * instala as dependências do `package.json` da RAIZ do repo (é lá que o
 * Cloudflare roda `npm install` antes do build), não enxerga
 * `admin-app/node_modules` nem o `tsconfig`/toolchain de lá. Import
 * cross-package entre as duas pastas quebraria o build de produção.
 * Decisão documentada no relatório do Jurandir (2026-11-09) -- se o padrão
 * algum dia divergir, os dois lugares precisam ser atualizados juntos.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Mesma defesa contra path traversal (`../`, `/`) que `github-client.ts` já documenta -- aqui é o que protege o path que montamos pra Contents API (`src/content/comments/<slug>.json`). */
export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= 200 && SLUG_PATTERN.test(slug);
}

/**
 * Slugs reservados pelas 4 hub pages de categoria (guia-pratico.astro,
 * o-que-fazer.astro, onde-comer-urubici.astro, onde-ficar.astro).
 *
 * Por decisao de produto, cada silo pode ter exatamente 1 post publicado e,
 * quando isso acontece, a URL do silo passa a renderizar o artigo INTEIRO
 * direto (ver src/components/PostArticle.astro) -- SEM precisar de uma
 * segunda rota pro post. Isso significa que um post nunca deve usar um
 * desses 4 slugs como `legacySlug`/nome de arquivo em src/content/posts/,
 * senao colide com a rota estatica do hub.
 *
 * `src/pages/[...slug].astro` (catch-all de post individual) IMPORTA esta
 * lista e EXCLUI esses slugs do `getStaticPaths()` -- e a causa raiz do bug
 * original: o Astro prioriza rota estatica sobre `[...slug]` SEM avisar
 * nada quando os slugs colidem, so sobrescreve o arquivo no disco em
 * silencio (confirmado rodando `npm run build` e inspecionando `dist/`).
 *
 * Lista fica so AQUI (fonte unica) -- se adicionar um 5o hub de categoria
 * no futuro, atualiza este array e nada mais precisa mudar em
 * `[...slug].astro`.
 */
export const RESERVED_HUB_SLUGS = [
  'o-que-fazer',
  'guia-pratico',
  'onde-comer-urubici',
  'onde-ficar',
] as const;

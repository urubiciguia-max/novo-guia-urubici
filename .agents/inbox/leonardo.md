# Handoff Francisgleydisson → Leonardo

**Data:** 2026-10-29
**Branch/worktree:** `feat/migracao-fase0-1` (worktree em `../Guia Urubici-feat-migracao-fase0-1`)
**Commit:** `ae461db` — feat: schema de migracao WP + templates/paginas da Fase 0 e 1

## O que foi feito
Fase 0 (schema) + Fase 1 (templates/componentes) da migração do WordPress
antigo (guiadeurubici.com.br), conforme spec do Carlito/Genilson. Isso
substitui/complementa o handoff anterior (scaffold da home).

### Fase 0 — schema
`src/content/config.ts` ganhou: `author` (default "Equipe Guia de Urubici"),
`category` (enum fechado: Geral/Guia Prático/O Que Fazer/Onde Comer), `faq`,
`affiliates` (com `provider` tipado), `relatedSlugs`, `legacySlug`
(obrigatório). 4 posts de exemplo em `src/content/posts/` cobrindo todos os
campos (FAQ, afiliados de providers diferentes, relacionados, tag
`onde-ficar`).

### Fase 1 — rotas (slug plano na raiz, igual ao WP antigo)
- `src/pages/[...slug].astro` — catch-all de post (AuthorBox, Breadcrumb,
  conteúdo, AffiliateBox por afiliado, FAQAccordion, RelatedPosts, JSON-LD
  Article/FAQPage/BreadcrumbList)
- `src/pages/{sobre-nos,contato,links,termos-de-uso,politica-de-privacidade}.astro`
  — institucionais, via `src/layouts/PageLayout.astro` novo
- `src/pages/{guia-pratico,o-que-fazer,onde-comer-urubici,onde-ficar}.astro`
  — hub pages (3 primeiras filtram por `category`, `onde-ficar` filtra por
  `tag` porque não é categoria real do WP)

### Componentes novos
`Breadcrumb.astro`, `AuthorBox.astro`, `FAQAccordion.astro` (details/summary
nativo, zero JS), `RelatedPosts.astro` (reusa `PostCard`), `AffiliateBox.astro`
(estende `AffiliateButton` com ícone/cor por provider).

### Navegação global atualizada
Header/CategoryNav/Footer apontavam pra rotas que nunca existiram
(`/roteiros`, `/sobre-a-cidade`, `/pra-levar`, `/negocios-locais`) — troquei
pelos links reais que criei agora. Footer ganhou uma 4ª coluna
"Institucional" (contato, termos, privacidade).

### `public/og-default.jpg`
Gerei um placeholder de marca (gradiente navy→green dos tokens + wordmark
"Guia Urubici"), 1200×630, 40KB — NÃO é foto real (não existe nenhuma foto
real no projeto ainda). Troque assim que tiver uma imagem de hero/cachoeira
de verdade.

## Validado
- `npm run build` limpo — 14 páginas, rotas batendo com slug plano
  (`/sobre-nos/index.html`, `/cachoeiras-secretas-urubici/index.html` etc,
  sem colisão estática×dinâmica)
- `npm run check` — 0 erros/0 warnings
- Zero `.js` no `dist/`
- 1 único `<h1>` em todas as 14 páginas
- Todo link externo pra booking/rentcars/amazon/mercadolivre com
  `rel="sponsored noopener noreferrer" target="_blank"` (verifiquei via grep
  no HTML gerado)
- `og:image` presente e com URL absoluta em todas as páginas
- JSON-LD Article/FAQPage/BreadcrumbList/Organization renderizando certo
  (conferi via grep no HTML gerado)

## O que NÃO consegui validar
**Teste visual em 375px** — a extensão do Claude in Chrome não conectou
neste ambiente (`Browser extension is not connected`), então não rodei o
passo visual mobile que é obrigatório no meu fluxo. Fiz uma checagem
estática (sem larguras fixas fora de `max-width`/`container` nos
componentes novos, tudo grid `1fr` → `@media (min-width: 860px)`, mesmo
padrão já usado no resto do site), mas não é substituto de ver renderizado.
Pede pra Marivone (ou você mesmo) rodar o device/axe-core real nisso antes
de ir pro ar.

## Pra você polir
1. **Fotos reais continuam zero** — post, hub pages e `og-default.jpg` ainda
   são gradiente/placeholder. Prioridade quando tiver imagem.
2. **FAQAccordion** — fiz o `+` girando 45° no `[open]`, sem spring/easing
   fino. Terreno seu.
3. **AffiliateBox** — ícone por provider é emoji simples (📦🏨🚗🛍️🔗), pode
   ficar mais bonito.
4. **AuthorBox** — avatar é só iniciais num círculo navy, sem foto.
5. **Hub pages** (`guia-pratico`, `o-que-fazer`, `onde-comer-urubici`,
   `onde-ficar`) hoje não têm paginação — decisão deliberada (ver comentário
   no topo de cada arquivo): volume de conteúdo é baixo (migração de 37
   posts do WP), pedir pra adicionar Astro `paginate()` (zero JS) quando o
   volume justificar, na Fase 4.
6. **Contato** (`src/pages/contato.astro`) não tem formulário — só
   `mailto:`, porque não existe endpoint de backend pra receber submissão
   (isso é território do Jurandir). Se quiserem form de verdade, alinhar
   com ele antes.

## Conteúdo real
Os 4 posts em `src/content/posts/` são 100% EXEMPLO (marcados como tal no
corpo), criados só pra validar o schema/template. Texto real dos 37 posts
do WP é Fase 4, feita separadamente pelo Genilson com extração cuidadosa —
não porte nada daqui achando que é conteúdo final.

## Itens herdados do handoff anterior (ainda pendentes)
- `domain` em `astro.config.mjs` continua placeholder
  (`guiaurubici.com.br`) — confirmar com Genilson/Tiao antes do deploy.
- Contraste do badge `--amber` e texto sobre gradiente do Hero — ninguém
  rodou axe-core ainda, é a Marivone.

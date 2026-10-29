# Handoff Francisgleydisson → Leonardo

**Data:** 2026-10-29
**O que foi feito:** scaffold inicial completo do site Astro SSG "Guia Urubici" (zero posts reais ainda, home montada com conteudo de exemplo pra validar o design system).

## Estrutura entregue
- `astro.config.mjs` (`output: 'static'`, `@astrojs/sitemap`)
- `src/layouts/Layout.astro` — meta tags, canonical, OG/Twitter Card, fontes @fontsource auto-hospedadas, slot `schema`
- `src/components/schema/*.astro` — Organization, Article, FAQPage, Product, Review, BreadcrumbList (JSON-LD)
- `src/components/` — Header (menu mobile via `<details>/<summary>`, zero JS), DisclosureStrip, Hero, CategoryNav, PostCard, StayCard, GearCard, HighlightCard, AffiliateButton, Newsletter, Footer
- `src/content/config.ts` + `src/content/posts/placeholder-roteiro-cachoeiras-urubici.md` (draft) — scaffold da collection
- `src/styles/tokens.css` — tokens de cor/tipografia/radius exatamente como no brief
- `src/pages/index.astro` — home completa com as 11 seções do mockup

## Validado
- `npm run build` limpo, `npm run check` (astro check) 0 erros/0 warnings
- 1 único `<h1>` na home (visually-hidden, hierarquia h2→h3 ok)
- Zero JS gerado no build (`find dist -name "*.js"` vazio) — menu mobile é 100% CSS
- 14/14 links de afiliado com `rel="sponsored noopener noreferrer" target="_blank"`
- OG/Twitter com URL absoluta, JSON-LD Organization presente

## O que falta pro seu polish
1. **Fotos reais** — tudo hoje é `placeholder-gradient` (hero, post cards, stay cards). Quando tiver fotos do Urubici, troca pelos `<Image />` do astro:assets.
2. **`public/og-default.jpg` NÃO existe ainda** — não tem nenhuma foto real no projeto pra cropar 1200×630 (regra de design system pede imagem real, não cinza). Isso trava o `og:image` de qualquer página sem imagem própria até alguém (image-fetcher ou vocês) trazer uma foto representativa da serra/cachoeira. Avisei o Genilson disso no chat.
3. **Microinterações finas** — fiz hover de card (`translateY(-4px)` + shadow) e `link-under` conforme o brief, mas não entrei em detalhe de easing/spring, states de loading do form de newsletter, etc. Isso é terreno seu.
4. **Checar contraste** do badge `--amber` sobre fundo claro e do texto sobre o gradiente do Hero em telas muito claras — passei no olho, não rodei axe-core (isso é Marivone).
5. **`domain` em `astro.config.mjs`** está um placeholder (`guiaurubici.com.br`) — confirmar com Genilson/Tiao antes do deploy, afeta canonical/OG/sitemap.

## Páginas internas
Os links do Header/CategoryNav/Footer apontam pra rotas que ainda não existem (`/roteiros`, `/onde-ficar`, etc.) — isso é esperado, é só scaffold da home. Quem pautar essas páginas (Maria/Valdisney) decompõe depois com o Genilson.

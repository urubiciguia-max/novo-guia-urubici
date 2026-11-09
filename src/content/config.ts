import { defineCollection, z } from 'astro:content';

/**
 * Collection de posts do blog "Guia Urubici".
 *
 * Migracao do WordPress antigo (guiadeurubici.com.br): o site antigo usa
 * slugs planos na raiz (ex: /cachoeiras-secretas-urubici/), sem prefixo de
 * categoria — o site novo mantem a MESMA convencao (ver src/pages/[...slug].astro)
 * pra nao perder equity de SEO/URL quando o dominio trocar. `legacySlug`
 * registra a URL antiga pra fins historicos/auditoria, mesmo quando igual
 * ao slug novo.
 *
 * `category` e um enum fechado — as 4 categorias reais do WP (ver spec do
 * Carlito). `guia-pratico.astro` e `o-que-fazer.astro` filtram por
 * `category`; `onde-ficar.astro` NAO e uma categoria real do WP, filtra por
 * `tags` (ver nota no componente da pagina).
 *
 * `cover` usa o helper `image()` do Astro pra ganhar otimizacao automatica
 * (resize/AVIF/WebP) via <Image /> quando houver fotos reais. Enquanto nao
 * houver, deixe o campo de fora do frontmatter — e opcional.
 */
const posts = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      title: z.string().max(90),
      description: z.string().max(160),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      coverCredit: z.string().optional(),
      draft: z.boolean().default(false),
      author: z.string().default('Equipe Guia de Urubici'),
      category: z.enum(['Geral', 'Guia Prático', 'O Que Fazer', 'Onde Comer']),
      faq: z
        .array(
          z.object({
            question: z.string(),
            answer: z.string(),
          })
        )
        .optional(),
      // Caixa verde de CTA (convite a comentar) renderizada no final do
      // artigo, logo acima do FAQ (ver src/components/CtaComentarios.astro).
      // Texto manual por post; quando ausente/vazio o componente cai pro
      // texto padrão do dono do site.
      ctaComentarios: z.string().optional(),
      affiliates: z
        .array(
          z.object({
            label: z.string(),
            url: z.string().url(),
            provider: z.enum(['amazon', 'booking', 'rentcars', 'mercadolivre', 'outro']),
          })
        )
        .optional(),
      relatedSlugs: z.array(z.string()).optional(),
      // URL antiga no WordPress (sem dominio, sem barras), ex: "cachoeiras-secretas-urubici".
      // Obrigatorio mesmo quando igual ao slug novo — e registro historico da migracao.
      legacySlug: z.string(),
    }),
});

/**
 * Collection das 4 paginas institucionais do site (sobre-nos, contato,
 * politica-de-privacidade, termos-de-uso) — ver spec do Carlito. Schema
 * minimo de proposito: so `title` (vira <title> da aba E o <h1> da pagina,
 * unificado por decisao do dono do site — nao existe mais `heading`
 * separado) + `description` (meta description). SEM pubDate/tags/category/
 * author/faq/affiliates/legacySlug — nao se aplicam a pagina institucional
 * (lista fechada, sem publicacao/categoria/SEO de blog).
 *
 * `links.astro` e as hub pages de categoria (guia-pratico, o-que-fazer,
 * onde-comer-urubici, onde-ficar) NAO entram aqui — fora de escopo desta
 * feature (ver spec).
 */
const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().max(90),
    description: z.string().max(160),
  }),
});

/**
 * Comentários APROVADOS por post -- um arquivo por slug
 * (`src/content/comments/<slug>.json`), mesmo slug do post correspondente
 * em `posts`. `type: 'data'` (JSON puro, sem corpo markdown).
 *
 * Fluxo completo (Jurandir, 2026-11-09): visitante anônimo envia comentário
 * via form HTML tradicional (`POST /api/comments`, Cloudflare Pages
 * Function) -> fica "pendente" no Cloudflare KV (`COMMENTS_KV`), NÃO
 * aparece no site -> Moises aprova/rejeita no admin-app -> aprovação faz
 * append aqui via GitHub Contents API (ver
 * `functions/_lib/github-comments-client.ts`) e remove do KV -> o commit
 * dispara o rebuild normal do Cloudflare Pages, e esta collection é lida
 * no BUILD do Astro como qualquer outra -- sem fetch em runtime, mantém a
 * filosofia 100% SSG do projeto (ver CLAUDE.md).
 *
 * SEGURANÇA pro componente que for renderizar isto (Francisgleydisson):
 * `name`/`text` são texto puro de visitante anônimo -- NUNCA usar
 * `set:html` ou qualquer coisa que trate como HTML. `{name}`/`{text}` do
 * Astro escapa por padrão, é a forma certa e única de renderizar.
 */
const comments = defineCollection({
  type: 'data',
  schema: z.array(
    z.object({
      name: z.string().min(1).max(80),
      text: z.string().min(1).max(2000),
      date: z.coerce.date(),
    })
  ),
});

export const collections = { posts, pages, comments };

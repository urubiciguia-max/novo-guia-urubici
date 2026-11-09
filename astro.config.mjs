import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkDestaque from './src/lib/remark-destaque.mjs';
import remarkAffiliateCard from './src/lib/remark-affiliate-card.mjs';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  // SSG estático puro — stack obrigatória do projeto (ver .cursorrules / CLAUDE.md).
  output: 'static',
  // Dominio final confirmado em 2026-11-09 (Genilson verificou o site antigo ao
  // vivo + usuario confirmou): guiadeurubici.com.br, SEM www (o antigo faz 301
  // de www.guiadeurubici.com.br pra guiadeurubici.com.br, e o canonical dele
  // usa sem www). "guiaurubici.com.br" (sem "de") nao existe, era erro de
  // configuracao. Usado como base para canonical e URLs absolutas de Open Graph.
  site: 'https://guiadeurubici.com.br',
  trailingSlash: 'never',
  compressHTML: true,
  integrations: [sitemap()],
  markdown: {
    // Plugins próprios (zero dependência nova) -- não substituem os plugins
    // padrão do Astro (gfm/smartypants), só são anexados à lista:
    // - remarkDestaque: blockquote com marcador `[!DICA]`/`[!ATENCAO]`/
    //   `[!IMPORTANTE]` vira a caixa de callout "Destaque" (ver
    //   src/lib/remark-destaque.mjs pra sintaxe e decisão).
    // - remarkAffiliateCard: bloco de código cercado ```affiliate-card
    //   (JSON) vira o card de afiliado com imagem + selo + CTAs (ver
    //   src/lib/remark-affiliate-card.mjs e
    //   src/components/AffiliateCard.astro).
    remarkPlugins: [remarkDestaque, remarkAffiliateCard],
  },
});

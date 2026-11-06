import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkDestaque from './src/lib/remark-destaque.mjs';
import remarkAffiliateCard from './src/lib/remark-affiliate-card.mjs';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  // SSG estático puro — stack obrigatória do projeto (ver .cursorrules / CLAUDE.md).
  output: 'static',
  // TODO: confirmar dominio final de producao com o Genilson/Tiao antes do deploy.
  // Usado como base para canonical e URLs absolutas de Open Graph.
  site: 'https://www.guiaurubici.com.br',
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

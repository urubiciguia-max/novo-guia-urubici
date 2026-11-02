import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkDestaque from './src/lib/remark-destaque.mjs';

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
    // Plugin próprio (zero dependência nova) que transforma blockquote com
    // marcador `[!DICA]`/`[!ATENCAO]`/`[!IMPORTANTE]` na caixa de callout
    // "Destaque" -- ver src/lib/remark-destaque.mjs pra sintaxe e decisão.
    // Não substitui os plugins padrão do Astro (gfm/smartypants) -- eles
    // continuam ativos, este só é anexado à lista.
    remarkPlugins: [remarkDestaque],
  },
});

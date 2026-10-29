import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

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
});

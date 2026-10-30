import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build da SPA do admin custom. Decisões de pipeline (documentadas também em
 * `admin-app/web/README.md`):
 *
 * 1. `base: '/admin/'` + `build.outDir` apontando DIRETO pra `public/admin/`
 *    (com `emptyOutDir: true`) -- a SPA SUBSTITUI o Decap CMS nessa mesma
 *    URL. `npm run build` aqui já deixa `public/admin/` pronto; o
 *    `astro build` da raiz só copia `public/` pro `dist/` final, sem
 *    precisar de nenhum passo extra. Decisão de pipeline de DEPLOY
 *    (CI, quando rodar esse build antes do astro build) é do Tião --
 *    aqui só garanto que o artefato cai no lugar certo.
 *
 * 2. Alias `@admin-data` -> `admin-app/src` (a camada de dados do
 *    Jurandir). Em vez de caminho relativo frágil (`../../../src/...`)
 *    repetido em vários arquivos. `server.fs.allow` precisa incluir esse
 *    diretório explicitamente pq ele fica FORA da raiz do projeto Vite
 *    (`admin-app/web`) -- sem isso o dev server bloqueia a leitura por
 *    segurança (fora do "workspace" detectado).
 */
const adminAppRoot = fileURLToPath(new URL('..', import.meta.url));
const adminDataDir = fileURLToPath(new URL('../src', import.meta.url));

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  resolve: {
    alias: {
      '@admin-data': adminDataDir,
    },
  },
  server: {
    fs: {
      allow: [adminAppRoot],
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../../public/admin', import.meta.url)),
    emptyOutDir: true,
  },
});

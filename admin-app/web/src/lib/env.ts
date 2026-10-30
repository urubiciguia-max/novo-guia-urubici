/**
 * Config não-secreta do admin (owner/repo/branch/worker/site). Nenhum valor
 * aqui é segredo -- são os mesmos que já estavam em `public/admin/config.yml`
 * (que esta SPA substitui). Os defaults cobrem produção direto; as env vars
 * `VITE_*` (ver `.env.example`) só existem pra quem quiser apontar pra outro
 * repo/worker em dev local.
 */
export const GH_OWNER = import.meta.env.VITE_GH_OWNER || 'urubiciguia-max';
export const GH_REPO = import.meta.env.VITE_GH_REPO || 'novo-guia-urubici';
export const GH_BRANCH = import.meta.env.VITE_GH_BRANCH || 'main';

/** Mesmo valor que estava em `base_url` do config.yml do Decap. */
export const OAUTH_WORKER_BASE_URL =
  import.meta.env.VITE_OAUTH_WORKER_BASE_URL || 'https://guia-urubici-cms-oauth.urubiciguia.workers.dev';

/** Precisa estar na allowlist fixa de `sanitizeScope()` em `oauth-worker/src/index.ts`. */
export const OAUTH_SCOPE = import.meta.env.VITE_OAUTH_SCOPE || 'public_repo';

/**
 * TODO (mesmo TODO já documentado em `astro.config.mjs` e `config.yml`):
 * confirmar domínio final de produção com o Genilson/Tião. Enquanto isso,
 * usa o domínio padrão do Cloudflare Pages (mesmo valor que `site_url` do
 * Decap).
 */
export const SITE_URL = import.meta.env.VITE_SITE_URL || 'https://novo-guia-urubici.pages.dev';

/** Liga o client mock -- só tem efeito em dev (ver `lib/mockClient.ts`). */
export const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1';

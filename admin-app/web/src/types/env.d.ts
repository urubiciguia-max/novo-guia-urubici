/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Owner do repo no GitHub. Default em `lib/env.ts` já cobre produção. */
  readonly VITE_GH_OWNER?: string;
  /** Nome do repo no GitHub. */
  readonly VITE_GH_REPO?: string;
  /** Branch onde o client commita. Default `main`. */
  readonly VITE_GH_BRANCH?: string;
  /** Base URL do oauth-worker (sem barra final). */
  readonly VITE_OAUTH_WORKER_BASE_URL?: string;
  /** Escopo pedido no login -- precisa estar na allowlist do worker (`sanitizeScope`). */
  readonly VITE_OAUTH_SCOPE?: string;
  /** URL pública do site, pra montar o link de "preview" de um post. */
  readonly VITE_SITE_URL?: string;
  /**
   * Liga o cliente MOCK (dados fake em memória, sem rede) -- SÓ funciona em
   * dev (`import.meta.env.DEV`); em build de produção essa ramificação é
   * eliminada por dead-code elimination porque `DEV` vira `false` estático.
   * Ver `lib/mockClient.ts`.
   */
  readonly VITE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

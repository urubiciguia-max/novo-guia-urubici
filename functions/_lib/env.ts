/**
 * Shape do binding de ambiente que o Cloudflare Pages injeta nas Functions
 * em runtime. `COMMENTS_KV` é provisionado pelo Tião em paralelo (ver
 * `wrangler.toml` na raiz) -- este arquivo só declara o contrato que o
 * código espera, não cria nada.
 */
export interface Env {
  COMMENTS_KV: KVNamespace;
}

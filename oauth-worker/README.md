# guia-urubici-cms-oauth

Cloudflare Worker que implementa o provider OAuth que o Decap CMS espera do
backend `github` (`public/admin/config.yml` do site principal). Não guarda
nada, não tem banco — só troca o `code` do GitHub por um `access_token` e
entrega pro navegador via `postMessage`.

## 1. Criar o GitHub OAuth App (feito pelo dono do site, logado no GitHub.com)

Em **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**,
preencher:

| Campo | Valor |
|---|---|
| Application name | `Guia Urubici CMS` (ou qualquer nome identificável) |
| Homepage URL | `https://novo-guia-urubici.pages.dev` (ou o domínio final, se já migrado) |
| Authorization callback URL | `https://<nome-do-worker>.<subdominio>.workers.dev/callback` — **o subdomínio exato só existe depois do `wrangler deploy`** (passo 3). Primeiro deploy, pega a URL que o Wrangler imprime, cria o OAuth App com ela, depois ajusta se mudar. |

Depois de criar, o GitHub mostra o **Client ID** e permite gerar um **Client
Secret** — guarda os dois, vão pro passo 2.

## 2. Configurar os secrets do Worker

Nunca colocar essas credenciais em arquivo versionado. Setar via Wrangler
(pede confirmação interativa, não aparece no shell history):

```bash
cd oauth-worker
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

A variável `ALLOWED_ORIGINS` (não é segredo, controla pra quais origens o
token pode ser entregue via `postMessage`) já vem em `wrangler.toml` com os
domínios atuais do Pages. **Revisar antes do deploy** se o domínio final de
produção mudar (hoje `astro.config.mjs` ainda usa um `site` placeholder —
ver TODO lá).

## 3. Deploy

```bash
cd oauth-worker
npm install
npx wrangler deploy
```

O comando imprime a URL final (algo como
`https://guia-urubici-cms-oauth.<conta>.workers.dev`). Essa URL vai em dois
lugares:

1. **Authorization callback URL** do OAuth App (passo 1) — sempre
   `<url>/callback`.
2. **`base_url`** em `public/admin/config.yml` (hoje é o placeholder
   `https://SUBSTITUIR-worker-oauth.workers.dev`) — trocar pela URL real.

## 4. Testar localmente (sem credenciais reais)

```bash
cd oauth-worker
npm install
npm run typecheck     # type-check isolado (sem precisar das secrets)
npx wrangler dev       # roda local; /auth e /callback funcionam de verdade
                       # SE as env vars GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET
                       # estiverem num .dev.vars local (nao versionado)
```

Pra rodar `wrangler dev` com credenciais reais localmente, criar um arquivo
`.dev.vars` (já ignorado pelo `.gitignore` do projeto, padrão `.env*`) com:

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

## Rotas

- `GET /auth` — inicia o fluxo, redireciona pro GitHub (`state` em cookie
  HttpOnly, TTL 10min).
- `GET /callback` — recebido do GitHub, troca `code` por `access_token`,
  devolve uma página HTML que faz o handshake de `postMessage` com a janela
  que abriu o popup (o `/admin` do site) e só entrega o token depois de
  validar a origem contra `ALLOWED_ORIGINS`.

## Segurança — pontos que o Severino deve revisar antes de produção

- `client_secret` só é usado no POST server-to-server pro GitHub
  (`src/index.ts`), nunca retorna pro browser, nunca é logado.
- `state` em cookie `HttpOnly; Secure; SameSite=Lax`, escopado a `/callback`,
  checado contra a query string antes de qualquer troca de token (CSRF).
- O token final só é enviado por `postMessage` pra uma origem que bate com a
  allowlist `ALLOWED_ORIGINS` (exata ou `*.dominio` por sufixo) — não usa
  `postMessage(..., '*')` no payload com o token, só no handshake inicial
  (que não carrega segredo).
- Nenhuma rota loga `code`, `state` ou `access_token`.

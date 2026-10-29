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

### Auditoria do Severino (2026-10-29) — "Severino liberou. Sem P0."

Revisão estática (sem deploy, sem OAuth App criado ainda). Nenhum achado
crítico ou que bloqueie o deploy. Aplicado direto no código (worktree
`feat/cms-decap`, ainda não mergeada):

| Severidade | Achado | Status |
|---|---|---|
| Médio | `/auth` repassava o `scope` da query string pro GitHub sem filtro. É protocolo válido do Decap (`backend.scope`), mas como `/auth` é público e sem auth, um link malicioso tipo `.../auth?scope=delete_repo,admin:org` seria repassado verbatim. Adicionado `sanitizeScope()` com allowlist fixa (`repo`, `public_repo`, `user`, `read:user`) — mantém compatível com o default do Decap (`repo,user`), bloqueia escalonamento. | Corrigido |
| Baixo | Respostas HTML (principalmente `/callback` de sucesso, que carrega o `access_token` no corpo) não tinham `Cache-Control: no-store`. | Corrigido — header aplicado em todas as respostas via `SECURITY_HEADERS` |
| Baixo | `JSON.stringify` embutido direto em `<script>` não escapa `</script>`; hoje o único dado variável vem do GitHub (não do usuário), mas sem *output encoding* explícito. | Corrigido — `safeJsonForScript()` escapa `<` |
| Baixo | Nenhum header anti-clickjacking nas páginas do Worker. | Corrigido — `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` + `X-Content-Type-Options: nosniff` |
| Baixo / aceito | Sem rate limiting próprio em `/auth`/`/callback`. Pior caso é consumo de quota do Worker (free tier do Cloudflare já limita por conta); nenhuma rota cara é exposta sem validação antes de chamar o GitHub. Aceitável para o escopo atual — revisar se abuso real aparecer. | Documentado, não bloqueia |
| Informativo | `public/admin/index.html` carrega `decap-cms@^3.0.0` via unpkg (range semver, sem SRI) — é o padrão oficial de "sem build step" do próprio Decap, mas significa que o bundle pode mudar de versão sem aviso. Recomendação pro Jurandir/Genilson: considerar pinar versão exata quando estabilizar. | Documentado, fora do escopo do Worker |
| Positivo | `state` em cookie HttpOnly+Secure+SameSite=Lax, de uso único — mais robusto que boa parte dos providers de referência da comunidade (muitos não usam cookie, só o round-trip pelo popup). Validação de origem do `postMessage` final está correta (usa `e.origin` já validado, nunca `*`, e o `*` do handshake inicial não carrega segredo). `redirect_uri` é fixo (`${url.origin}/callback`), sem parâmetro aceito do cliente — sem open redirect. Zero dependências de runtime no Worker (só `fetch`/`crypto`/`URL` nativos) — zero superfície de supply chain no artefato deployado. | — |

**Pendência operacional (não é bug, é TODO de deploy já marcado pelo Jurandir):**
domínio final ainda não decidido (`astro.config.mjs` tem `site` placeholder,
`wrangler.toml` já aponta pro domínio do Pages atual) — confirmar
`ALLOWED_ORIGINS` e `base_url` do `config.yml` quando o domínio de produção
fechar, antes do deploy real.

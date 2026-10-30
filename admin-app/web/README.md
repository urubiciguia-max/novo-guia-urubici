# Admin CMS custom -- Guia Urubici (SPA)

SPA client-side que substitui o Decap CMS em `/admin` por uma interface com
identidade própria. Fala **direto com a API do GitHub** via
`admin-app/src` (camada de dados do Jurandir) e com o `oauth-worker/`
(login) -- zero servidor próprio, zero banco de dados. Arquitetura 100%
estática, igual ao resto do projeto.

## Stack / decisões de pipeline

- **Vite 6 + React 19 + TypeScript**, sem roteador externo (hash router
  próprio, ver `src/lib/useHashRoute.ts`) e sem Tailwind -- CSS puro com
  design tokens via custom properties (`src/styles/index.css`), mesma
  filosofia de `src/styles/tokens.css` do site principal. Motivo de não usar
  Tailwind: o site principal já não usa, evita adicionar uma segunda
  convenção de styling ao projeto; identidade visual do admin é própria
  (roxo) então os tokens são novos, não herdados do site.
- **Build aponta direto pra `public/admin/`**
  (`vite.config.ts` -> `build.outDir` + `base: '/admin/'`, `emptyOutDir: true`).
  `npm run build` aqui já deixa `public/admin/` pronto pro `astro build` da
  raiz só copiar. **Isso significa que `public/admin/` agora é artefato
  GERADO, não deve ser editado à mão** -- qualquer mudança visual/funcional
  é em `admin-app/web/src`, depois `npm run build`.
- **Rotas em hash** (`#/dashboard`, `#/posts`, `#/posts/novo`,
  `#/posts/:slug/editar`) em vez de path routing. Motivo: `/admin/` é
  servido como arquivo estático puro -- path routing exigiria uma regra de
  rewrite no Cloudflare Pages (decisão/config do Tião, não feita ainda).
  Hash routing funciona em qualquer hospedagem estática sem config de
  servidor nenhuma. Trocar pra path routing depois é mudança isolada em
  `src/lib/useHashRoute.ts`.
- **Alias `@admin-data`** (`vite.config.ts` + `tsconfig.json` `paths`) aponta
  pra `admin-app/src` (a camada de dados do Jurandir) -- importado direto
  via `.js` extension imports (estilo NodeNext que o `admin-app/src` usa),
  Vite/esbuild resolvem isso nativamente pra `.ts`. **`admin-app/web` não
  duplica nenhum tipo/lógica de dados, só consome.**
- **`admin-app/web` é excluído do `tsconfig.json`/`astro check` da raiz**
  (ver comentário lá) -- é um toolchain diferente (JSX automático do React,
  alias próprio) incompatível com o `jsx: "preserve"` do Astro. Tem
  typecheck próprio: `npm run typecheck` aqui.

## Rodando local

```bash
cd admin-app/web
npm install
npm run dev          # http://localhost:5173/admin/
npm run typecheck
npm test              # vitest + @testing-library/react (jsdom)
npm run build          # gera public/admin/ de verdade
```

### Testando sem token real do GitHub (client mock)

Sem OAuth App/credenciais do GitHub configuradas nesta fase, dá pra validar
Dashboard/Artigos/Form com dados fake em memória:

```bash
VITE_MOCK=1 npm run dev
```

Isso troca o `GitHubPostsClient` real por um mock (`src/lib/mockClient.ts`,
dados de exemplo incluindo um post com frontmatter inválido pra testar o
caminho de erro) -- só tem efeito com `npm run dev` (`import.meta.env.DEV`),
é eliminado do bundle de produção (confirmado: `grep` no bundle buildado não
acha nenhum traço do mock ou de `createMockPostsClient`).

**Login continua exigindo o fluxo real** (o mock só troca o client de dados,
não o OAuth) -- pra entrar sem completar o popup de verdade durante dev,
abra o console do navegador depois que a página carregar e rode:

```js
sessionStorage.setItem('guia-urubici-admin:gh-token', 'qualquer-coisa');
location.reload();
```

(Deliberadamente não virou um botão na UI -- um primeiro experimento meu
nesse sentido vazou a string "mock" pro bundle de produção porque o
tree-shaking do Rollup não consegue provar que uma prop vinda de Context é
sempre `undefined` em prod, só elimina condicional DIRETA tipo
`if (CONST)` no mesmo escopo do import. Documentando aqui pra quem for
mexer de novo nisso não cair na mesma pegadinha.)

## Autenticação / sessão

- Login reaproveita o `oauth-worker/` **sem nenhuma mudança nele** -- popup
  em `${OAUTH_WORKER_BASE_URL}/auth?scope=public_repo`, handshake
  `postMessage` (`src/auth/popupLogin.ts`, protocolo documentado lá e
  testado em `test/popupLogin.test.ts`). Origem validada em toda mensagem
  recebida (`event.origin === workerOrigin`) -- defesa em profundidade, o
  Worker já valida do lado dele.
- **Token em `sessionStorage`** (`src/lib/session.ts`), não `localStorage`.
  Motivo documentado no próprio arquivo: escopado à aba, morre ao fechar,
  reduz a janela de exposição a XSS sem exigir reconstruir a sessão a cada
  F5. Não neutraliza XSS enquanto a aba está aberta -- mitigação de
  superfície, não solução completa (não dá pra ter cookie HttpOnly sem
  servidor próprio, que é fora do escopo do projeto). **Severino revisa
  antes de produção**, como já sinalizado no handoff do Jurandir.
- 401 de qualquer chamada à API (`GitHubApiError.status === 401`) força
  logout automático (`AuthContext.handleUnauthorized`) e volta pra tela de
  login -- não tenta reabrir o popup sozinho (navegadores bloqueiam popup
  fora de um clique direto do usuário de qualquer forma).

## Integridade do slug (pedido explícito do Genilson)

O nome do arquivo (`slug` passado pro `createPost`/`updatePost`/
`deletePost`) é **sempre** o `legacySlug` validado pelo schema, nunca um
campo solto digitado separado:

- **Criar**: o campo `legacySlug` do form (validado com o mesmo regex do
  schema, kebab-case) É o slug usado em `createPost`.
- **Editar**: o campo `legacySlug` fica **travado** (`disabled`), com o
  valor sempre forçado a ser o `slug` da rota (nunca o que porventura esteja
  gravado -- possivelmente errado -- no frontmatter carregado). Ver
  `src/lib/postForm.ts` (`recordToFormState`) e o comentário em
  `src/pages/PostFormPage.tsx`. Isso também **autocorrige** posts legados
  com `legacySlug` inválido/vazio assim que são salvos de novo pelo form.

## Estados cobertos

- Loading / error / vazio no Dashboard e na tabela de Artigos.
- Post com `valid: false` (frontmatter quebrado): badge "Frontmatter
  inválido" na tabela + aviso no form, nunca escondido, sempre editável.
- Conflito de SHA (409, outra aba salvou por cima): diálogo "Recarregar"
  (descarta local, busca a versão nova) vs. "Sobrescrever" (salva por cima
  com o SHA mais recente).
- `PostAlreadyExistsError` (criar com slug já existente) e
  `ValidationError` (campo a campo, via `issues`) mapeados pra erro inline
  no form.
- Toda ação destrutiva (excluir post) passa por `ConfirmDialog` -- nunca
  `confirm()` nativo.

## Testes automatizados

31 testes (vitest + jsdom + Testing Library) em `test/`, focados na lógica
que não dá pra validar só lendo o código:

- `popupLogin.test.ts` -- parser do protocolo de `postMessage` (handshake,
  sucesso, erro, mensagens malformadas/de origem errada nunca lançam).
- `filterPosts.test.ts` -- busca + filtro de categoria/status (combinados).
- `markdownPreview.test.ts` -- preview escapa HTML antes de qualquer
  transformação (nunca injeta `<script>`).
- `postForm.test.ts` -- conversão `PostRecord` <-> form, incluindo
  frontmatter parcialmente inválido (não lança) e a trava do `legacySlug`
  em edição.
- `useHashRoute.test.ts` -- parsing de rota de edição.
- `ConfirmDialog.test.tsx` -- nomeia o item na descrição, foco vai pro
  botão seguro (Cancelar) ao abrir, Esc cancela e devolve o foco pro
  elemento que abriu.

## Validação manual feita nesta sessão

Rodei o dev server com `VITE_MOCK=1` e cliquei pelo fluxo completo via
Chrome (login mock temporário, revertido antes do commit -- ver seção
acima): Dashboard (números batendo com os dados mock, aviso de post
inválido), busca/filtro em Artigos, abrir um post inválido pra editar
(aviso aparece, campos pré-preenchidos defensivamente), corrigir a
categoria e salvar (post fica válido, aviso some, preview link passa a
funcionar), criar um post novo (preview ao vivo do nome do arquivo
derivado do `legacySlug`, preview de markdown), excluir com `ConfirmDialog`
(item nomeado, confirma, lista atualiza). Tudo funcionou como esperado.

**Não validado nesta sessão** (ambiente sem credenciais/infra):
- Fluxo de login real contra o `oauth-worker` com um OAuth App de verdade --
  pendência já sinalizada pelo Jurandir ("testar `listPosts()` com token
  real", risco do GraphQL + escopo `public_repo`). Continua pendente.
- Viewport real de 375px no Chrome automatizado (a ferramenta de resize da
  sessão não reduziu a janela abaixo de ~1346px neste sandbox -- limitação
  do ambiente, não do app). O CSS foi escrito mobile-first com breakpoints
  explícitos (`560px`/`640px`/`860px`/`1040px`, sidebar vira barra
  horizontal abaixo de `860px`, tabela com `overflow-x: auto`, formulário
  empilha campos). Recomendo o Leonardo ou a Marivone confirmarem
  visualmente em 375px assim que tiverem um Chrome com resize funcionando.

## Auditoria do Severino (2026-10-30) — "Severino achou. Bloqueia até ajustar." (achado corrigido antes de liberar)

Revisão de segurança antes do QA (Marivone). Escopo: sessão/token, handshake
`postMessage`, integridade do nome de arquivo (`slug`), XSS no preview de
markdown, rate limit/abuso, dependências novas, conteúdo do build
(`public/admin/`).

| Severidade | Achado | Status |
|---|---|---|
| **Crítico (P0)** | `github-client.ts` (`getPost`/`createPost`/`updatePost`/`deletePost`) usava o parâmetro `slug` **sem nenhuma validação própria** pra montar o caminho na Contents API (`${postsPath}/${slug}.md`). A defesa (`legacySlug` kebab-case) só existia na UI (`PostFormPage.tsx` passa `frontmatter.legacySlug` no create, e trava o campo em edição) — a camada de dados confiava ciegamente em quem chamasse. Confirmado explorável por dois caminhos: (1) chamar o client direto via DevTools/console, pulando o form inteiro; (2) rota `#/posts/:slug/editar` com segmento percent-encoded (`..%2F..%2F.github%2Fworkflows%2Fevil`) — passa o regex de rota `[^/]+` porque não tem `/` *literal*, e só depois do match é que `decodeURIComponent` revela o `../`, sem qualquer revalidação antes de ir pro `updatePost`/`deletePost`. Resultado prático: ler/sobrescrever/apagar **qualquer arquivo do repo** (não só `src/content/posts/`) com o token do editor — inclusive `.github/workflows/`, `oauth-worker/`, config de deploy. | **Corrigido** — adicionada `SLUG_PATTERN` compartilhada (`admin-app/src/schema.ts`, mesma regex kebab-case que já validava `legacySlug`) e `assertValidSlug()` em `github-client.ts`, chamada no início dos 4 métodos, lançando `ValidationError` antes de qualquer `fetch`. Validação agora vive na camada de dados — vale pra chamada pela UI e pra chamada direta via console. 20 testes novos em `admin-app/test/github-client.test.ts` (`../../.github/workflows/evil`, `../secrets`, `a/b`, vazio, espaço, maiúscula — pros 4 métodos). |
| Baixo / aceito | Token do GitHub em `sessionStorage` (`src/lib/session.ts`). Reduz superfície (escopado à aba, não sobrevive fechar aba) mas não neutraliza XSS enquanto a aba está aberta — documentado no próprio arquivo, trade-off já conhecido do Jurandir/Francisgleydisson. Avaliado: aceitável pro contexto (painel interno, um único editor, sem dado de terceiros em jogo, sem backend disponível pra oferecer cookie `HttpOnly`). Não é uma recomendação pra mudar sem adicionar um backend — o que está fora do escopo acordado do projeto ("zero servidor próprio"). | Aceito, documentado |
| — | `postMessage` do popup (`src/auth/popupLogin.ts`): `event.origin !== workerOrigin` é checado **antes** de processar qualquer conteúdo da mensagem — nenhum `postMessage(..., '*')` recebendo confiança, nenhuma branch que pula a checagem. Sem brecha. | Sem achado |
| — | Preview de markdown (`src/lib/markdownPreview.ts`): `escapeHtml()` roda **antes** de qualquer transformação, e as únicas tags geradas são um allowlist fixo (`h1-3`, `strong`, `em`, `p`, `a`) — `href` do link só aceita `https?://` (regex), nunca passa `javascript:`/`data:`. `dangerouslySetInnerHTML` é seguro porque o HTML é 100% construído por este parser, nunca repassa markup do usuário direto. Coberto por `markdownPreview.test.ts`. | Sem achado |
| Baixo / aceito | Sem rate limit próprio (SPA 100% client-side, zero servidor pra throttle). Mitigantes: token é fine-grained + `public_repo`, pertence a um único editor; toda chamada cara (listPosts via GraphQL, create/update/delete via REST) ainda consome a cota do próprio GitHub pro token do usuário (já tratado como `RateLimitError` no client); não há rota pública/anônima exposta — quem abusar só esgota a própria cota. Aceitável pro contexto atual (1 editor interno). | Aceito, documentado |
| — | `npm audit` em `admin-app/` e `admin-app/web/`: **0 vulnerabilidades** nos dois. Dependências novas do Leonardo (`@fontsource/inter`, `@fontsource/poppins`) são só arquivos de fonte estáticos, zero código executável. Dependências do Francisgleydisson/Jurandir (React 19, Vite 6, Zod 4, Testing Library) sem achado. | Sem achado |
| — | Conteúdo buildado (`public/admin/`, o que de fato vai pro ar): sem grep de padrão de token (`ghp_`/`github_pat_`/`gho_`/`ghs_`/`ghr_`); sem a string `mock` sobrevivendo ao bundle de produção (confirma a nota do README sobre o tree-shaking); único "segredo" potencial seria o `client_id` do OAuth App, que nem chega a passar pela SPA (fica só no `oauth-worker`). Tudo em `src/lib/env.ts` é config pública (owner/repo/branch/URL do worker/scope/site URL). | Sem achado |
| Informativo | Credencial em texto plano no `.git/config` desta worktree, sinalizada pelo Leonardo no handoff -- confirmado resolvido fora desta feature (PAT revogado, remote reconfigurado via `gh auth login`; `git config --get remote.origin.url` já não carrega token). Não é mais risco ativo, não reaberto aqui. | Resolvido (fora desta feature) |

**Testes/typecheck/build depois das correções, tudo verde:**
- `admin-app/`: `npm test` — 58/58 passando (34 antes da auditoria + 24 casos novos de path traversal, 6 slugs maliciosos × 4 métodos); `tsc --noEmit` limpo.
- `admin-app/web/`: `npm run typecheck` limpo; `npm test` — 31/31 passando (nenhum alterado, lógica de UI não mudou); `npm run build` ok (gera `public/admin/`).
- Raiz: `npx astro check` — 0 erros/0 avisos; `npx astro build` — 14 páginas, completo sem erro.

**Veredito: Severino liberou. Sem P0 pendente** (o único P0 encontrado foi corrigido nesta mesma revisão, não ficou pra trás). Os dois "aceitos" (sessionStorage, sem rate limit) são decisões de trade-off já documentadas no código, revisadas e consideradas adequadas pro contexto do projeto (painel interno, editor único, zero backend por escopo) -- não é recomendação de mudança, é confirmação de que o raciocínio existente se sustenta.

## Pipeline de build/deploy (decisão do Tião, 2026-10-30)

**Mantido manual, não automatizado no Cloudflare Pages.** `public/admin/`
continua sendo artefato **gerado e commitado** -- quem mexer em
`admin-app/web/src` ou `admin-app/src` precisa rodar, na raiz do projeto:

```bash
npm run build:admin   # instala deps de admin-app e admin-app/web, builda a SPA, gera public/admin/ e atualiza .admin-build-hash
git status            # revisa o diff gerado antes de comitar (código + public/admin/ + .admin-build-hash, tudo junto)
```

Avaliei automatizar isso no comando de build do Cloudflare Pages (buildar a
SPA antes do `astro build`, tirando `public/admin/` do git como artefato
igual `dist/`) e decidi **não** fazer isso, pelo seguinte trade-off: quem
publica conteúdo usa o próprio admin (API do GitHub), o que já dispara um
build de produção no Cloudflare Pages a cada post salvo -- muito mais
frequente do que mudança no código do admin. Automatizar o build da SPA no
pipeline do Cloudflare Pages pagaria o custo de `npm install` + typecheck +
`vite build` (React 19, Vite 6) **em todo deploy de conteúdo**, não só
quando o código do admin muda, empurrando o tempo de deploy (meta: <3min
P50) pra cima no caso mais comum pra mitigar um risco que só existe no
caso raro.

Em vez disso, o risco de "drift" (código do admin mudou, mas
`public/admin/` não foi rebuildado+commitado, e fica obsoleto em produção
silenciosamente, sem erro nenhum) é coberto por um **GitHub Action
dedicado**, que roda só quando o código do admin é tocado (path filter --
zero custo nos deploys de conteúdo do dia a dia):
`.github/workflows/admin-cms-drift-check.yml`. Ele instala, testa e
typecheck as duas camadas, rebuilda a SPA como smoke test (garante que o
build não está quebrado) e falha o PR/push se o **hash do código-fonte**
não bater com `.admin-build-hash` (gerado por
`scripts/admin-build-hash.mjs`, chamado automaticamente dentro do
`npm run build:admin`).

Note que o check **não** compara `public/admin/` byte a byte contra um
rebuild do CI -- testei isso primeiro e descartei: o build da SPA
(Vite/esbuild) não é reprodutível byte-a-byte entre ambientes diferentes
(confirmado rodando o mesmo build duas vezes neste projeto -- o JS
minificado saiu com nomes de variável e hash de arquivo diferentes, sem
nenhuma mudança de código real). Um diff byte-a-byte no CI falharia
sempre, até sem drift nenhum. Por isso o fingerprint é do *código-fonte*
(`admin-app/src` + `admin-app/web/src` + manifestos de dependência), não
do artefato gerado -- ver comentário detalhado em
`scripts/admin-build-hash.mjs`.

Se o volume de mudanças no código do admin crescer muito (ou o "esqueci
de rebuildar" acontecer com frequência mesmo com o CI avisando), vale
reconsiderar mover pro build automático do Cloudflare Pages -- nesse ponto
o trade-off de tempo de build por deploy de conteúdo pode já valer a pena.
Não é o caso agora (fase única, time pequeno).

## O que falta (fora de escopo desta fase, combinado com o Genilson)

- Upload de imagem de capa (`cover`) binária.
- Editor de `faq[]`/`affiliates[]`.
- Qualquer mudança no `oauth-worker/`.

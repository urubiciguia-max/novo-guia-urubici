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

## O que falta (fora de escopo desta fase, combinado com o Genilson)

- Upload de imagem de capa (`cover`) binária.
- Editor de `faq[]`/`affiliates[]`.
- Qualquer mudança no `oauth-worker/`.
- Pipeline de deploy/CI (quando rodar `npm run build` aqui antes do
  `astro build` da raiz) -- decisão do Tião.

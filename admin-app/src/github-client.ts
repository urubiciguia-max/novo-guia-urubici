import {
  GitHubApiError,
  PageNotFoundError,
  PageShaConflictError,
  PostAlreadyExistsError,
  PostNotFoundError,
  RateLimitError,
  ShaConflictError,
  ValidationError,
} from './errors.js';
import { parsePageFile, parsePostFile, serializePageFile, serializePostFile } from './markdown.js';
import { pageFrontmatterSchema, postFrontmatterSchema, SLUG_PATTERN, zodIssuesToErrors } from './schema.js';
import type {
  PageFrontmatter,
  PageListItem,
  PageRecord,
  PostFrontmatter,
  PostListItem,
  PostRecord,
  RenamePostResult,
  WriteResult,
} from './types.js';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const API_VERSION = '2022-11-28';

export interface GitHubPostsClientConfig {
  /** `access_token` entregue pelo oauth-worker via postMessage. O client só RECEBE -- nunca persiste/loga. */
  token: string;
  owner: string;
  repo: string;
  /** Branch onde cada "salvar" commita direto. Default: `main` (mesma do `backend.branch` em config.yml). */
  branch?: string;
  /** Pasta da collection no repo. Default: `src/content/posts` (mesma de `config.yml`). */
  postsPath?: string;
  /** Pasta da collection `pages` no repo. Default: `src/content/pages`. Lista fechada de 4 arquivos (ver spec do Carlito). */
  pagesPath?: string;
}

// ---------------------------------------------------------------------------
// Base64 universal (browser `btoa`/`atob` + `TextEncoder`/`TextDecoder` --
// Node 18+ também expõe os quatro como globals, então o mesmo código roda
// sem adaptação nos testes (Node/vitest) e no bundle final da SPA
// (navegador). Não usa `Buffer` de propósito -- essa classe não tem garantia
// de rodar em Node depois que o Tião decidir o bundler/target.
// ---------------------------------------------------------------------------

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

interface GitHubErrorBody {
  message?: string;
  documentation_url?: string;
}

/** Resposta crua de `GET /repos/{owner}/{repo}/contents/{path}` (só os campos que usamos). */
interface ContentsGetResponse {
  content: string;
  encoding: string;
  sha: string;
}

interface ContentsPutResponse {
  content: { sha: string };
  commit: { sha: string };
}

/**
 * Allowlist fixa de MIME type pra capa de post -- defesa em profundidade.
 * O Francisgleydisson já valida no browser (e confere magic bytes reais,
 * não só a extensão/MIME que o navegador reporta) antes de chamar
 * `uploadCoverImage`, mas a camada de dados não confia cegamente em input
 * que atravessou a UI -- qualquer código com acesso a uma instância de
 * `GitHubPostsClient` (DevTools/console) pode chamar o método direto.
 * `image/svg+xml` fica de fora de propósito: é vetor de XSS se algum dia
 * for inlinado (achado da spec do Genilson, 2026-10-30).
 */
const ALLOWED_COVER_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Mapa inverso: tipo detectado por magic bytes reais -> `mimeType` esperado.
 * Usado por `detectCoverImageMimeType` pra confirmar que o `file.mimeType`
 * DECLARADO pelo caller bate com o conteúdo REAL de `base64Content`.
 *
 * Achado da auditoria de segurança do Severino (2026-10-30, Track B): sem
 * esta checagem, `uploadCoverImage` validava só a STRING `mimeType` contra a
 * allowlist -- qualquer código com acesso a uma instância de
 * `GitHubPostsClient` (DevTools/console, pulando a validação de magic bytes
 * real do Francisgleydisson em `imageUpload.ts`) podia declarar
 * `mimeType: 'image/jpeg'` e mandar `base64Content` com qualquer bytes
 * (texto, HTML, JS) -- o teste pré-existente `VALID_FILE` nem usava bytes de
 * imagem reais (`'ZmFrZS1pbWFnZS1ieXRlcw=='` decodifica pra
 * `"fake-image-bytes"`, texto puro) e passava. O arquivo nunca é servido como
 * executável (só consumido via `<Image />`/Sharp no build do Astro), então o
 * risco prático é baixo (o ator já precisa ter o token com escopo de escrita
 * pra chamar este método) -- mas a allowlist de MIME só tem sentido como
 * defesa real se o conteúdo bater com o tipo declarado.
 */
const MIME_BY_DETECTED_TYPE: Record<'jpeg' | 'png' | 'webp', string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Confere a assinatura binária real dos primeiros bytes de um `base64`
 * (mesmas assinaturas que `admin-app/web/src/lib/imageUpload.ts` usa no
 * browser) -- decodifica só um prefixo pequeno, suficiente pra cobrir a
 * assinatura mais longa (WebP, 12 bytes == 16 chars base64; usamos 24 chars
 * de folga). `null` quando nenhuma assinatura bate (inclui SVG, que não tem
 * magic bytes binários fixos -- começa com texto/XML).
 */
function detectCoverImageMimeType(base64: string): string | null {
  const prefix = base64.slice(0, 24).replace(/\s/g, '');
  let binary: string;
  try {
    binary = atob(prefix);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return MIME_BY_DETECTED_TYPE.jpeg;
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return MIME_BY_DETECTED_TYPE.png;
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return MIME_BY_DETECTED_TYPE.webp;
  }
  return null;
}

/**
 * ~1MB de conteúdo bruto é o limite documentado da Contents API
 * (`PUT /repos/{owner}/{repo}/contents/{path}`) pra este tipo de commit.
 * Base64 infla o tamanho em ~33% (4 bytes codificados pra cada 3 brutos),
 * então o limite em caracteres de base64 é maior que 1_000_000 -- 1.4M
 * cobre esse fator com uma margem pequena. Documentado na spec do Genilson
 * (2026-10-30, Track B).
 */
const MAX_COVER_BASE64_LENGTH = 1_400_000;

/**
 * Sufixo único pro nome de arquivo de imagem de CONTEÚDO (corpo do
 * post/página, ver `uploadContentImage`/`uploadPageContentImage`) -- sem
 * upsert, cada upload precisa de um nome que nunca colida com outro
 * upload do mesmo slug (pode ter várias imagens no mesmo post), e sem
 * contador/estado (o client não guarda nada entre chamadas). `Date.now()`
 * em base36 + alguns bytes aleatórios (também base36) resolve isso na
 * prática -- não precisa ser criptograficamente forte, só não colidir
 * entre uploads feitos em sequência rápida pelo mesmo usuário.
 */
function uniqueContentImageSuffix(): string {
  const timestampBase36 = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${timestampBase36}-${randomSuffix}`;
}

/**
 * Confere se `cover` aponta pro padrão de nome que `uploadCoverImage` usa
 * pra ESTE slug (`./${slug}-capa.<ext>`, uma das 3 extensões aceitas pela
 * allowlist de MIME -- `ALLOWED_COVER_MIME_TYPES`). `renamePost` só
 * copia/renomeia a capa quando bate exatamente esse padrão -- um `cover`
 * com path diferente (upload manual, nome antigo/migração, path alheio)
 * fica como está, não é tocado (decisão explícita da spec do Genilson,
 * 2026-11-04, pra não arriscar mexer em algo fora da convenção conhecida).
 */
function legacyCoverExt(cover: string | undefined, slug: string): string | null {
  if (!cover) return null;
  for (const ext of Object.values(ALLOWED_COVER_MIME_TYPES)) {
    if (cover === `./${slug}-capa.${ext}`) return ext;
  }
  return null;
}

/** Escapa caracteres especiais de regex -- usado só pra montar o padrão de linha existente em `upsertRedirect`. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `public/_redirects` fica na RAIZ do repo -- NÃO dentro de `postsPath`
 * (confirmado lendo o arquivo real do projeto antes de codar, spec do
 * Genilson 2026-11-04). Sintaxe Cloudflare Pages: `/antigo   /novo   301`,
 * uma regra por linha.
 */
const REDIRECTS_PATH = 'public/_redirects';

/**
 * Cabeçalho explicativo -- mesmo texto que já existe hoje em
 * `public/_redirects` (ver arquivo real no repo), SEM o trecho "ainda sem
 * regras reais" + exemplo comentado do arquivo original: usado só no caso
 * (hipotético, hoje o arquivo já existe no repo) de `upsertRedirect`
 * precisar criar o arquivo do zero -- nesse momento já existe pelo menos
 * uma regra real sendo gravada, então "ainda sem regras" ficaria falso.
 */
const REDIRECTS_HEADER = [
  '# Cloudflare Pages — redirects.',
  '# Astro copia este arquivo de public/ pra dist/ automaticamente no build.',
  '# Docs: https://developers.cloudflare.com/pages/configuration/redirects/',
].join('\n');

interface GraphQlTreeResponse {
  data?: {
    repository?: {
      object?: {
        entries?: Array<{
          name: string;
          type: string;
          object?: { text?: string | null; oid?: string; isBinary?: boolean } | null;
        }>;
      } | null;
    } | null;
  };
  errors?: Array<{ type?: string; message: string }>;
}

export class GitHubPostsClient {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;
  private readonly postsPath: string;
  private readonly pagesPath: string;

  constructor(config: GitHubPostsClientConfig) {
    this.token = config.token;
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch ?? 'main';
    this.postsPath = config.postsPath ?? 'src/content/posts';
    this.pagesPath = config.pagesPath ?? 'src/content/pages';
  }

  // -- listPosts -------------------------------------------------------------

  /**
   * Lista todos os posts com os campos necessários pro Dashboard (stats) e
   * pra tabela de Artigos.
   *
   * ESTRATÉGIA (REST N+1 vs. GraphQL em lote): escolhido GraphQL, UMA
   * requisição total independente do número de posts, usando
   * `repository.object(expression: "<branch>:<pasta>")` sobre uma `Tree` --
   * isso devolve a listagem do diretório E o conteúdo (`text`) de cada
   * blob folha na mesma resposta. Alternativas descartadas:
   *   - Contents API (REST) pra listar a pasta: devolve metadata (nome, sha)
   *     mas NÃO o conteúdo -- precisaria 1 GET por arquivo pra ler o
   *     frontmatter (title/category/draft/etc), ou seja N+1 requisições.
   *   - Git Trees API recursiva (REST): mesma limitação -- lista blobs (sha,
   *     path) mas não o conteúdo; ainda precisa 1 GET por blob
   *     (`/git/blobs/{sha}`) pra ler o frontmatter. N+1 de novo.
   * GraphQL com `object(expression:)` resolve a pasta E os blobs numa
   * árvore só, no mesmo round-trip -- é o único caminho que vira O(1)
   * requisições em vez de O(N).
   *
   * Trade-off aceito: custo de "nó" da query GraphQL cresce com o número de
   * arquivos na pasta (cada entry + blob conta pro limite de complexidade
   * de 500k nós / 5000 pontos por hora do GitHub). Pra uma collection de
   * blog (dezenas a centenas de posts) isso nunca é um problema -- se um
   * dia a pasta crescer pra milhares de arquivos, paginar via
   * `object(expression: "<branch>:<pasta>")` não dá (não suporta cursor),
   * aí precisaria migrar pra Git Trees API + leitura em lote. Não é o caso
   * hoje; documentado pra não ser surpresa depois.
   *
   * Posts cujo frontmatter não valida no schema Zod NÃO derrubam a listagem
   * inteira -- entram com `valid: false` (ver `PostListItem`).
   */
  async listPosts(): Promise<PostListItem[]> {
    const query = `
      query($owner: String!, $repo: String!, $expr: String!) {
        repository(owner: $owner, name: $repo) {
          object(expression: $expr) {
            ... on Tree {
              entries {
                name
                type
                object {
                  ... on Blob {
                    text
                    oid
                    isBinary
                  }
                }
              }
            }
          }
        }
      }
    `;
    const expr = `${this.branch}:${this.postsPath}`;
    const body = await this.graphqlRequest<GraphQlTreeResponse>(query, {
      owner: this.owner,
      repo: this.repo,
      expr,
    });

    const entries = body.data?.repository?.object?.entries ?? [];
    const items: PostListItem[] = [];

    for (const entry of entries) {
      if (entry.type !== 'blob' || !entry.name.endsWith('.md')) continue;
      const slug = entry.name.slice(0, -'.md'.length);
      const sha = entry.object?.oid ?? '';
      if (entry.object?.isBinary || entry.object?.text == null) {
        items.push({
          slug,
          title: slug,
          category: null,
          author: null,
          pubDate: null,
          draft: false,
          legacySlug: null,
          sha,
          valid: false,
          validationErrors: ['Conteúdo do blob vazio ou binário -- não foi possível ler o frontmatter.'],
        });
        continue;
      }

      try {
        const { frontmatter } = parsePostFile(entry.object.text);
        const parsed = postFrontmatterSchema.safeParse(frontmatter);
        if (parsed.success) {
          items.push({
            slug,
            title: parsed.data.title,
            category: parsed.data.category,
            author: parsed.data.author,
            pubDate: parsed.data.pubDate,
            updatedDate: parsed.data.updatedDate ?? null,
            draft: parsed.data.draft,
            legacySlug: parsed.data.legacySlug,
            sha,
            valid: true,
          });
        } else {
          items.push({
            slug,
            title: typeof frontmatter.title === 'string' ? frontmatter.title : slug,
            category: null,
            author: typeof frontmatter.author === 'string' ? frontmatter.author : null,
            pubDate: typeof frontmatter.pubDate === 'string' ? frontmatter.pubDate : null,
            draft: typeof frontmatter.draft === 'boolean' ? frontmatter.draft : false,
            legacySlug: typeof frontmatter.legacySlug === 'string' ? frontmatter.legacySlug : null,
            sha,
            valid: false,
            validationErrors: zodIssuesToErrors(parsed.error.issues).map((i) => `${i.path || '(raiz)'}: ${i.message}`),
          });
        }
      } catch (err) {
        items.push({
          slug,
          title: slug,
          category: null,
          author: null,
          pubDate: null,
          draft: false,
          legacySlug: null,
          sha,
          valid: false,
          validationErrors: [err instanceof Error ? err.message : 'Erro desconhecido ao parsear o arquivo.'],
        });
      }
    }

    return items;
  }

  // -- getPost -----------------------------------------------------------

  /**
   * Busca um post específico via Contents API (REST) -- single-file read,
   * já devolve `content` (base64) + `sha` numa chamada só, é o endpoint
   * feito exatamente pra isso (diferente de `listPosts`, não há ganho em
   * trocar por GraphQL aqui).
   *
   * Post com frontmatter inválido NÃO lança erro -- devolve `valid: false`
   * pra UI deixar o editor abrir e corrigir (ver nota em `types.ts`).
   */
  async getPost(slug: string): Promise<PostRecord> {
    this.assertValidSlug(slug);
    const path = `${this.postsPath}/${slug}.md`;
    const res = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`, {
      method: 'GET',
    });

    if (res.status === 404) {
      throw new PostNotFoundError(slug);
    }
    const data = await this.parseJsonOrThrow<ContentsGetResponse>(res);

    const raw = base64ToUtf8(data.content);
    const { frontmatter, body } = parsePostFile(raw);
    const parsed = postFrontmatterSchema.safeParse(frontmatter);

    if (parsed.success) {
      return { slug, frontmatter: parsed.data, body, sha: data.sha, valid: true };
    }
    return {
      slug,
      // Mantém o que deu pra ler mesmo sem validar 100% -- a UI decide o que
      // fazer (mostrar aviso, bloquear save até corrigir, etc).
      frontmatter: frontmatter as unknown as PostFrontmatter,
      body,
      sha: data.sha,
      valid: false,
      validationErrors: zodIssuesToErrors(parsed.error.issues).map((i) => `${i.path || '(raiz)'}: ${i.message}`),
    };
  }

  // -- createPost ----------------------------------------------------------

  /** Cria um post novo. Valida o frontmatter ANTES de montar o commit -- falha sem gastar requisição se inválido. */
  async createPost(slug: string, frontmatter: PostFrontmatter, body: string): Promise<WriteResult> {
    this.assertValidSlug(slug);
    const validated = this.validateOrThrow(frontmatter);
    const path = `${this.postsPath}/${slug}.md`;
    const content = serializePostFile(validated, body);

    const res = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `content: cria post "${slug}"`,
        content: utf8ToBase64(content),
        branch: this.branch,
        // Sem `sha` de propósito -- é assim que a Contents API diferencia
        // "criar" de "atualizar". Se o arquivo já existir, o GitHub responde
        // 422 pedindo o sha -- tratado abaixo como "já existe".
      }),
    });

    if (res.status === 422) {
      const errBody = await this.safeJson<GitHubErrorBody>(res);
      if (errBody?.message?.toLowerCase().includes('sha')) {
        throw new PostAlreadyExistsError(slug);
      }
      throw new GitHubApiError(422, errBody?.message ?? 'Requisição inválida ao criar o post.');
    }

    const data = await this.parseJsonOrThrow<ContentsPutResponse>(res);
    return { sha: data.content.sha, commitSha: data.commit.sha };
  }

  // -- updatePost ----------------------------------------------------------

  /** Atualiza um post existente. Exige o `sha` atual (de `getPost`/`listPosts`) -- conflito (409) se alguém salvou por cima antes. */
  async updatePost(slug: string, frontmatter: PostFrontmatter, body: string, sha: string): Promise<WriteResult> {
    this.assertValidSlug(slug);
    const validated = this.validateOrThrow(frontmatter);
    const path = `${this.postsPath}/${slug}.md`;
    const content = serializePostFile(validated, body);

    const res = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `content: atualiza post "${slug}"`,
        content: utf8ToBase64(content),
        branch: this.branch,
        sha,
      }),
    });

    if (res.status === 404) throw new PostNotFoundError(slug);
    if (res.status === 409) throw new ShaConflictError(slug);

    const data = await this.parseJsonOrThrow<ContentsPutResponse>(res);
    return { sha: data.content.sha, commitSha: data.commit.sha };
  }

  // -- deletePost ----------------------------------------------------------

  /** Remove um post. Exige o `sha` atual, mesma lógica de conflito do `updatePost`. */
  async deletePost(slug: string, sha: string): Promise<void> {
    this.assertValidSlug(slug);
    const path = `${this.postsPath}/${slug}.md`;
    const res = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'DELETE',
      body: JSON.stringify({
        message: `content: remove post "${slug}"`,
        branch: this.branch,
        sha,
      }),
    });

    if (res.status === 404) throw new PostNotFoundError(slug);
    if (res.status === 409) throw new ShaConflictError(slug);
    if (!res.ok) {
      const errBody = await this.safeJson<GitHubErrorBody>(res);
      throw new GitHubApiError(res.status, errBody?.message ?? `Erro ao remover o post "${slug}".`);
    }
  }

  // -- renamePost --------------------------------------------------------

  /**
   * Renomeia o slug de um post JÁ PUBLICADO. Diferente de `updatePost`
   * (só reescreve o conteúdo no MESMO path), isso move o ARQUIVO -- o nome
   * do arquivo é a URL final (`src/pages/[...slug].astro` roteia por
   * filename), então renomear sem redirecionar quebraria a URL antiga pra
   * quem já tem ela indexada/salva. Por isso o passo final grava um
   * redirect 301 em `public/_redirects` -- regra inegociável de SEO
   * técnico deste projeto (ver CLAUDE.md), não é opcional.
   *
   * ORDEM pensada pra minimizar perda de dados se algo falhar no meio
   * (spec do Genilson, 2026-11-04): é melhor sobrar DUPLICATA visível
   * (post/capa antigos ainda no repo) do que FALTAR o post inteiro.
   *   1. valida os dois slugs + o frontmatter (tudo sem rede)
   *   2. confere que o NOVO path não existe ainda (evita sobrescrever
   *      outro post por acidente) -- `PostAlreadyExistsError`
   *   3. copia a capa pro nome novo, SE ela seguir a convenção de nome
   *      `./${oldSlug}-capa.<ext>` -- atualiza `frontmatter.cover` ANTES
   *      de criar o arquivo novo
   *   4. cria o post no path NOVO (sem sha -- arquivo novo)
   *   5. só então apaga o post no path ANTIGO, usando o `sha` recebido
   *      (mesma lógica de conflito de `updatePost`/`deletePost`:
   *      `PostNotFoundError`/`ShaConflictError`)
   *   6. apaga a capa ANTIGA, se copiou uma nova em 3 -- falha AQUI não
   *      bloqueia o resto (é cosmético: sobra uma imagem órfã/duplicada,
   *      não um post perdido)
   *   7. upsert da linha de redirect 301 em `public/_redirects`
   *
   * Cada passo de 2 a 5 lança um erro específico e INTERROMPE a cadeia
   * (nada depois dele roda) -- o passo 6 é a única exceção de propósito,
   * pra não deixar uma falha cosmética impedir o passo 7 (o inegociável).
   *
   * `newSlug === oldSlug` não é rename de fato -- delega pra `updatePost`
   * (mesmo slug, só conteúdo mudou) em vez de gastar as requisições extras
   * deste método.
   */
  async renamePost(
    oldSlug: string,
    newSlug: string,
    frontmatter: PostFrontmatter,
    body: string,
    sha: string
  ): Promise<RenamePostResult> {
    this.assertValidSlug(oldSlug);
    this.assertValidSlug(newSlug);

    if (newSlug === oldSlug) {
      return this.updatePost(oldSlug, frontmatter, body, sha);
    }

    const validated = this.validateOrThrow(frontmatter);

    // -- Passo 2: o NOVO path não pode já existir -----------------------------
    const newPath = `${this.postsPath}/${newSlug}.md`;
    const newPathCheckRes = await this.restRequest(
      `/repos/${this.owner}/${this.repo}/contents/${newPath}?ref=${this.branch}`,
      { method: 'GET' }
    );
    if (newPathCheckRes.status === 200) {
      throw new PostAlreadyExistsError(newSlug);
    }
    if (newPathCheckRes.status !== 404) {
      const errBody = await this.safeJson<GitHubErrorBody>(newPathCheckRes);
      throw new GitHubApiError(
        newPathCheckRes.status,
        errBody?.message ?? `Erro ao verificar se já existe um post em "${newSlug}". Nada foi alterado.`
      );
    }

    // -- Passo 3: copia a capa, SE seguir a convenção de nome -----------------
    let coverPath: string | undefined;
    let oldCoverToDelete: { path: string; sha: string } | undefined;

    const coverExt = legacyCoverExt(validated.cover as string | undefined, oldSlug);
    if (coverExt) {
      const oldCoverPath = `${this.postsPath}/${oldSlug}-capa.${coverExt}`;
      const coverGetRes = await this.restRequest(
        `/repos/${this.owner}/${this.repo}/contents/${oldCoverPath}?ref=${this.branch}`,
        { method: 'GET' }
      );
      if (coverGetRes.status === 200) {
        const coverData = await this.parseJsonOrThrow<ContentsGetResponse>(coverGetRes);
        const newCoverPath = `${this.postsPath}/${newSlug}-capa.${coverExt}`;
        const coverPutRes = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${newCoverPath}`, {
          method: 'PUT',
          body: JSON.stringify({
            message: `content: copia capa de "${oldSlug}" pra "${newSlug}" (rename)`,
            content: coverData.content,
            branch: this.branch,
            // Sem `sha` de propósito -- path novo, arquivo sempre inexistente
            // nesse ponto (senão o post em si já teria colidido no passo 2,
            // já que capa e post do mesmo slug nascem/morrem juntos).
          }),
        });
        if (!coverPutRes.ok) {
          const errBody = await this.safeJson<GitHubErrorBody>(coverPutRes);
          throw new GitHubApiError(
            coverPutRes.status,
            `Não consegui copiar a capa de "${oldSlug}" pra "${newSlug}" -- nada foi alterado, tenta de novo (${errBody?.message ?? 'erro desconhecido'}).`
          );
        }
        coverPath = `./${newSlug}-capa.${coverExt}`;
        validated.cover = coverPath;
        oldCoverToDelete = { path: oldCoverPath, sha: coverData.sha };
      } else if (coverGetRes.status !== 404) {
        const errBody = await this.safeJson<GitHubErrorBody>(coverGetRes);
        throw new GitHubApiError(
          coverGetRes.status,
          `Erro ao ler a capa atual de "${oldSlug}" -- nada foi alterado (${errBody?.message ?? 'erro desconhecido'}).`
        );
      }
      // 404: o frontmatter aponta pra capa nesse path, mas ela já não existe
      // no repo -- segue o rename sem copiar/renomear nada relacionado a capa.
    }

    // -- Passo 4: cria o post no path NOVO -------------------------------------
    const content = serializePostFile(validated, body);
    const createRes = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${newPath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `content: renomeia post "${oldSlug}" -> "${newSlug}"`,
        content: utf8ToBase64(content),
        branch: this.branch,
        // Sem `sha` de propósito -- mesma regra de `createPost` (arquivo novo).
      }),
    });

    if (createRes.status === 422) {
      const errBody = await this.safeJson<GitHubErrorBody>(createRes);
      if (errBody?.message?.toLowerCase().includes('sha')) {
        throw new PostAlreadyExistsError(newSlug);
      }
      throw new GitHubApiError(
        422,
        errBody?.message ?? `Requisição inválida ao criar o post em "${newSlug}". O post antigo "${oldSlug}" não foi tocado.`
      );
    }
    const createData = await this.parseJsonOrThrow<ContentsPutResponse>(createRes);

    // -- Passo 5: apaga o post no path ANTIGO ----------------------------------
    // A partir daqui o post NOVO já existe e está completo -- qualquer falha
    // dos passos 5/6/7 deixa, no máximo, duplicata visível (post e/ou capa
    // antigos ainda no repo), nunca o post inteiro faltando.
    const oldPath = `${this.postsPath}/${oldSlug}.md`;
    const deleteRes = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${oldPath}`, {
      method: 'DELETE',
      body: JSON.stringify({
        message: `content: remove post antigo "${oldSlug}" (renomeado pra "${newSlug}")`,
        branch: this.branch,
        sha,
      }),
    });

    if (deleteRes.status === 404) throw new PostNotFoundError(oldSlug);
    if (deleteRes.status === 409) throw new ShaConflictError(oldSlug);
    if (!deleteRes.ok) {
      const errBody = await this.safeJson<GitHubErrorBody>(deleteRes);
      throw new GitHubApiError(
        deleteRes.status,
        `Post criado em "${newSlug}" com sucesso, mas não consegui apagar o antigo "${oldSlug}" (${errBody?.message ?? 'erro desconhecido'}) -- verifique e apague manualmente se necessário.`
      );
    }

    // -- Passo 6: apaga a capa ANTIGA, se copiou uma nova no passo 3 ----------
    // De propósito NÃO lança em caso de falha aqui (409/404/outro) -- o post
    // já está consistente e completo no path novo; a pior consequência
    // possível é uma imagem órfã/duplicada sobrando no repo, não um post
    // perdido. Bloquear o passo 7 (redirect, o inegociável) por causa disso
    // seria pior do que o problema que previne.
    if (oldCoverToDelete) {
      await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${oldCoverToDelete.path}`, {
        method: 'DELETE',
        body: JSON.stringify({
          message: `content: remove capa antiga de "${oldSlug}" (renomeado pra "${newSlug}")`,
          branch: this.branch,
          sha: oldCoverToDelete.sha,
        }),
      });
    }

    // -- Passo 7: grava (upsert) o redirect 301 --------------------------------
    await this.upsertRedirect(oldSlug, newSlug);

    return {
      sha: createData.content.sha,
      commitSha: createData.commit.sha,
      ...(coverPath ? { coverPath } : {}),
    };
  }

  /**
   * Upsert de UMA linha de redirect 301 em `public/_redirects` (raiz do
   * repo, ver `REDIRECTS_PATH`) -- helper interno de `renamePost`. Nunca
   * duplica uma linha pro MESMO `oldSlug`: se já existir uma regra
   * redirecionando esse slug (ex.: o post já foi renomeado antes), ela é
   * SUBSTITUÍDA em vez de uma segunda linha ser acumulada.
   */
  private async upsertRedirect(oldSlug: string, newSlug: string): Promise<void> {
    const getRes = await this.restRequest(
      `/repos/${this.owner}/${this.repo}/contents/${REDIRECTS_PATH}?ref=${this.branch}`,
      { method: 'GET' }
    );

    let currentSha: string | undefined;
    let lines: string[];
    if (getRes.status === 200) {
      const data = await this.parseJsonOrThrow<ContentsGetResponse>(getRes);
      currentSha = data.sha;
      const text = base64ToUtf8(data.content).replace(/\r\n/g, '\n');
      lines = text.length > 0 ? text.split('\n') : [];
    } else if (getRes.status === 404) {
      lines = REDIRECTS_HEADER.split('\n');
    } else {
      const errBody = await this.safeJson<GitHubErrorBody>(getRes);
      throw new GitHubApiError(
        getRes.status,
        `Post renomeado com sucesso, mas não consegui ler "${REDIRECTS_PATH}" pra gravar o redirecionamento 301 -- adiciona manualmente a linha "/${oldSlug}   /${newSlug}   301" (${errBody?.message ?? 'erro desconhecido'}).`
      );
    }

    const newLine = `/${oldSlug}   /${newSlug}   301`;
    const existingLineRe = new RegExp(`^\\s*/${escapeRegExp(oldSlug)}\\s+`);
    let replaced = false;
    const updatedLines = lines.map((line) => {
      if (!replaced && existingLineRe.test(line)) {
        replaced = true;
        return newLine;
      }
      return line;
    });
    if (!replaced) {
      while (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] === '') {
        updatedLines.pop();
      }
      updatedLines.push(newLine);
    }

    const newText = `${updatedLines.join('\n').replace(/\n+$/, '')}\n`;

    const putRes = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${REDIRECTS_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `content: adiciona redirect 301 "${oldSlug}" -> "${newSlug}"`,
        content: utf8ToBase64(newText),
        branch: this.branch,
        ...(currentSha ? { sha: currentSha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errBody = await this.safeJson<GitHubErrorBody>(putRes);
      throw new GitHubApiError(
        putRes.status,
        `Post renomeado com sucesso, mas não consegui gravar o redirecionamento 301 em "${REDIRECTS_PATH}" -- adiciona manualmente a linha "/${oldSlug}   /${newSlug}   301" (${errBody?.message ?? 'erro desconhecido'}).`
      );
    }
  }

  // -- uploadCoverImage ------------------------------------------------------

  /**
   * Commita a imagem de capa de um post via Contents API (REST) -- mesmo
   * endpoint que `createPost`/`updatePost` já usam, só que com conteúdo
   * binário (base64 de bytes de imagem, não UTF-8 de markdown).
   *
   * Upsert automático: faz um GET no path de destino primeiro pra descobrir
   * se já existe uma capa anterior desse slug. Existindo (200), captura o
   * `sha` atual e inclui no PUT (substituição); não existindo (404), PUT
   * sem `sha` (criação) -- mesma regra da Contents API que `createPost`
   * evita (sem `sha` em arquivo que já existe, a API rejeita com 422).
   * Caller não precisa gerenciar sha de imagem, diferente de
   * `updatePost`/`deletePost` que exigem o sha do post (markdown) como
   * parâmetro.
   *
   * Fora de escopo nesta v1: Git Data API (blob+tree+commit), que subiria
   * arquivos maiores que o limite de ~1MB da Contents API. O arquivo já
   * chega comprimido abaixo desse limite pelo Francisgleydisson (canvas no
   * browser) antes de chegar aqui -- ver spec do Genilson (2026-10-30,
   * Track B) pro raciocínio completo.
   */
  async uploadCoverImage(
    legacySlug: string,
    file: { name: string; mimeType: string; base64Content: string }
  ): Promise<{ path: string; sha: string; commitSha: string }> {
    this.assertValidSlug(legacySlug);

    const ext = ALLOWED_COVER_MIME_TYPES[file.mimeType];
    if (!ext) {
      throw new ValidationError([
        {
          path: 'mimeType',
          message: `Tipo de imagem não suportado: "${file.mimeType}". Use JPEG, PNG ou WebP.`,
        },
      ]);
    }

    // Confere que o CONTEÚDO real bate com o `mimeType` DECLARADO -- não
    // basta o nome do tipo estar na allowlist (ver `detectCoverImageMimeType`
    // pro raciocínio completo). Pega qualquer `base64Content` que não seja
    // de fato uma imagem JPEG/PNG/WebP, mesmo que o caller tenha mentido o
    // `mimeType` (ex.: chamada direta via DevTools/console, pulando a
    // validação de magic bytes real que a UI faz em `imageUpload.ts`).
    const detectedMimeType = detectCoverImageMimeType(file.base64Content);
    if (detectedMimeType === null || detectedMimeType !== file.mimeType) {
      throw new ValidationError([
        {
          path: 'base64Content',
          message:
            'O conteúdo do arquivo não corresponde a uma imagem JPEG, PNG ou WebP válida (os bytes reais não batem com o tipo declarado).',
        },
      ]);
    }

    if (file.base64Content.length > MAX_COVER_BASE64_LENGTH) {
      throw new ValidationError([
        {
          path: 'base64Content',
          message: 'Imagem muito grande mesmo após compressão (limite da Contents API é ~1MB).',
        },
      ]);
    }

    const filename = `${legacySlug}-capa.${ext}`;
    const path = `${this.postsPath}/${filename}`;

    const existingRes = await this.restRequest(
      `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`,
      { method: 'GET' }
    );

    let existingSha: string | undefined;
    if (existingRes.status === 200) {
      const existingData = await this.parseJsonOrThrow<ContentsGetResponse>(existingRes);
      existingSha = existingData.sha;
    } else if (existingRes.status !== 404) {
      const errBody = await this.safeJson<GitHubErrorBody>(existingRes);
      throw new GitHubApiError(
        existingRes.status,
        errBody?.message ?? `Erro ao verificar capa existente do post "${legacySlug}".`
      );
    }

    const res = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `content: atualiza capa do post "${legacySlug}"`,
        content: file.base64Content,
        branch: this.branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });

    if (res.status === 409) throw new ShaConflictError(legacySlug);

    const data = await this.parseJsonOrThrow<ContentsPutResponse>(res);
    return { path: `./${filename}`, sha: data.content.sha, commitSha: data.commit.sha };
  }

  // -- uploadContentImage / uploadPageContentImage ----------------------------

  /**
   * Núcleo compartilhado de `uploadContentImage` (posts) e
   * `uploadPageContentImage` (pages) -- valida o arquivo (mesma allowlist +
   * confirmação de magic bytes reais de `uploadCoverImage`), monta um nome
   * de arquivo único e faz o PUT.
   *
   * SEM upsert de propósito, diferente de `uploadCoverImage`: imagem de
   * CAPA tem um slot fixo por post (`${legacySlug}-capa.${ext}`), então
   * "subir de novo" é sempre "substituir". Imagem de CONTEÚDO não tem esse
   * conceito -- o post pode ter zero, uma ou várias imagens no corpo, e
   * cada upload da toolbar é sempre um arquivo NOVO. Por isso: nome único
   * por chamada (`${slug}-img-<timestamp36>-<random>.<ext>`, nunca colide
   * com o padrão `-capa.` da capa) e PUT direto, sem GET prévio nem `sha`.
   */
  private async uploadContentImageToFolder(
    folderPath: string,
    slug: string,
    file: { name: string; mimeType: string; base64Content: string }
  ): Promise<{ path: string; sha: string; commitSha: string }> {
    this.assertValidSlug(slug);

    const ext = ALLOWED_COVER_MIME_TYPES[file.mimeType];
    if (!ext) {
      throw new ValidationError([
        {
          path: 'mimeType',
          message: `Tipo de imagem não suportado: "${file.mimeType}". Use JPEG, PNG ou WebP.`,
        },
      ]);
    }

    // Mesma defesa em profundidade de `uploadCoverImage` -- confere que o
    // CONTEÚDO real bate com o `mimeType` DECLARADO (ver
    // `detectCoverImageMimeType` pro raciocínio completo).
    const detectedMimeType = detectCoverImageMimeType(file.base64Content);
    if (detectedMimeType === null || detectedMimeType !== file.mimeType) {
      throw new ValidationError([
        {
          path: 'base64Content',
          message:
            'O conteúdo do arquivo não corresponde a uma imagem JPEG, PNG ou WebP válida (os bytes reais não batem com o tipo declarado).',
        },
      ]);
    }

    if (file.base64Content.length > MAX_COVER_BASE64_LENGTH) {
      throw new ValidationError([
        {
          path: 'base64Content',
          message: 'Imagem muito grande mesmo após compressão (limite da Contents API é ~1MB).',
        },
      ]);
    }

    const filename = `${slug}-img-${uniqueContentImageSuffix()}.${ext}`;
    const path = `${folderPath}/${filename}`;

    const res = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `content: adiciona imagem no corpo de "${slug}"`,
        content: file.base64Content,
        branch: this.branch,
        // Sem `sha` de propósito -- arquivo novo sempre (ver doc acima).
      }),
    });

    const data = await this.parseJsonOrThrow<ContentsPutResponse>(res);
    return { path: `./${filename}`, sha: data.content.sha, commitSha: data.commit.sha };
  }

  /**
   * Commita uma imagem inserida no CORPO de um post (toolbar do editor --
   * trabalho do Francisgleydisson em cima deste contrato), gravando na
   * mesma pasta do markdown (`postsPath`). Ver `uploadContentImageToFolder`
   * pro comportamento completo (validação + nome único + sem upsert).
   */
  async uploadContentImage(
    slug: string,
    file: { name: string; mimeType: string; base64Content: string }
  ): Promise<{ path: string; sha: string; commitSha: string }> {
    return this.uploadContentImageToFolder(this.postsPath, slug, file);
  }

  /**
   * Equivalente de `uploadContentImage`, mas grava em `pagesPath` -- pras 4
   * páginas institucionais. Nome de método separado (em vez de reusar
   * `uploadContentImage`) porque esta mesma classe implementa `PostsClient`
   * e `PagesClient` ao mesmo tempo (ver `web/src/lib/postsClient.ts` e
   * `web/src/lib/pagesClient.ts`) -- cada interface precisa apontar pra um
   * método que escreve na pasta certa, então os dois nomes não podem
   * colidir na mesma instância.
   */
  async uploadPageContentImage(
    slug: string,
    file: { name: string; mimeType: string; base64Content: string }
  ): Promise<{ path: string; sha: string; commitSha: string }> {
    return this.uploadContentImageToFolder(this.pagesPath, slug, file);
  }

  // -- listPages ---------------------------------------------------------

  /**
   * Lista as paginas institucionais com os campos pra tabela "Paginas" do
   * painel. Mesma estrategia de `listPosts` (GraphQL em lote, UMA
   * requisicao) -- mesmo a pasta `pages` tendo so 4 arquivos fixos (lista
   * fechada, sem create/delete), nao vale a pena ter dois caminhos de
   * codigo diferentes (REST N+1 pra pages, GraphQL pra posts) por uma pasta
   * pequena; a pasta nunca cresce (WON'T da spec do Carlito), entao o
   * trade-off de custo de query do GraphQL nem se aplica aqui.
   *
   * Pagina cujo frontmatter nao valida no schema Zod NAO derruba a
   * listagem -- entra com `valid: false`, mesmo padrao de `listPosts`.
   */
  async listPages(): Promise<PageListItem[]> {
    const query = `
      query($owner: String!, $repo: String!, $expr: String!) {
        repository(owner: $owner, name: $repo) {
          object(expression: $expr) {
            ... on Tree {
              entries {
                name
                type
                object {
                  ... on Blob {
                    text
                    oid
                    isBinary
                  }
                }
              }
            }
          }
        }
      }
    `;
    const expr = `${this.branch}:${this.pagesPath}`;
    const body = await this.graphqlRequest<GraphQlTreeResponse>(query, {
      owner: this.owner,
      repo: this.repo,
      expr,
    });

    const entries = body.data?.repository?.object?.entries ?? [];
    const items: PageListItem[] = [];

    for (const entry of entries) {
      if (entry.type !== 'blob' || !entry.name.endsWith('.md')) continue;
      const slug = entry.name.slice(0, -'.md'.length);
      const sha = entry.object?.oid ?? '';
      if (entry.object?.isBinary || entry.object?.text == null) {
        items.push({
          slug,
          title: slug,
          description: '',
          sha,
          valid: false,
          validationErrors: ['Conteúdo do blob vazio ou binário -- não foi possível ler o frontmatter.'],
        });
        continue;
      }

      try {
        const { frontmatter } = parsePageFile(entry.object.text);
        const parsed = pageFrontmatterSchema.safeParse(frontmatter);
        if (parsed.success) {
          items.push({
            slug,
            title: parsed.data.title,
            description: parsed.data.description,
            sha,
            valid: true,
          });
        } else {
          items.push({
            slug,
            title: typeof frontmatter.title === 'string' ? frontmatter.title : slug,
            description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
            sha,
            valid: false,
            validationErrors: zodIssuesToErrors(parsed.error.issues).map((i) => `${i.path || '(raiz)'}: ${i.message}`),
          });
        }
      } catch (err) {
        items.push({
          slug,
          title: slug,
          description: '',
          sha,
          valid: false,
          validationErrors: [err instanceof Error ? err.message : 'Erro desconhecido ao parsear o arquivo.'],
        });
      }
    }

    return items;
  }

  // -- getPage -------------------------------------------------------------

  /**
   * Busca uma pagina especifica via Contents API (REST), mesmo padrao de
   * `getPost`. Pagina com frontmatter invalido NAO lanca erro -- devolve
   * `valid: false` pra UI abrir o editor e deixar corrigir.
   */
  async getPage(slug: string): Promise<PageRecord> {
    this.assertValidSlug(slug);
    const path = `${this.pagesPath}/${slug}.md`;
    const res = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`, {
      method: 'GET',
    });

    if (res.status === 404) {
      throw new PageNotFoundError(slug);
    }
    const data = await this.parseJsonOrThrow<ContentsGetResponse>(res);

    const raw = base64ToUtf8(data.content);
    const { frontmatter, body } = parsePageFile(raw);
    const parsed = pageFrontmatterSchema.safeParse(frontmatter);

    if (parsed.success) {
      return { slug, frontmatter: parsed.data, body, sha: data.sha, valid: true };
    }
    return {
      slug,
      frontmatter: frontmatter as unknown as PageFrontmatter,
      body,
      sha: data.sha,
      valid: false,
      validationErrors: zodIssuesToErrors(parsed.error.issues).map((i) => `${i.path || '(raiz)'}: ${i.message}`),
    };
  }

  // -- updatePage ------------------------------------------------------------

  /**
   * Atualiza uma pagina institucional existente. Exige o `sha` atual (de
   * `getPage`/`listPages`) -- conflito (409) se alguem salvou por cima
   * antes. SEM `createPage`/`deletePage` de proposito -- lista fechada de 4
   * arquivos (ver spec do Carlito, WON'T).
   */
  async updatePage(slug: string, frontmatter: PageFrontmatter, body: string, sha: string): Promise<WriteResult> {
    this.assertValidSlug(slug);
    const validated = this.validatePageOrThrow(frontmatter);
    const path = `${this.pagesPath}/${slug}.md`;
    const content = serializePageFile(validated, body);

    const res = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `content: atualiza página "${slug}"`,
        content: utf8ToBase64(content),
        branch: this.branch,
        sha,
      }),
    });

    if (res.status === 404) throw new PageNotFoundError(slug);
    if (res.status === 409) throw new PageShaConflictError(slug);

    const data = await this.parseJsonOrThrow<ContentsPutResponse>(res);
    return { sha: data.content.sha, commitSha: data.commit.sha };
  }

  // -- helpers internos ------------------------------------------------------

  /**
   * Valida `slug` ANTES de usá-lo pra montar o caminho da Contents API
   * (`${this.postsPath}/${slug}.md`). Isto é a defesa real contra path
   * traversal (`../`, `/`) ou qualquer outro caractere que o `fetch`/`URL`
   * resolveria de forma inesperada ao montar a URL -- precisa estar AQUI
   * (camada de dados), não só na UI, porque qualquer código com acesso a
   * uma instância de `GitHubPostsClient` (DevTools/console, por exemplo)
   * pode chamar `createPost`/`updatePost`/`deletePost`/`getPost` direto,
   * pulando o form e o `postFrontmatterSchema.safeParse` que o
   * `PostFormPage` roda antes de montar `frontmatter.legacySlug`.
   *
   * Mesmo regex de `legacySlug` em `schema.ts` (`SLUG_PATTERN`) -- por
   * convenção do projeto, `slug` (nome do arquivo) e `legacySlug` (campo do
   * frontmatter) devem ser sempre o mesmo valor, então a mesma regra de
   * forma vale pros dois. Achado da auditoria de segurança do Severino
   * (2026-10-30) -- ver handoff em `.agents/inbox/marivone.md`.
   */
  private assertValidSlug(slug: string): void {
    if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
      throw new ValidationError([
        { path: 'slug', message: 'Slug inválido -- só minúsculas, números e hífen (kebab-case), sem "/" ou "..".' },
      ]);
    }
  }

  private validateOrThrow(frontmatter: PostFrontmatter): Record<string, unknown> {
    const parsed = postFrontmatterSchema.safeParse(frontmatter);
    if (!parsed.success) {
      throw new ValidationError(zodIssuesToErrors(parsed.error.issues));
    }
    return parsed.data;
  }

  private validatePageOrThrow(frontmatter: PageFrontmatter): Record<string, unknown> {
    const parsed = pageFrontmatterSchema.safeParse(frontmatter);
    if (!parsed.success) {
      throw new ValidationError(zodIssuesToErrors(parsed.error.issues));
    }
    return parsed.data;
  }

  private authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'Content-Type': 'application/json',
    };
  }

  /** `fetch` pra REST, com tratamento de rede + rate limit já embutido. Devolve a `Response` crua pra cada método decidir o mapeamento de status específico (404/409/422 têm significados diferentes por endpoint). */
  private async restRequest(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${GITHUB_API_BASE}${path}`, { ...init, headers: this.authHeaders() });
    } catch {
      throw new GitHubApiError(0, 'Erro de rede ao comunicar com a API do GitHub. Verifique sua conexão.');
    }
    this.throwIfRateLimited(res);
    return res;
  }

  private async graphqlRequest<T extends { errors?: Array<{ type?: string; message: string }> }>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(GITHUB_GRAPHQL_URL, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new GitHubApiError(0, 'Erro de rede ao comunicar com a API do GitHub (GraphQL).');
    }
    this.throwIfRateLimited(res);

    if (!res.ok) {
      const errBody = await this.safeJson<GitHubErrorBody>(res);
      throw new GitHubApiError(res.status, errBody?.message ?? 'Erro ao consultar a API GraphQL do GitHub.');
    }

    const body = (await this.safeJson<T>(res)) ?? ({} as T);
    const rateLimited = body.errors?.find((e) => e.type === 'RATE_LIMITED');
    if (rateLimited) {
      throw new RateLimitError(this.rateLimitResetFromHeaders(res.headers));
    }
    if (body.errors && body.errors.length > 0) {
      throw new GitHubApiError(200, `Erro GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    return body;
  }

  /**
   * GitHub sinaliza rate limit esgotado com `403` + header
   * `X-RateLimit-Remaining: 0` (primário) -- um 403 "normal" (permissão
   * negada, token sem escopo) não tem esse header zerado, então é seguro
   * distinguir os dois casos só por isso, sem adivinhar pela mensagem.
   * Rate limit secundário (abuse detection) vem como 403 com
   * `Retry-After` em vez de `X-RateLimit-Remaining` -- cobre os dois.
   */
  private throwIfRateLimited(res: Response): void {
    if (res.status !== 403) return;
    const remaining = res.headers.get('x-ratelimit-remaining');
    const retryAfter = res.headers.get('retry-after');
    if (remaining === '0' || retryAfter !== null) {
      throw new RateLimitError(this.rateLimitResetFromHeaders(res.headers));
    }
  }

  private rateLimitResetFromHeaders(headers: Headers): Date | null {
    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!Number.isNaN(seconds)) return new Date(Date.now() + seconds * 1000);
    }
    const reset = headers.get('x-ratelimit-reset');
    if (reset) {
      const epochSeconds = Number(reset);
      if (!Number.isNaN(epochSeconds)) return new Date(epochSeconds * 1000);
    }
    return null;
  }

  private async safeJson<T>(res: Response): Promise<T | null> {
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  private async parseJsonOrThrow<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const errBody = await this.safeJson<GitHubErrorBody>(res);
      throw new GitHubApiError(res.status, errBody?.message ?? `A API do GitHub respondeu com status ${res.status}.`);
    }
    const body = await this.safeJson<T>(res);
    if (body === null) {
      throw new GitHubApiError(res.status, 'Resposta da API do GitHub não pôde ser interpretada.');
    }
    return body;
  }
}

import {
  GitHubApiError,
  PostAlreadyExistsError,
  PostNotFoundError,
  RateLimitError,
  ShaConflictError,
  ValidationError,
} from './errors.js';
import { parsePostFile, serializePostFile } from './markdown.js';
import { postFrontmatterSchema, SLUG_PATTERN, zodIssuesToErrors } from './schema.js';
import type { PostFrontmatter, PostListItem, PostRecord, WriteResult } from './types.js';

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

  constructor(config: GitHubPostsClientConfig) {
    this.token = config.token;
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch ?? 'main';
    this.postsPath = config.postsPath ?? 'src/content/posts';
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

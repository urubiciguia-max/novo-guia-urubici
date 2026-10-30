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

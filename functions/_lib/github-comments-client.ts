import { isValidSlug } from './slug.js';
import type { ApprovedComment } from './types.js';

const GITHUB_API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export interface GitHubCommentsClientConfig {
  /** Token OAuth do PRÓPRIO Moises, repassado do header `Authorization` do browser dele -- ver `auth.ts`. Nunca um token "bot" fixo. */
  token: string;
  owner: string;
  repo: string;
  branch?: string;
  /** Pasta da collection `comments` -- mesmo slug dos posts (`src/content/posts/<slug>.md` <-> `src/content/comments/<slug>.json`). */
  commentsPath?: string;
}

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/** Arquivo de comentários mudou entre o GET e o PUT (409) -- já tentamos de novo UMA vez em `appendComment`, isso só escapa se colidir duas vezes seguidas. */
export class ShaConflictError extends Error {
  constructor(public readonly slug: string) {
    super(`O arquivo de comentários de "${slug}" foi modificado por outra aprovação ao mesmo tempo. Tenta aprovar de novo.`);
    this.name = 'ShaConflictError';
  }
}

interface ContentsGetResponse {
  content: string;
  sha: string;
}
interface ContentsPutResponse {
  commit: { sha: string };
}
interface GitHubErrorBody {
  message?: string;
}

// Mesmos helpers base64 universais de `admin-app/src/github-client.ts`
// (btoa/atob + TextEncoder/TextDecoder -- globals tanto no runtime do
// Workers quanto no Node 18+, então roda sem adaptação em vitest).
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

/**
 * Client mínimo da Contents API dedicado a `src/content/comments/<slug>.json`
 * -- NÃO é o mesmo `GitHubPostsClient` de `admin-app/src/github-client.ts`
 * (motivo: pacotes npm separados, ver nota em `slug.ts`), mas replica
 * deliberadamente o MESMO padrão de leitura/escrita e tratamento de
 * conflito (GET pra achar o `sha` atual -- 404 vira array vazio -- PUT
 * com/sem `sha` conforme o caso -- 409 é conflito de concorrência).
 */
export class GitHubCommentsClient {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;
  private readonly commentsPath: string;

  constructor(config: GitHubCommentsClientConfig) {
    this.token = config.token;
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch ?? 'main';
    this.commentsPath = config.commentsPath ?? 'src/content/comments';
  }

  /**
   * Faz o append de UM comentário aprovado em
   * `src/content/comments/<slug>.json`. Tenta de novo UMA vez se o PUT
   * voltar 409 (outra aprovação mudou o arquivo entre o GET e o PUT desta
   * chamada) -- seguro porque a operação é append-only: re-ler o array
   * atualizado e anexar de novo não perde nem duplica nada que já estava
   * lá. Na segunda colisão, desiste e deixa o caller decidir (o endpoint
   * de approve devolve 409 pro admin tentar de novo).
   */
  async appendComment(slug: string, comment: ApprovedComment): Promise<{ commitSha: string }> {
    this.assertValidSlug(slug);
    const path = `${this.commentsPath}/${slug}.json`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const getRes = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`, {
        method: 'GET',
      });

      let currentSha: string | undefined;
      let comments: ApprovedComment[] = [];
      if (getRes.status === 200) {
        const data = await this.parseJsonOrThrow<ContentsGetResponse>(getRes);
        currentSha = data.sha;
        let parsed: unknown;
        try {
          parsed = JSON.parse(base64ToUtf8(data.content));
        } catch {
          throw new GitHubApiError(
            500,
            `"${path}" existe mas não é JSON válido -- corrija manualmente antes de aprovar novos comentários de "${slug}".`
          );
        }
        if (!Array.isArray(parsed)) {
          throw new GitHubApiError(
            500,
            `"${path}" existe mas não é um array -- corrija manualmente antes de aprovar novos comentários de "${slug}".`
          );
        }
        comments = parsed as ApprovedComment[];
      } else if (getRes.status !== 404) {
        const errBody = await this.safeJson<GitHubErrorBody>(getRes);
        throw new GitHubApiError(getRes.status, errBody?.message ?? `Erro ao ler comentários existentes de "${slug}".`);
      }
      // 404: arquivo ainda não existe pra este slug -- primeiro comentário aprovado dele, começa array vazio.

      const updated = [...comments, comment];
      const putRes = await this.restRequest(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: `content: aprova comentário em "${slug}"`,
          content: utf8ToBase64(`${JSON.stringify(updated, null, 2)}\n`),
          branch: this.branch,
          ...(currentSha ? { sha: currentSha } : {}),
        }),
      });

      if (putRes.status === 409) {
        if (attempt === 0) continue; // re-tenta uma vez (re-GET + re-append)
        throw new ShaConflictError(slug);
      }

      const data = await this.parseJsonOrThrow<ContentsPutResponse>(putRes);
      return { commitSha: data.commit.sha };
    }

    // Inalcançável (o loop de 2 tentativas sempre retorna ou lança antes) -- só pra o TS não reclamar de "função sem retorno em todos os caminhos".
    throw new GitHubApiError(500, `Falha inesperada ao gravar comentário de "${slug}".`);
  }

  private assertValidSlug(slug: string): void {
    if (!isValidSlug(slug)) {
      throw new GitHubApiError(400, 'Slug inválido -- só minúsculas, números e hífen (kebab-case), sem "/" ou "..".');
    }
  }

  private authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'Content-Type': 'application/json',
      // Obrigatório -- sem isso o GitHub responde 403 "Request forbidden by
      // administrative rules" (fetch() do Cloudflare Workers não seta um
      // User-Agent default como um browser faria). Achado em produção,
      // 2026-11-09 -- ver auth.ts, mesmo fix.
      'User-Agent': 'guia-urubici-admin',
    };
  }

  private async restRequest(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${GITHUB_API_BASE}${path}`, { ...init, headers: this.authHeaders() });
    } catch {
      throw new GitHubApiError(0, 'Erro de rede ao comunicar com a API do GitHub.');
    }
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

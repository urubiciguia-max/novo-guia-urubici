/**
 * Erros tipados do client. Cada método do `GitHubPostsClient` lança um
 * desses -- nunca deixa escapar o erro genérico do `fetch`/`TypeError`
 * cru, pra UI conseguir mostrar mensagem útil em vez de "fetch failed"
 * ou um JSON de erro da API do GitHub sem contexto.
 */

/** Base de todos os erros do client -- útil pra `catch (e) { if (e instanceof GitHubClientError) ... }`. */
export class GitHubClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Post não existe (404 da API -- `getPost`, `deletePost`, `updatePost`). */
export class PostNotFoundError extends GitHubClientError {
  constructor(public readonly slug: string) {
    super(`Post "${slug}" não encontrado no repositório.`);
  }
}

/** `createPost` chamado com um slug que já existe (arquivo já existe no repo). */
export class PostAlreadyExistsError extends GitHubClientError {
  constructor(public readonly slug: string) {
    super(`Já existe um post com o slug "${slug}". Escolha outro ou edite o existente.`);
  }
}

/**
 * SHA enviado não bate com o SHA atual do arquivo no GitHub (409) --
 * alguém (ou outra aba) salvou por cima entre o `getPost`/`listPosts` e o
 * `updatePost`/`deletePost`. A UI deve recarregar o post e deixar o editor
 * decidir (sobrescrever ou descartar), nunca tentar de novo sozinha.
 */
export class ShaConflictError extends GitHubClientError {
  constructor(public readonly slug: string) {
    super(
      `O post "${slug}" foi modificado por outra pessoa (ou outra aba) depois que você abriu pra editar. Recarregue antes de salvar.`
    );
  }
}

/** Rate limit da API do GitHub esgotado (403 com `X-RateLimit-Remaining: 0`, ou erro `RATE_LIMITED` do GraphQL). */
export class RateLimitError extends GitHubClientError {
  constructor(public readonly resetAt: Date | null) {
    super(
      resetAt
        ? `Limite de requisições da API do GitHub esgotado. Tenta novamente depois de ${resetAt.toLocaleTimeString('pt-BR')}.`
        : 'Limite de requisições da API do GitHub esgotado. Tenta novamente em alguns minutos.'
    );
  }
}

/** Frontmatter não passou na validação Zod (`createPost`/`updatePost`) -- bloqueia o commit. */
export class ValidationError extends GitHubClientError {
  constructor(public readonly issues: { path: string; message: string }[]) {
    super(`Frontmatter inválido: ${issues.map((i) => `${i.path || '(raiz)'}: ${i.message}`).join('; ')}`);
  }
}

/** Qualquer outro erro da API do GitHub (rede, 500, 401 token inválido/expirado, etc). */
export class GitHubApiError extends GitHubClientError {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

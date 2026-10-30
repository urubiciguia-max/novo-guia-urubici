import { GitHubApiError, RateLimitError, ValidationError } from '@admin-data/index.js';

/** Mensagem pronta pra UI a partir de qualquer erro que o `PostsClient` lance -- ver `.agents/inbox/francisgleydisson.md` (seção "Erros"). */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido.';
}

/** 401 = token inválido/expirado/revogado -- força logout (ver `AuthContext.handleUnauthorized`). */
export function isUnauthorized(err: unknown): boolean {
  return err instanceof GitHubApiError && err.status === 401;
}

export function isRateLimited(err: unknown): err is RateLimitError {
  return err instanceof RateLimitError;
}

/** `ValidationError.issues` -> mapa `path -> message` pra erro de campo inline no form. */
export function fieldErrorsFrom(err: unknown): Record<string, string> {
  if (!(err instanceof ValidationError)) return {};
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    out[issue.path || '(raiz)'] = issue.message;
  }
  return out;
}

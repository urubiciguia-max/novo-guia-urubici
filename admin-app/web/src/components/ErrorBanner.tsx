export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="alert">
      {message}
    </div>
  );
}

/** Aviso de posts com frontmatter inválido -- nunca escondido (ver handoff do Jurandir). */
export function InvalidPostsWarning({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="warning-banner" role="status">
      {count === 1
        ? '1 post com frontmatter inválido -- revise antes de publicar.'
        : `${count} posts com frontmatter inválido -- revise antes de publicar.`}
    </div>
  );
}

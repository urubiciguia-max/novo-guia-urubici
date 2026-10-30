import type { ReactNode } from 'react';

export type BadgeVariant = 'success' | 'neutral' | 'warning' | 'danger';

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}

/** Chip de status publicado/rascunho -- convenção fixa de cor (verde = publicado). */
export function StatusBadge({ draft }: { draft: boolean }) {
  return draft ? (
    <Badge variant="neutral">Rascunho</Badge>
  ) : (
    <Badge variant="success">Publicado</Badge>
  );
}

export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return <Badge variant="warning">Sem categoria</Badge>;
  return <Badge variant="neutral">{category}</Badge>;
}

import type { ReactNode } from 'react';

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__description">{description}</p>
      {action}
    </div>
  );
}

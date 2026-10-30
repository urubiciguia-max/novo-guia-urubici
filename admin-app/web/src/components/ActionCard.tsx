import type { ReactNode } from 'react';

export function ActionCard({
  icon,
  title,
  description,
  onClick,
  primary = false,
  disabled = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`action-card card${primary ? ' action-card--primary' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
    >
      <div className="action-card__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="action-card__title">{title}</p>
      <p className="action-card__description">{description}</p>
      {disabled && <span className="action-card__soon">Em breve</span>}
    </button>
  );
}

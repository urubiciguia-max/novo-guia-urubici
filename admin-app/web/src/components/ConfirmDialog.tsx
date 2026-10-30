import { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Descrição da consequência da ação -- nomeia o item afetado explicitamente. */
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `true` (default) pinta o botão de confirmar como ação destrutiva. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal de confirmação reusável -- regra do DS: toda ação destrutiva passa
 * por aqui, nunca `confirm()` nativo (ver `~/.claude/rules/design-system-obrigatorio.md`).
 *
 * Acessibilidade:
 *  - `role="alertdialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`.
 *  - Esc fecha (equivalente a cancelar).
 *  - Foco vai pro botão CANCELAR ao abrir (ação seguro por padrão -- evita
 *    confirmar destrutivo por Enter acidental) e VOLTA pro elemento que
 *    disparou o diálogo ao fechar.
 *  - Clique no backdrop = cancelar.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
      cancelRef.current?.focus();
    } else if (triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="dialog__title">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="dialog__description">
          {description}
        </p>
        <div className="dialog__actions">
          <button type="button" ref={cancelRef} className="btn btn--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={destructive ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

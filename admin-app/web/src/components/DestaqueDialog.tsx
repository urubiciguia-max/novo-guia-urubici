import { useEffect, useRef, useState, type RefObject } from 'react';
import type { DestaqueType } from '../lib/markdownToolbarActions';

export interface DestaqueDialogProps {
  open: boolean;
  /** Texto pré-preenchido no campo "Texto do destaque" ao abrir -- a seleção
   *  do textarea no momento em que o item "Destaque (caixa colorida)" foi
   *  escolhido no dropdown Inserir (vazio se não havia seleção). Só é lido
   *  quando `open` passa a `true` -- mesmo padrão do `LinkDialog`. */
  initialText: string;
  /**
   * Ref do botão "Inserir" (gatilho do `ToolbarDropdown`) -- pra onde o
   * foco volta ao fechar (confirmar ou cancelar). Diferente do `LinkDialog`
   * (que captura `document.activeElement` no momento em que abre), este
   * modal é aberto a partir de um ITEM de dentro do dropdown "Inserir", e
   * esse item desmonta no mesmo clique que fecha o menu e abre o modal --
   * o elemento que estava focado deixa de existir no DOM, então precisamos
   * de uma referência explícita pro botão-gatilho do dropdown (que continua
   * montado) em vez de confiar em `document.activeElement`.
   */
  returnFocusRef: RefObject<HTMLElement | null>;
  onConfirm: (type: DestaqueType, text: string) => void;
  onCancel: () => void;
}

const OPTIONS: Array<{ value: DestaqueType; icon: string; label: string }> = [
  { value: 'dica', icon: '💡', label: 'Dica' },
  { value: 'atencao', icon: '⚠️', label: 'Atenção' },
  { value: 'importante', icon: '❗', label: 'Importante' },
];

/**
 * Modal "Inserir destaque" do item "Destaque (caixa colorida)" no dropdown
 * Inserir da `MarkdownToolbar` -- reaproveita a MESMA estrutura/padrão
 * visual do `LinkDialog` (backdrop, `role="dialog"`, Esc fecha, clique no
 * backdrop fecha, foco inicial no primeiro campo), mas com um grupo de
 * rádios (tipo) + textarea (corpo, pode ter mais de uma linha/parágrafo) em
 * vez de 2 inputs de texto. Monta a sintaxe `> [!TIPO]` que
 * `remark-destaque.mjs` (site publicado) reconhece como caixa "Destaque" --
 * ver documentação da convenção no topo de `remark-destaque.mjs`. No editor
 * rich-text (`MarkdownToolbar.tsx`, `handleDestaqueConfirm`) isso aparece
 * como citação simples, sem cor/ícone ao vivo -- formatação ao vivo pra
 * este bloco é SHOULD, não MUST, nesta entrega (ver
 * `lib/markdownToolbarActions.ts`).
 */
export function DestaqueDialog({ open, initialText, returnFocusRef, onConfirm, onCancel }: DestaqueDialogProps) {
  const [type, setType] = useState<DestaqueType>('dica');
  const [text, setText] = useState('');
  const firstRadioRef = useRef<HTMLInputElement>(null);
  /** Diferente do `LinkDialog`/`ConfirmDialog` (cujo `triggerRef` nasce
   *  `null` e só é preenchido dentro do `if (open)`), o `returnFocusRef`
   *  aqui vem de FORA já apontando pra um botão real no DOM desde antes
   *  deste componente montar -- então o `else` abaixo não pode usar
   *  "`returnFocusRef.current` existe" como sinal de "estava aberto e
   *  fechou", ou dispara `.focus()` (e o scroll que vem junto) no mount
   *  inicial, sem o modal nunca ter aberto. `wasOpenRef` guarda
   *  explicitamente "este efeito já viu `open === true`", só autorizando
   *  a devolução de foco na transição real `true -> false`. */
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      setType('dica');
      setText(initialText);
      firstRadioRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      returnFocusRef.current?.focus();
    }
    // Só reage à abertura/fechamento (`open`) -- `initialText` é lido uma
    // vez no momento em que o modal abre, não deve re-sincronizar enquanto
    // o usuário já está editando o campo (mesmo cuidado do `LinkDialog`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const canSubmit = text.trim() !== '';

  function handleConfirm() {
    if (!canSubmit) return;
    onConfirm(type, text);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog dialog--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="destaque-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="destaque-dialog-title" className="dialog__title">
          Inserir destaque
        </h2>

        <fieldset className="form-field radio-group-field">
          <legend>Tipo de destaque</legend>
          <div className="radio-group">
            {OPTIONS.map((option, index) => (
              <label key={option.value} className={`radio-option radio-option--${option.value}`}>
                <input
                  ref={index === 0 ? firstRadioRef : undefined}
                  type="radio"
                  name="destaque-type"
                  value={option.value}
                  checked={type === option.value}
                  onChange={() => setType(option.value)}
                />
                <span aria-hidden="true">{option.icon}</span> {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="form-field">
          <span>Texto do destaque</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
        </label>

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" onClick={handleConfirm} disabled={!canSubmit}>
            Inserir
          </button>
        </div>
      </div>
    </div>
  );
}

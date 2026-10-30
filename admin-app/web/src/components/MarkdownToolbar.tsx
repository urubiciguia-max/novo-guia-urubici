import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  applyHeading,
  applyLink,
  applyLinePrefix,
  wrapInline,
  type SelectionResult,
} from '../lib/markdownToolbarActions';
import {
  BoldIcon,
  BulletListIcon,
  ChevronDownIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  ParagraphStyleIcon,
  PlusIcon,
  QuoteIcon,
} from './icons';

export interface MarkdownToolbarProps {
  /** Ref do `<textarea>` que a toolbar edita -- precisa ler `selectionStart`/
   *  `selectionEnd` ao vivo no momento do clique (por isso ref, não só o valor). */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  /** Devolve o resultado da transformação (texto novo + onde a seleção deve
   *  ficar) pro componente pai aplicar -- quem possui `form.body` e o
   *  reposicionamento de foco/cursor é o `PostFormPage`, não esta toolbar. */
  onApply: (result: SelectionResult) => void;
}

type Transform = (text: string, start: number, end: number) => SelectionResult;

interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

/**
 * Toolbar de formatação markdown acima do campo "Conteúdo do artigo" --
 * estilo editor do GitHub: insere sintaxe markdown na posição do cursor do
 * textarea (não é WYSIWYG contenteditable). Fica visível só no modo Editar
 * (`PostFormPage` não renderiza isto quando `previewMode` é true).
 */
export function MarkdownToolbar({ textareaRef, value, onApply }: MarkdownToolbarProps) {
  function runTransform(transform: Transform) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onApply(transform(value, start, end));
  }

  return (
    <div className="md-toolbar" role="toolbar" aria-label="Formatação do texto">
      <button
        type="button"
        className="md-toolbar__btn"
        aria-label="Negrito"
        onClick={() => runTransform((t, s, e) => wrapInline(t, s, e, '**'))}
      >
        <BoldIcon />
      </button>
      <button
        type="button"
        className="md-toolbar__btn"
        aria-label="Itálico"
        onClick={() => runTransform((t, s, e) => wrapInline(t, s, e, '*'))}
      >
        <ItalicIcon />
      </button>
      <button
        type="button"
        className="md-toolbar__btn"
        aria-label="Código inline"
        onClick={() => runTransform((t, s, e) => wrapInline(t, s, e, '`'))}
      >
        <InlineCodeIcon />
      </button>
      <button type="button" className="md-toolbar__btn" aria-label="Link" onClick={() => runTransform(applyLink)}>
        <LinkIcon />
      </button>

      <span className="md-toolbar__separator" aria-hidden="true" />

      <ToolbarDropdown
        triggerLabel="Parágrafo"
        triggerIcon={<ParagraphStyleIcon />}
        ariaLabel="Estilo de parágrafo"
        items={[
          { label: 'Parágrafo', onSelect: () => runTransform((t, s) => applyHeading(t, s, 0)) },
          { label: 'Título H2', onSelect: () => runTransform((t, s) => applyHeading(t, s, 2)) },
          { label: 'Título H3', onSelect: () => runTransform((t, s) => applyHeading(t, s, 3)) },
        ]}
      />

      <ToolbarDropdown
        triggerLabel="Inserir"
        triggerIcon={<PlusIcon />}
        ariaLabel="Inserir elemento"
        items={[
          {
            label: 'Lista com marcadores',
            icon: <BulletListIcon />,
            onSelect: () => runTransform((t, s, e) => applyLinePrefix(t, s, e, 'bullet')),
          },
          {
            label: 'Lista numerada',
            icon: <NumberedListIcon />,
            onSelect: () => runTransform((t, s, e) => applyLinePrefix(t, s, e, 'numbered')),
          },
          {
            label: 'Citação',
            icon: <QuoteIcon />,
            onSelect: () => runTransform((t, s, e) => applyLinePrefix(t, s, e, 'quote')),
          },
        ]}
      />
    </div>
  );
}

interface ToolbarDropdownProps {
  triggerLabel: string;
  /** Ícone mostrado sempre no gatilho -- em telas estreitas o texto do
   *  label some (ver `.md-toolbar__btn-label` em index.css) e só ícone +
   *  chevron ficam visíveis, então o gatilho precisa de um ícone próprio
   *  (diferente dos ícones dos itens do menu, que só aparecem abertos). */
  triggerIcon: ReactNode;
  ariaLabel: string;
  items: DropdownItem[];
}

/**
 * Dropdown simples (disclosure pattern -- botão que revela um grupo de
 * botões comuns, não um `role="menu"` com navegação por seta). Escolha
 * deliberada: o critério de a11y pedido é "navegável via Tab + Enter/Space"
 * (ver handoff), que botões nativos já satisfazem sozinhos -- implementar
 * `role="menu"`/`menuitem` de verdade exigiria roving tabindex + setas pra
 * não violar WAI-ARIA Authoring Practices, o que é mais do que foi pedido.
 */
function ToolbarDropdown({ triggerLabel, triggerIcon, ariaLabel, items }: ToolbarDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="md-toolbar__dropdown" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="md-toolbar__btn md-toolbar__btn--dropdown"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {triggerIcon}
        <span className="md-toolbar__btn-label">{triggerLabel}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="md-toolbar__menu" role="group" aria-label={ariaLabel}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="md-toolbar__menu-item"
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

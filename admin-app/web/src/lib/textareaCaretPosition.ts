/**
 * Calcula a posição em pixels de um offset de caractere dentro de um
 * `<textarea>` -- e, a partir disso, onde o menu flutuante de seleção
 * (`MarkdownToolbar.tsx`) deve aparecer. Não existe API nativa pra isso num
 * textarea puro (diferente de contenteditable, que tem
 * `Range.getBoundingClientRect()`): é a técnica clássica de "mirror div" --
 * cria um `<div>` invisível fora da tela, copia as propriedades de fonte/
 * espaçamento do textarea que afetam quebra de linha, e mede onde um
 * `<span>` marcador cai dentro dele. Mesma ideia da lib "textarea-caret-
 * position" (Component/Dan Harrington), implementação própria e reduzida ao
 * que o menu flutuante precisa -- projeto não tem (nem precisa de) dependência
 * nova pra isso (ver `package.json`).
 *
 * Nota de teste: jsdom não roda um motor de layout de verdade -- `offsetTop`/
 * `offsetLeft` do span sempre voltam 0 lá, então os testes (`test/
 * textareaCaretPosition.test.ts`) não verificam valor de pixel exato, só que
 * a função roda sem lançar erro, limpa o mirror div do DOM, e que o
 * resultado de `computeSelectionMenuPosition` fica dentro da viewport.
 */

export interface CaretCoordinates {
  top: number;
  left: number;
  height: number;
}

// Propriedades CSS (kebab-case, pra usar com `getPropertyValue`/`setProperty`
// e não precisar indexar `CSSStyleDeclaration` por nome arbitrário -- esse
// tipo não tem índice genérico por string, só os nomes conhecidos +
// `getPropertyValue`/`setProperty`/índice numérico) que afetam onde o texto
// quebra linha ou se desloca dentro do textarea.
const MIRRORED_PROPERTIES = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-transform',
  'word-spacing',
  'text-indent',
  'white-space',
  'line-height',
  'tab-size',
] as const;

/** Mede a posição (top/left relativos ao canto superior-esquerdo do próprio
 *  textarea, em px) do caractere na posição `position` do texto atual. */
export function getCaretCoordinates(el: HTMLTextAreaElement, position: number): CaretCoordinates {
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.top = '0';
  div.style.left = '-9999px';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';

  const computed = window.getComputedStyle(el);
  for (const prop of MIRRORED_PROPERTIES) {
    div.style.setProperty(prop, computed.getPropertyValue(prop));
  }

  document.body.appendChild(div);

  div.textContent = el.value.slice(0, position);

  const span = document.createElement('span');
  // Texto depois do caret -- garante que o span tenha largura mesmo no fim
  // do texto (string vazia não teria `offsetTop`/`offsetLeft` confiáveis em
  // todo browser).
  span.textContent = el.value.slice(position) || '.';
  div.appendChild(span);

  const coordinates: CaretCoordinates = {
    top: span.offsetTop + parseInt(computed.getPropertyValue('border-top-width') || '0', 10),
    left: span.offsetLeft + parseInt(computed.getPropertyValue('border-left-width') || '0', 10),
    height: span.offsetHeight || parseInt(computed.getPropertyValue('line-height') || '0', 10) || 20,
  };

  document.body.removeChild(div);

  return coordinates;
}

export interface FloatingMenuPosition {
  top: number;
  left: number;
}

const MENU_GAP = 8; // px entre a seleção e o menu flutuante
// Chute conservador de tamanho do menu (4 botões pequenos) só pra manter a
// posição calculada dentro da viewport -- a largura/altura reais são 100% do
// CSS (`.md-selection-menu`), este valor não precisa ser exato.
const MENU_ESTIMATED_WIDTH = 180;
const MENU_ESTIMATED_HEIGHT = 44;
const VIEWPORT_MARGIN = 8;

/** Posição (fixed, relativa à viewport) onde o menu flutuante de seleção
 *  deve aparecer pra uma seleção [selectionStart, selectionEnd] do textarea
 *  `el`. Por padrão fica ACIMA do início da seleção (pedido do handoff); se
 *  não houver espaço no topo da viewport, inverte pra ficar abaixo -- mesmo
 *  "flip" que editores tipo Notion/Medium usam pra nunca cortar o menu. */
export function computeSelectionMenuPosition(
  el: HTMLTextAreaElement,
  selectionStart: number,
  selectionEnd: number,
): FloatingMenuPosition {
  const startCoords = getCaretCoordinates(el, selectionStart);
  const sameLine = !el.value.slice(selectionStart, selectionEnd).includes('\n');
  const endCoords = sameLine ? getCaretCoordinates(el, selectionEnd) : startCoords;

  const rect = el.getBoundingClientRect();
  const anchorTop = rect.top - el.scrollTop + startCoords.top;
  const anchorLeftStart = rect.left - el.scrollLeft + startCoords.left;
  const anchorLeftEnd = rect.left - el.scrollLeft + endCoords.left;
  // Centraliza horizontalmente sobre a seleção (meio do primeiro ao último
  // caractere na mesma linha); seleção multi-linha usa só o início, não daria
  // pra centralizar sobre algo que não é um segmento reto.
  const anchorLeft = (anchorLeftStart + anchorLeftEnd) / 2;
  const caretHeight = startCoords.height;

  const above = anchorTop - MENU_ESTIMATED_HEIGHT - MENU_GAP;
  const top = above >= VIEWPORT_MARGIN ? above : anchorTop + caretHeight + MENU_GAP;

  const maxLeft = Math.max(window.innerWidth - MENU_ESTIMATED_WIDTH - VIEWPORT_MARGIN, VIEWPORT_MARGIN);
  const left = Math.min(Math.max(anchorLeft - MENU_ESTIMATED_WIDTH / 2, VIEWPORT_MARGIN), maxLeft);

  return { top, left };
}

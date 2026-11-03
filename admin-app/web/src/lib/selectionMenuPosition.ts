/**
 * Posição (viewport, `position: fixed`) onde o menu flutuante de seleção
 * (`components/MarkdownToolbar.tsx`) deve aparecer pra uma seleção
 * [from, to] do editor TipTap.
 *
 * Substitui o `lib/textareaCaretPosition.ts` da era textarea (deletado nesta
 * migração): aquele precisava da técnica de "mirror div" pra medir onde um
 * caractere caía dentro de um `<textarea>` cru (sem API nativa pra isso).
 * Contenteditable/ProseMirror já expõe isso de fábrica via
 * `EditorView.coordsAtPos(pos)` -- devolve o retângulo (em coordenadas de
 * viewport, as mesmas que `getBoundingClientRect()`) do caractere numa
 * posição do documento. Zero hack, zero DOM temporário.
 */
import type { EditorView } from '@tiptap/pm/view';

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
 *  deve aparecer pra uma seleção [from, to] do documento do editor. Por
 *  padrão fica ACIMA do início da seleção (pedido do handoff original); se
 *  não houver espaço no topo da viewport, inverte pra ficar abaixo -- mesmo
 *  "flip" que editores tipo Notion/Medium usam pra nunca cortar o menu.
 *
 *  Nota de robustez: `coordsAtPos` depende de `Range.getClientRects()`, que
 *  jsdom NÃO implementa (lança `TypeError`) -- então sob teste (e, por
 *  segurança, em qualquer situação real onde a posição vire inválida no
 *  meio de uma transação) a função nunca propaga esse erro: cai num
 *  fallback fixo (ver `catch` abaixo) em vez de quebrar a toolbar inteira.
 *  Testes (`test/MarkdownToolbar.test.tsx`) não verificam valor de pixel
 *  exato, só que o menu aparece e o resultado fica dentro da viewport. */
export function computeSelectionMenuPosition(view: EditorView, from: number, to: number): FloatingMenuPosition {
  try {
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(Math.max(to - 1, from));

    // Centraliza horizontalmente sobre o trecho selecionado. Pra seleção
    // multi-linha isso ainda cai num ponto razoável (meio do primeiro ao
    // último caractere, mesmo que não formem um segmento reto) -- mesma
    // simplificação que a implementação anterior (baseada em textarea) já
    // assumia.
    const anchorLeft = (start.left + end.right) / 2;

    const above = start.top - MENU_ESTIMATED_HEIGHT - MENU_GAP;
    const top = above >= VIEWPORT_MARGIN ? above : start.bottom + MENU_GAP;

    const maxLeft = Math.max(window.innerWidth - MENU_ESTIMATED_WIDTH - VIEWPORT_MARGIN, VIEWPORT_MARGIN);
    const left = Math.min(Math.max(anchorLeft - MENU_ESTIMATED_WIDTH / 2, VIEWPORT_MARGIN), maxLeft);

    return { top, left };
  } catch {
    return { top: VIEWPORT_MARGIN, left: VIEWPORT_MARGIN };
  }
}

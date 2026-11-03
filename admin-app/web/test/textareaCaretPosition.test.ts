import { afterEach, describe, expect, it } from 'vitest';
import { computeSelectionMenuPosition, getCaretCoordinates } from '../src/lib/textareaCaretPosition';

/**
 * jsdom não roda um motor de layout de verdade -- `offsetTop`/`offsetLeft`
 * do mirror div sempre voltam 0 lá (ver comentário no topo de
 * `textareaCaretPosition.ts`), então estes testes não verificam valor de
 * pixel exato. O que importa testar neste ambiente:
 *  1. a função roda sem lançar erro pra qualquer offset válido (início,
 *     meio, fim do texto, com e sem quebra de linha);
 *  2. o mirror div criado é removido do DOM depois (não vaza elemento);
 *  3. `computeSelectionMenuPosition` devolve números finitos dentro da
 *     viewport simulada.
 * Verificação de posicionamento pixel-perfect real fica pro teste manual/
 * QA visual (marivone), não dá pra fazer de forma confiável em jsdom.
 */

function makeTextarea(value: string): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.value = value;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('getCaretCoordinates', () => {
  it('devolve coordenadas numéricas pro início, meio e fim do texto', () => {
    const el = makeTextarea('melhores trilhas de Urubici');
    for (const pos of [0, 10, el.value.length]) {
      const coords = getCaretCoordinates(el, pos);
      expect(Number.isFinite(coords.top)).toBe(true);
      expect(Number.isFinite(coords.left)).toBe(true);
      expect(Number.isFinite(coords.height)).toBe(true);
      expect(coords.height).toBeGreaterThan(0);
    }
  });

  it('funciona com texto multi-linha sem lançar erro', () => {
    const el = makeTextarea('linha 1\nlinha 2\nlinha 3');
    expect(() => getCaretCoordinates(el, el.value.indexOf('linha 3'))).not.toThrow();
  });

  it('não deixa o mirror div vazando no DOM depois de medir', () => {
    const el = makeTextarea('texto qualquer');
    const before = document.body.childElementCount;
    getCaretCoordinates(el, 5);
    expect(document.body.childElementCount).toBe(before);
  });

  it('string vazia não lança erro', () => {
    const el = makeTextarea('');
    expect(() => getCaretCoordinates(el, 0)).not.toThrow();
  });
});

describe('computeSelectionMenuPosition', () => {
  it('devolve top/left finitos e dentro da viewport pra uma seleção numa linha só', () => {
    const el = makeTextarea('veja as melhores trilhas de Urubici');
    const pos = computeSelectionMenuPosition(el, 8, 25); // "melhores trilhas"

    expect(Number.isFinite(pos.top)).toBe(true);
    expect(Number.isFinite(pos.left)).toBe(true);
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.left).toBeLessThanOrEqual(window.innerWidth);
  });

  it('seleção multi-linha não lança erro (usa só o início como âncora)', () => {
    const el = makeTextarea('primeira linha\nsegunda linha\nterceira linha');
    expect(() => computeSelectionMenuPosition(el, 5, el.value.length - 5)).not.toThrow();
  });
});

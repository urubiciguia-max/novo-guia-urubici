import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// `globals: false` no vitest.config.ts -> o auto-cleanup do Testing Library
// (que depende de um `afterEach` global) não se registra sozinho. Registra
// explícito aqui pra cada teste de componente começar com o DOM limpo.
afterEach(cleanup);

// jsdom (25.x) não implementa NENHUM dos dois em `Range.prototype` --
// diferente de `Element.prototype.getBoundingClientRect`, que jsdom já
// stubba com um retângulo zerado, `Range` não tem nem esse stub (confirmado
// direto: `new JSDOM(...).window.document.createRange().getBoundingClientRect`
// é `undefined`). O editor rich-text (TipTap/ProseMirror, ver
// `components/MarkdownToolbar.tsx`) chama isso toda vez que reposiciona/rola
// a seleção pra view (`EditorView.coordsAtPos`, usado tanto internamente
// pelo TipTap quanto por `lib/selectionMenuPosition.ts`) -- sem o polyfill,
// QUALQUER teste que mude a seleção do editor (ex: clicar num botão da
// toolbar com texto selecionado) lança `TypeError: ...getClientRects/
// getBoundingClientRect is not a function`. `prosemirror-view` já trata
// `rects.length === 0` caindo pra `getBoundingClientRect()` (ver
// `singleRect` em `prosemirror-view/dist/index.js`), então um retângulo
// zerado é suficiente -- não precisamos simular nenhum valor de pixel real
// pra isso não quebrar.
function zeroRect(): DOMRect {
  return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
}

if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = function getClientRects() {
    return [] as unknown as DOMRectList;
  };
}

if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = zeroRect;
}

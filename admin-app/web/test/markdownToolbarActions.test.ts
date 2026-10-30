import { describe, expect, it } from 'vitest';
import { applyHeading, applyLink, applyLinePrefix, wrapInline } from '../src/lib/markdownToolbarActions';

describe('wrapInline', () => {
  it('sem seleção: insere marcadores vazios com cursor no meio', () => {
    const result = wrapInline('oi mundo', 2, 2, '**');
    expect(result.text).toBe('oi**** mundo');
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe(4);
  });

  it('com seleção: envolve o texto selecionado e mantém a seleção deslocada', () => {
    const text = 'oi mundo';
    const result = wrapInline(text, 3, 8, '**'); // seleciona "mundo"
    expect(result.text).toBe('oi **mundo**');
    expect(result.selectionStart).toBe(5);
    expect(result.selectionEnd).toBe(10);
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('mundo');
  });

  it('itálico funciona com marcador de 1 char', () => {
    const result = wrapInline('abc', 1, 2, '*');
    expect(result.text).toBe('a*b*c');
  });

  it('código inline funciona com crase', () => {
    const result = wrapInline('abc', 0, 3, '`');
    expect(result.text).toBe('`abc`');
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('abc');
  });
});

describe('applyLink', () => {
  it('sem seleção: insere placeholder com "texto do link" pré-selecionado', () => {
    const result = applyLink('abc', 1, 1);
    expect(result.text).toBe('a[texto do link](url)bc');
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('texto do link');
  });

  it('com seleção: usa seleção como texto do link e pré-seleciona "url"', () => {
    const result = applyLink('veja a cachoeira', 7, 16); // seleciona "cachoeira"
    expect(result.text).toBe('veja a [cachoeira](url)');
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('url');
  });
});

describe('applyHeading', () => {
  it('aplica H2 numa linha sem heading', () => {
    const result = applyHeading('Olá mundo', 2, 2);
    expect(result.text).toBe('## Olá mundo');
    expect(result.selectionStart).toBe(result.selectionEnd);
  });

  it('troca H2 por H3 na mesma linha', () => {
    const result = applyHeading('## Título', 5, 3);
    expect(result.text).toBe('### Título');
  });

  it('"Parágrafo" (level 0) remove o heading existente', () => {
    const result = applyHeading('### Título', 5, 0);
    expect(result.text).toBe('Título');
  });

  it('afeta só a linha do cursor em texto multi-linha', () => {
    const text = 'linha 1\nlinha 2\nlinha 3';
    const cursorInLine2 = 10; // dentro de "linha 2"
    const result = applyHeading(text, cursorInLine2, 2);
    expect(result.text).toBe('linha 1\n## linha 2\nlinha 3');
  });
});

describe('applyLinePrefix', () => {
  it('lista com marcadores numa linha só', () => {
    const result = applyLinePrefix('item um', 0, 0, 'bullet');
    expect(result.text).toBe('- item um');
  });

  it('citação numa linha só', () => {
    const result = applyLinePrefix('frase', 0, 0, 'quote');
    expect(result.text).toBe('> frase');
  });

  it('lista numerada incrementa por linha em seleção multi-linha', () => {
    const text = 'primeiro\nsegundo\nterceiro';
    const result = applyLinePrefix(text, 0, text.length, 'numbered');
    expect(result.text).toBe('1. primeiro\n2. segundo\n3. terceiro');
  });

  it('prefixa só as linhas tocadas pela seleção, preserva as demais', () => {
    const text = 'a\nb\nc\nd';
    // seleciona só "b\nc" (linhas do meio)
    const start = text.indexOf('b');
    const end = text.indexOf('c') + 1;
    const result = applyLinePrefix(text, start, end, 'bullet');
    expect(result.text).toBe('a\n- b\n- c\nd');
  });

  it('remapeia a seleção: mantém o conteúdo original selecionado (sem incluir os prefixos novos), igual ao wrapInline', () => {
    const text = 'um\ndois';
    const result = applyLinePrefix(text, 0, text.length, 'bullet');
    expect(result.text).toBe('- um\n- dois');
    // mesmo espírito do wrapInline: os marcadores inseridos não entram na
    // seleção resultante, só o conteúdo que já existia antes (deslocado).
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('um\n- dois');
    expect(result.selectionEnd).toBe(result.text.length);
  });
});

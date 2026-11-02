import { describe, expect, it } from 'vitest';
import {
  applyHeading,
  applyLinePrefix,
  buildLinkMarkdown,
  insertLinkMarkdown,
  wrapInline,
} from '../src/lib/markdownToolbarActions';
import { renderMarkdownPreview } from '../src/lib/markdownPreview';

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

describe('buildLinkMarkdown', () => {
  it('monta [texto](url) com URL já com protocolo', () => {
    expect(buildLinkMarkdown('cachoeira', 'https://example.com')).toBe('[cachoeira](https://example.com)');
  });

  it('normaliza URL sem protocolo pra https:// (mesma regra do Preview -- `resolveLinkHref`)', () => {
    expect(buildLinkMarkdown('site', 'guiaurubici.com.br/pagina')).toBe(
      '[site](https://guiaurubici.com.br/pagina)',
    );
    expect(buildLinkMarkdown('site', 'www.site.com.br')).toBe('[site](https://www.site.com.br)');
  });

  it('esquema explícito não-http(s) não é bloqueado aqui (só o Preview filtra pra proteger o innerHTML)', () => {
    expect(buildLinkMarkdown('contato', 'mailto:contato@example.com')).toBe(
      '[contato](mailto:contato@example.com)',
    );
  });
});

describe('insertLinkMarkdown (confirmação do modal "Inserir link")', () => {
  it('sem seleção original: insere [texto](url) na posição do cursor, cursor colapsado no fim do link', () => {
    const result = insertLinkMarkdown('ab', 1, 1, 'cachoeira', 'https://example.com');
    expect(result.text).toBe('a[cachoeira](https://example.com)b');
    expect(result.selectionStart).toBe(result.selectionEnd);
    expect(result.selectionStart).toBe(1 + '[cachoeira](https://example.com)'.length);
  });

  it('com seleção original: substitui o intervalo [start, end] guardado no clique do botão Link', () => {
    const text = 'veja a cachoeira';
    const result = insertLinkMarkdown(text, 7, 16, 'cachoeira', 'https://example.com'); // "cachoeira" selecionado
    expect(result.text).toBe('veja a [cachoeira](https://example.com)');
  });

  it('"Texto" editado no modal pode diferir da seleção original -- usa o que está no campo, não a seleção', () => {
    const text = 'veja a cachoeira';
    const result = insertLinkMarkdown(text, 7, 16, 'a cachoeira linda', 'https://example.com');
    expect(result.text).toBe('veja a [a cachoeira linda](https://example.com)');
  });

  it('normaliza URL sem protocolo igual buildLinkMarkdown', () => {
    const result = insertLinkMarkdown('', 0, 0, 'site', 'guiaurubici.com.br/pagina');
    expect(result.text).toBe('[site](https://guiaurubici.com.br/pagina)');
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

  it('aplica H4 numa linha sem heading', () => {
    const result = applyHeading('Olá mundo', 2, 4);
    expect(result.text).toBe('#### Olá mundo');
    expect(result.selectionStart).toBe(result.selectionEnd);
  });

  it('troca H3 por H4 na mesma linha (sem duplicar #)', () => {
    const result = applyHeading('### Título', 5, 4);
    expect(result.text).toBe('#### Título');
  });

  it('troca H4 por H2 na mesma linha (sem duplicar #)', () => {
    const result = applyHeading('#### Título', 6, 2);
    expect(result.text).toBe('## Título');
  });

  it('"Parágrafo" (level 0) remove o heading existente', () => {
    const result = applyHeading('### Título', 5, 0);
    expect(result.text).toBe('Título');
  });

  it('"Parágrafo" (level 0) remove um heading H4 existente', () => {
    const result = applyHeading('#### Título', 6, 0);
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

describe('bug Marivone (QA feat-admin-body-toolbar): integração toolbar -> preview', () => {
  // Reprodução exata do bug report: clicar num botão da toolbar sem
  // seleção e ir direto pro Preview não pode mostrar sintaxe crua (critério
  // de pronto do handoff original) nem renderizar HTML errado.

  it('Link via modal: markdown inserido já nasce reconhecível pelo Preview como <a>', () => {
    const result = insertLinkMarkdown('', 0, 0, 'cachoeira', 'https://example.com');
    expect(result.text).toBe('[cachoeira](https://example.com)');
    expect(renderMarkdownPreview(result.text)).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">cachoeira</a></p>',
    );
  });

  it('Link via modal: URL digitada sem protocolo (cenário de usuário não-técnico) também renderiza como <a>', () => {
    const result = insertLinkMarkdown('', 0, 0, 'cachoeira', 'guiaurubici.com.br/pagina');
    expect(result.text).toBe('[cachoeira](https://guiaurubici.com.br/pagina)');
    expect(renderMarkdownPreview(result.text)).toBe(
      '<p><a href="https://guiaurubici.com.br/pagina" target="_blank" rel="noopener noreferrer">cachoeira</a></p>',
    );
    expect(renderMarkdownPreview('[site](www.site.com.br)')).toBe(
      '<p><a href="https://www.site.com.br" target="_blank" rel="noopener noreferrer">site</a></p>',
    );
  });

  it('Negrito sem seleção (****): Preview não produz <em>*</em>* (renderização errada)', () => {
    const result = wrapInline('', 0, 0, '**');
    expect(result.text).toBe('****');
    const html = renderMarkdownPreview(result.text);
    expect(html).not.toContain('<em>*</em>*');
    expect(html).toBe('<p><strong></strong></p>');
  });

  it('Itálico sem seleção (**): Preview não quebra (fica vazio, não crua errada)', () => {
    const result = wrapInline('', 0, 0, '*');
    expect(result.text).toBe('**');
    expect(renderMarkdownPreview(result.text)).toBe('<p><em></em></p>');
  });

  it('Código inline sem seleção (``): Preview fica cru, aceitável pra esse caso extremo', () => {
    const result = wrapInline('', 0, 0, '`');
    expect(result.text).toBe('``');
    expect(renderMarkdownPreview(result.text)).toBe('<p>``</p>');
  });
});

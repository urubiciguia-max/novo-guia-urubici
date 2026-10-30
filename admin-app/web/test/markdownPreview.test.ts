import { describe, expect, it } from 'vitest';
import { renderMarkdownPreview } from '../src/lib/markdownPreview';

describe('renderMarkdownPreview', () => {
  it('escapa HTML antes de qualquer transformação (nunca injeta script)', () => {
    const html = renderMarkdownPreview('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('converte cabeçalhos', () => {
    expect(renderMarkdownPreview('# Título\n## Subtítulo')).toBe('<h1>Título</h1>\n<h2>Subtítulo</h2>');
  });

  it('converte bold e itálico', () => {
    const html = renderMarkdownPreview('isto é **forte** e isto é *itálico*');
    expect(html).toContain('<strong>forte</strong>');
    expect(html).toContain('<em>itálico</em>');
  });

  it('bug Marivone: negrito vazio (****, botão Negrito sem seleção antes de digitar) não produz HTML quebrado', () => {
    // Antes da correção, "****" não casava o regex de bold (exigia 1+ char
    // de conteúdo) e sobrava pro regex de itálico casar só 3 dos 4
    // asteriscos, produzindo `<em>*</em>*` -- renderização ERRADA, não só
    // crua. Com o fix, bold casa o marcador vazio inteiro primeiro.
    const html = renderMarkdownPreview('****');
    expect(html).not.toBe('<p><em>*</em>*</p>');
    expect(html).toBe('<p><strong></strong></p>');
  });

  it('itálico vazio (**, botão Itálico sem seleção) não produz HTML quebrado', () => {
    const html = renderMarkdownPreview('**');
    expect(html).toBe('<p><em></em></p>');
  });

  it('converte link http(s) com rel seguro', () => {
    const html = renderMarkdownPreview('[clique aqui](https://exemplo.com)');
    expect(html).toContain('href="https://exemplo.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('bug Marivone: placeholder do botão Link ([texto do link](https://url)) renderiza como <a>', () => {
    // Antes da correção o placeholder nascia como `(url)` (sem protocolo) e
    // o regex de link só reconhecia `https?://` explícito -- o Preview
    // mostrava a sintaxe crua em vez de um link, mesmo logo depois de clicar
    // no botão Link sem trocar nada.
    const html = renderMarkdownPreview('[texto do link](https://url)');
    expect(html).toBe('<p><a href="https://url" target="_blank" rel="noopener noreferrer">texto do link</a></p>');
  });

  it('bug Marivone: URL colada sem protocolo (cenário realista de usuário não-técnico) também vira <a>', () => {
    const semProtocolo = renderMarkdownPreview('[cachoeira](guiaurubici.com.br/pagina)');
    expect(semProtocolo).toBe(
      '<p><a href="https://guiaurubici.com.br/pagina" target="_blank" rel="noopener noreferrer">cachoeira</a></p>',
    );

    const comWww = renderMarkdownPreview('[site](www.site.com.br)');
    expect(comWww).toBe('<p><a href="https://www.site.com.br" target="_blank" rel="noopener noreferrer">site</a></p>');
  });

  it('bloqueia esquemas perigosos (javascript:) -- nunca vira href, fica cru como texto', () => {
    const html = renderMarkdownPreview('[clique](javascript:evil)');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href="javascript:');
    expect(html).toBe('<p>[clique](javascript:evil)</p>');
  });

  it('agrupa linhas em parágrafos separados por linha vazia', () => {
    const html = renderMarkdownPreview('linha um\nlinha dois\n\nsegundo parágrafo');
    expect(html).toBe('<p>linha um linha dois</p>\n<p>segundo parágrafo</p>');
  });

  it('código inline vazio (``, botão Código sem seleção) fica cru, sem renderizar errado', () => {
    const html = renderMarkdownPreview('``');
    expect(html).toBe('<p>``</p>');
  });

  it('converte código inline', () => {
    const html = renderMarkdownPreview('roda `npm run build` antes de subir');
    expect(html).toContain('<code>npm run build</code>');
  });

  it('código inline não é afetado por bold/itálico dentro dele', () => {
    // best-effort: código processado antes de bold/itálico (ver comentário
    // no próprio arquivo) -- asteriscos dentro de crases não viram <em>/<strong>.
    const html = renderMarkdownPreview('`*não é itálico*`');
    expect(html).toContain('<code>*não é itálico*</code>');
  });

  it('converte lista com marcadores', () => {
    const html = renderMarkdownPreview('- primeiro\n- segundo');
    expect(html).toBe('<ul><li>primeiro</li><li>segundo</li></ul>');
  });

  it('converte lista numerada', () => {
    const html = renderMarkdownPreview('1. primeiro\n2. segundo');
    expect(html).toBe('<ol><li>primeiro</li><li>segundo</li></ol>');
  });

  it('converte citação', () => {
    const html = renderMarkdownPreview('> uma citação');
    expect(html).toBe('<blockquote><p>uma citação</p></blockquote>');
  });

  it('não mistura lista e parágrafo adjacentes', () => {
    const html = renderMarkdownPreview('texto antes\n- item\ntexto depois');
    expect(html).toBe('<p>texto antes</p>\n<ul><li>item</li></ul>\n<p>texto depois</p>');
  });

  it('escapa HTML dentro de citação (marcador > vira &gt; antes do parse, não quebra a detecção)', () => {
    const html = renderMarkdownPreview('> <script>alert(1)</script>');
    expect(html).toContain('<blockquote><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></blockquote>');
  });
});

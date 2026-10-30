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

  it('converte link http(s) com rel seguro', () => {
    const html = renderMarkdownPreview('[clique aqui](https://exemplo.com)');
    expect(html).toContain('href="https://exemplo.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('agrupa linhas em parágrafos separados por linha vazia', () => {
    const html = renderMarkdownPreview('linha um\nlinha dois\n\nsegundo parágrafo');
    expect(html).toBe('<p>linha um linha dois</p>\n<p>segundo parágrafo</p>');
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

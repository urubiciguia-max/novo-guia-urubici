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
});

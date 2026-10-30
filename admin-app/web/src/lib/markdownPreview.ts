/**
 * Preview "simples" do corpo markdown -- o brief explicitamente NÃO pede
 * WYSIWYG, só textarea + preview. Em vez de puxar uma lib de markdown só
 * pra isso, escapo o HTML primeiro (nunca confiar em `dangerouslySetInnerHTML`
 * com conteúdo não escapado) e aplico um conjunto pequeno e determinístico
 * de transformações (cabeçalhos, bold, itálico, link, parágrafos). Não é um
 * parser completo de CommonMark -- é só pra o editor ter uma ideia visual
 * antes de salvar, o site de produção renderiza o markdown de verdade via
 * Astro (não é esta função que vai pro ar).
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdownPreview(markdown: string): string {
  const escaped = escapeHtml(markdown);

  const withInline = escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const lines = withInline.split(/\r?\n/);
  const html: string[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.join(' ')}</p>`);
      paragraph = [];
    }
  }

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${heading[2]}</h${level}>`);
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();

  return html.join('\n');
}

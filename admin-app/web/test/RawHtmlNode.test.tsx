/**
 * Round-trip do node `rawHtmlBlock` (ver `src/lib/rawHtmlNode.tsx`) --
 * cobre especificamente o design descrito no handoff (`.agents/inbox/
 * francisgleydisson.md`, item 3 "Inserir HTML no corpo"): inserir o node
 * direto (sem passar pelo parser de markdown) -> serializar pra markdown
 * -> alimentar esse markdown de volta num editor novo (SIMULANDO reabrir
 * um post salvo) -> o HTML decodificado tem que ser idêntico byte a byte
 * ao original, inclusive aspas/quebras de linha/tags aninhadas.
 *
 * Também cobre a regressão mais importante desta mudança: `html: true` (ver
 * `markdownEditorExtensions.ts`) não pode fazer um documento SEM nenhum
 * HTML cru round-tripar diferente de antes -- isso já é coberto em
 * `test/markdownRoundtrip.test.ts` (os 5 posts + 4 páginas reais, nenhum
 * tem HTML cru, continuam passando), aqui adicionamos um caso sintético
 * equivalente só pra deixar a intenção explícita neste arquivo também.
 */
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { createMarkdownEditorExtensions } from '../src/lib/markdownEditorExtensions';

function getMarkdown(editor: Editor): string {
  return editor.storage.markdown.getMarkdown();
}

/** Acha o primeiro node `rawHtmlBlock` no doc -- `null` se não tiver nenhum. */
function findRawHtmlBlock(editor: Editor): { html: string } | null {
  let found: { html: string } | null = null;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'rawHtmlBlock') {
      found = { html: node.attrs.html as string };
      return false;
    }
    return true;
  });
  return found;
}

describe('rawHtmlBlock: serialize (doc -> markdown)', () => {
  it('bloco único: serializa o HTML literal, sem nenhuma transformação', () => {
    const html = '<iframe src="https://maps.example.com/urubici" title="Mapa"></iframe>';
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions(''),
      content: { type: 'doc', content: [{ type: 'rawHtmlBlock', attrs: { html } }] },
    });

    expect(getMarkdown(editor)).toBe(html);
    editor.destroy();
  });

  it('bloco de HTML seguido de parágrafo: separados por linha em branco (igual qualquer outro bloco)', () => {
    const html = '<div class="embed">x</div>';
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions(''),
      content: {
        type: 'doc',
        content: [
          { type: 'rawHtmlBlock', attrs: { html } },
          { type: 'paragraph', content: [{ type: 'text', text: 'depois do embed' }] },
        ],
      },
    });

    expect(getMarkdown(editor)).toBe(`${html}\n\ndepois do embed`);
    editor.destroy();
  });

  it('parágrafo seguido de bloco de HTML: mesma separação, ordem invertida', () => {
    const html = '<hr class="custom">';
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions(''),
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'antes do embed' }] },
          { type: 'rawHtmlBlock', attrs: { html } },
        ],
      },
    });

    expect(getMarkdown(editor)).toBe(`antes do embed\n\n${html}`);
    editor.destroy();
  });
});

describe('rawHtmlBlock: round-trip completo (insere -> serializa -> recarrega -> compara)', () => {
  function roundTrip(html: string): string | null {
    const editor1 = new Editor({
      extensions: createMarkdownEditorExtensions(''),
      content: { type: 'doc', content: [{ type: 'rawHtmlBlock', attrs: { html } }] },
    });
    const markdown = getMarkdown(editor1);
    editor1.destroy();

    // Alimenta o markdown serializado de volta -- SIMULA reabrir um post
    // já salvo (`PostFormPage.loadFromServer`, `editor.commands.setContent`).
    // `content: markdown` (STRING) força o caminho real de
    // `MarkdownParser.parse()` -- é aqui que `html: true` +
    // `md.renderer.rules.html_block` sobrescrito entram em jogo.
    const editor2 = new Editor({ extensions: createMarkdownEditorExtensions(''), content: markdown });
    const result = findRawHtmlBlock(editor2);
    editor2.destroy();
    return result?.html ?? null;
  }

  it('HTML simples de uma linha', () => {
    const html = '<iframe src="https://maps.example.com/urubici"></iframe>';
    expect(roundTrip(html)).toBe(html);
  });

  it('HTML com aspas duplas e simples misturadas', () => {
    const html = `<div data-x='single' data-y="double">conteúdo</div>`;
    expect(roundTrip(html)).toBe(html);
  });

  it('HTML multi-linha com tags aninhadas (caso real: embed de mapa)', () => {
    const html = [
      '<div class="mapa-embed">',
      '  <iframe',
      '    src="https://www.google.com/maps/embed?pb=xyz"',
      '    width="600"',
      '    height="450"',
      '    loading="lazy">',
      '  </iframe>',
      '</div>',
    ].join('\n');
    expect(roundTrip(html)).toBe(html);
  });

  it(
    'HTML vazio não quebra o editor -- mas não é um caso real: ' +
      '`HtmlBlockDialog` nunca deixa confirmar com o campo vazio (`canSubmit`), ' +
      'e um bloco html_block vazio não produz token nenhum pro markdown-it reconhecer de volta',
    () => {
      expect(() => roundTrip('')).not.toThrow();
      expect(roundTrip('')).toBeNull();
    },
  );
});

describe('rawHtmlBlock: NodeView no editor (prévia nunca renderiza o HTML de verdade)', () => {
  function Harness({ html, onEditor }: { html: string; onEditor?: (e: Editor) => void }) {
    const [ready, setReady] = useState(false);
    const editor = useEditor({
      extensions: createMarkdownEditorExtensions(''),
      content: { type: 'doc', content: [{ type: 'rawHtmlBlock', attrs: { html } }] },
    });

    useEffect(() => {
      if (editor && !ready) {
        setReady(true);
        onEditor?.(editor);
      }
    }, [editor, ready, onEditor]);

    return <EditorContent editor={editor} />;
  }

  it('mostra a prévia como TEXTO PLANO (sem dangerouslySetInnerHTML -- nenhum <iframe> real no DOM)', () => {
    const html = '<iframe src="https://evil.example.com"></iframe>';
    render(<Harness html={html} />);

    expect(screen.getByText('Bloco de HTML embutido')).toBeInTheDocument();
    // o texto da prévia contém os caracteres `<iframe...>` como STRING --
    // se fosse `dangerouslySetInnerHTML`, não haveria texto `<iframe` visível
    // no DOM (teria virado um elemento `<iframe>` de verdade).
    const pre = document.querySelector('.raw-html-block__preview');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('<iframe src="https://evil.example.com">');
    // nenhum iframe de verdade foi criado
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('prévia corta HTML longo em ~150 caracteres', () => {
    const longHtml = `<div>${'x'.repeat(300)}</div>`;
    render(<Harness html={longHtml} />);
    const pre = document.querySelector('.raw-html-block__preview');
    expect(pre?.textContent?.length).toBeLessThan(longHtml.length);
    expect(pre?.textContent).toContain('…');
  });

  it('botão "Editar" abre o HtmlBlockDialog pré-preenchido e salva via updateAttributes', async () => {
    const user = userEvent.setup();
    let editorRef: Editor | null = null;
    render(<Harness html="<p>original</p>" onEditor={(e) => (editorRef = e)} />);

    await user.click(screen.getByRole('button', { name: 'Editar' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('HTML')).toHaveValue('<p>original</p>');

    await user.clear(within(dialog).getByLabelText('HTML'));
    await user.type(within(dialog).getByLabelText('HTML'), '<p>editado</p>');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(findRawHtmlBlock(editorRef!)).toEqual({ html: '<p>editado</p>' });
    // foco volta pro botão "Editar" deste bloco
    expect(screen.getByRole('button', { name: 'Editar' })).toHaveFocus();
  });
});

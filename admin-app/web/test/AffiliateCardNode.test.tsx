/**
 * Round-trip do node `affiliateCard` (ver `src/lib/affiliateCardNode.tsx`)
 * -- mesmo padrão do extinto `test/RawHtmlNode.test.tsx`: inserir o node
 * direto (sem passar pelo parser de markdown) -> serializar pra markdown ->
 * alimentar esse markdown de volta num editor novo (SIMULANDO reabrir um
 * post salvo) -> os atributos decodificados têm que ser idênticos ao
 * original, inclusive campos com aspas/acentos/URLs com query string.
 *
 * Também cobre a regressão mais importante desta sintaxe (bloco de código
 * cercado com info string própria, ```affiliate-card): um bloco de código
 * cercado NORMAL (``` js, ``` sem linguagem) continua round-tripando igual
 * -- a sobrescrita de `md.renderer.rules.fence` só intercepta quando
 * `info === 'affiliate-card'`, delegando pro renderer padrão em qualquer
 * outro caso (ver comentário grande em `affiliateCardNode.tsx`).
 */
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { createMarkdownEditorExtensions } from '../src/lib/markdownEditorExtensions';
import { DEFAULT_AFFILIATE_CARD_VALUE, type AffiliateCardFormValue } from '../src/lib/affiliateCardShared';

function getMarkdown(editor: Editor): string {
  return editor.storage.markdown.getMarkdown();
}

/** Acha o primeiro node `affiliateCard` no doc -- `null` se não tiver nenhum. */
function findAffiliateCard(editor: Editor): AffiliateCardFormValue | null {
  let found: AffiliateCardFormValue | null = null;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'affiliateCard') {
      found = node.attrs as AffiliateCardFormValue;
      return false;
    }
    return true;
  });
  return found;
}

const SAMPLE: AffiliateCardFormValue = {
  layout: 'vertical',
  image: './hotel-img-abc123.jpg',
  imageAlt: 'Fachada do "La Mansarda Hotel"',
  badgeIcon: 'coracao',
  badgeText: 'Conforto & Charme',
  title: 'La Mansarda Hotel',
  button1Text: '🏨 Reservar Agora',
  button1Url: 'https://booking.example.com/la-mansarda?checkin=2026-12-01&adults=2',
  button1Color: 'green',
  button2Text: '📍 Ver Localização',
  button2Url: 'https://maps.example.com/la-mansarda',
  tip: 'Fica a 5 minutos do centro, com vista pra serra.',
};

describe('affiliateCard: serialize (doc -> markdown)', () => {
  it('bloco único: serializa como fence ```affiliate-card com o JSON dos atributos', () => {
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions(''),
      content: { type: 'doc', content: [{ type: 'affiliateCard', attrs: SAMPLE }] },
    });

    const markdown = getMarkdown(editor);
    expect(markdown.startsWith('```affiliate-card\n')).toBe(true);
    expect(markdown.endsWith('```')).toBe(true);
    const body = markdown.slice('```affiliate-card\n'.length, -'\n```'.length);
    expect(JSON.parse(body)).toEqual(SAMPLE);
    editor.destroy();
  });

  it('bloco seguido de parágrafo: separados por linha em branco (igual qualquer outro bloco)', () => {
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions(''),
      content: {
        type: 'doc',
        content: [
          { type: 'affiliateCard', attrs: SAMPLE },
          { type: 'paragraph', content: [{ type: 'text', text: 'depois do card' }] },
        ],
      },
    });

    const markdown = getMarkdown(editor);
    expect(markdown.endsWith('```\n\ndepois do card')).toBe(true);
    editor.destroy();
  });

  it('parágrafo seguido de bloco: mesma separação, ordem invertida', () => {
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions(''),
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'antes do card' }] },
          { type: 'affiliateCard', attrs: SAMPLE },
        ],
      },
    });

    const markdown = getMarkdown(editor);
    expect(markdown.startsWith('antes do card\n\n```affiliate-card\n')).toBe(true);
    editor.destroy();
  });
});

describe('affiliateCard: round-trip completo (insere -> serializa -> recarrega -> compara)', () => {
  function roundTrip(value: AffiliateCardFormValue): AffiliateCardFormValue | null {
    const editor1 = new Editor({
      extensions: createMarkdownEditorExtensions(''),
      content: { type: 'doc', content: [{ type: 'affiliateCard', attrs: value }] },
    });
    const markdown = getMarkdown(editor1);
    editor1.destroy();

    // Alimenta o markdown serializado de volta -- SIMULA reabrir um post já
    // salvo. `content: markdown` (STRING) força o caminho real de
    // `MarkdownParser.parse()` -- é aqui que o override de
    // `md.renderer.rules.fence` entra em jogo.
    const editor2 = new Editor({ extensions: createMarkdownEditorExtensions(''), content: markdown });
    const result = findAffiliateCard(editor2);
    editor2.destroy();
    return result;
  }

  it('card completo (todos os campos preenchidos, aspas/acentos/query string na URL)', () => {
    expect(roundTrip(SAMPLE)).toEqual(SAMPLE);
  });

  it('card no layout horizontal, sem botão 2 nem dica (campos opcionais vazios)', () => {
    const value: AffiliateCardFormValue = {
      ...SAMPLE,
      layout: 'horizontal',
      badgeIcon: 'escudo',
      button1Color: 'orange',
      button2Text: '',
      button2Url: '',
      tip: '',
    };
    expect(roundTrip(value)).toEqual(value);
  });

  it('cada cor de botão 1 e cada ícone de selo round-tripam', () => {
    const colors: AffiliateCardFormValue['button1Color'][] = ['green', 'blue-dark', 'orange', 'red'];
    const icons: AffiliateCardFormValue['badgeIcon'][] = ['cama', 'coracao', 'escudo', 'estrela', 'local', 'carro'];
    for (const button1Color of colors) {
      expect(roundTrip({ ...SAMPLE, button1Color })?.button1Color).toBe(button1Color);
    }
    for (const badgeIcon of icons) {
      expect(roundTrip({ ...SAMPLE, badgeIcon })?.badgeIcon).toBe(badgeIcon);
    }
  });

  it('bloco de código cercado NORMAL (não affiliate-card) continua intacto -- delegação pro renderer padrão', () => {
    const markdownWithPlainFence = '```js\nconst x = 1;\n```';
    const editor = new Editor({ extensions: createMarkdownEditorExtensions(''), content: markdownWithPlainFence });
    expect(findAffiliateCard(editor)).toBeNull();
    expect(getMarkdown(editor)).toBe(markdownWithPlainFence);
    editor.destroy();
  });
});

describe('affiliateCard: NodeView no editor (prévia fiel, não é placeholder cinza)', () => {
  function Harness({ value, onEditor }: { value: AffiliateCardFormValue; onEditor?: (e: Editor) => void }) {
    const [ready, setReady] = useState(false);
    const editor = useEditor({
      extensions: createMarkdownEditorExtensions(''),
      content: { type: 'doc', content: [{ type: 'affiliateCard', attrs: value }] },
    });

    useEffect(() => {
      if (editor && !ready) {
        setReady(true);
        onEditor?.(editor);
      }
    }, [editor, ready, onEditor]);

    return <EditorContent editor={editor} />;
  }

  it('mostra título, selo e textos dos botões de verdade (não um placeholder genérico)', () => {
    render(<Harness value={SAMPLE} />);

    expect(screen.getByText('Card de Afiliado')).toBeInTheDocument();
    expect(screen.getByText('La Mansarda Hotel')).toBeInTheDocument();
    expect(screen.getByText(/Conforto & Charme/)).toBeInTheDocument();
    expect(screen.getByText('🏨 Reservar Agora')).toBeInTheDocument();
    expect(screen.getByText('📍 Ver Localização')).toBeInTheDocument();
  });

  it('botão "Editar" abre o AffiliateCardDialog pré-preenchido e salva via updateAttributes', async () => {
    const user = userEvent.setup();
    let editorRef: Editor | null = null;
    render(<Harness value={SAMPLE} onEditor={(e) => (editorRef = e)} />);

    await user.click(screen.getByRole('button', { name: 'Editar' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Título')).toHaveValue('La Mansarda Hotel');

    await user.clear(within(dialog).getByLabelText('Título'));
    await user.type(within(dialog).getByLabelText('Título'), 'Novo título editado');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(findAffiliateCard(editorRef!)).toEqual({ ...SAMPLE, title: 'Novo título editado' });
    // foco volta pro botão "Editar" deste bloco
    expect(screen.getByRole('button', { name: 'Editar' })).toHaveFocus();
  });

  it('card com valores default (recém-inserido, sem imagem/texto) não quebra o editor', () => {
    expect(() => render(<Harness value={DEFAULT_AFFILIATE_CARD_VALUE} />)).not.toThrow();
    expect(screen.getByText('Card de Afiliado')).toBeInTheDocument();
  });
});

import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { MarkdownToolbar } from '../src/components/MarkdownToolbar';
import { createMarkdownEditorExtensions } from '../src/lib/markdownEditorExtensions';

/**
 * Harness que reproduz a fiação real feita em `PostFormPage.tsx`: o editor
 * TipTap (via `useEditor`) + a toolbar, ambos recebendo a MESMA instância
 * de `editor`. `onEditor` expõe a instância pro teste poder ler
 * `editor.storage.markdown.getMarkdown()` (fonte da verdade do conteúdo,
 * não existe mais um `value`/`onApply` controlado por fora -- ver
 * `MarkdownToolbarProps`) e mover a seleção programaticamente
 * (`editor.commands.setTextSelection`), já que jsdom não simula arrasto de
 * mouse em contenteditable de forma confiável.
 */
function Harness({ initialMarkdown = '', onEditor }: { initialMarkdown?: string; onEditor?: (e: Editor) => void }) {
  const [ready, setReady] = useState(false);
  const editor = useEditor({
    extensions: createMarkdownEditorExtensions('Escreva aqui...'),
    content: initialMarkdown,
    editorProps: { attributes: { class: 'post-form__body', id: 'test-body' } },
  });

  useEffect(() => {
    if (editor && !ready) {
      setReady(true);
      onEditor?.(editor);
    }
  }, [editor, ready, onEditor]);

  return (
    <div>
      <MarkdownToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function renderHarness(initialMarkdown = '') {
  let editor: Editor = null as unknown as Editor;
  render(<Harness initialMarkdown={initialMarkdown} onEditor={(e) => (editor = e)} />);
  return () => editor;
}

function markdown(getEditor: () => Editor): string {
  return getEditor().storage.markdown.getMarkdown();
}

/** Seleciona [from, to] no documento do editor -- equivalente ao "arrastar
 *  o mouse sobre um trecho" da era textarea, mas via API do ProseMirror
 *  (jsdom não tem motor de layout pra simular arrasto de verdade num
 *  contenteditable). Envolto em `act` porque dispara os listeners de
 *  `selectionUpdate` que atualizam estado do React (menu flutuante). */
function selectRange(getEditor: () => Editor, from: number, to: number) {
  act(() => {
    // Foca o DOM nativamente (`view.dom.focus()`), NÃO via
    // `editor.commands.focus()` -- o comando do TipTap adia o `.focus()`
    // de verdade pra um `requestAnimationFrame` (ver `delayedFocus` em
    // `@tiptap/core`), que não roda sincronamente dentro de um `act()` de
    // teste. No uso real (clique/teclado do usuário), quem foca o
    // contenteditable é o PRÓPRIO NAVEGADOR nativamente, igual aqui --
    // `editor.commands.focus()` só importa pra foco PROGRAMÁTICO (ex:
    // reabrir o menu flutuante via Alt+Enter), não pra esta simulação de
    // "usuário selecionou um trecho".
    getEditor().view.dom.focus();
    getEditor().commands.setTextSelection({ from, to });
  });
}

function getSelectionMenu() {
  return screen.getByRole('group', { name: 'Formatação rápida da seleção' });
}

function querySelectionMenu() {
  return screen.queryByRole('group', { name: 'Formatação rápida da seleção' });
}

/** Toolbar fixa (`role="toolbar"`) -- escopo necessário pros botões que têm
 *  um equivalente de mesmo `aria-label` no menu flutuante de seleção (ex:
 *  "Link" existe nos dois lugares; com uma seleção não vazia ativa, os dois
 *  ficam montados ao mesmo tempo e `getByRole` sem escopo acha os dois). */
function getToolbar() {
  return screen.getByRole('toolbar', { name: 'Formatação do texto' });
}

describe('MarkdownToolbar', () => {
  it('todos os controles de nível superior têm aria-label', () => {
    renderHarness();
    expect(screen.getByRole('button', { name: 'Negrito' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Itálico' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Código inline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Estilo de parágrafo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inserir elemento' })).toBeInTheDocument();
  });

  it('Negrito com seleção envolve o trecho em **; clicar de novo remove (toggle de verdade)', async () => {
    const user = userEvent.setup();
    const getEditor = renderHarness('oi mundo');
    selectRange(getEditor, 1, 3); // "oi"

    await user.click(screen.getByRole('button', { name: 'Negrito' }));
    expect(markdown(getEditor)).toBe('**oi** mundo');
    expect(screen.getByRole('button', { name: 'Negrito' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Negrito' }));
    expect(markdown(getEditor)).toBe('oi mundo');
    expect(screen.getByRole('button', { name: 'Negrito' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Itálico com seleção', async () => {
    const user = userEvent.setup();
    const getEditor = renderHarness('oi mundo');
    selectRange(getEditor, 1, 3);

    await user.click(screen.getByRole('button', { name: 'Itálico' }));
    expect(markdown(getEditor)).toBe('*oi* mundo');
  });

  it('Código inline com seleção', async () => {
    const user = userEvent.setup();
    const getEditor = renderHarness('use npm aqui');
    const start = 'use '.length + 1; // posições do doc: 1-based, "u" de "npm"
    selectRange(getEditor, start, start + 3);

    await user.click(screen.getByRole('button', { name: 'Código inline' }));
    expect(markdown(getEditor)).toBe('use `npm` aqui');
  });

  it('Dropdown Parágrafo: aplica H2/H3/H4 e remove heading (Parágrafo)', async () => {
    const user = userEvent.setup();
    const getEditor = renderHarness('Título qualquer');
    selectRange(getEditor, 1, 1);

    await user.click(screen.getByRole('button', { name: 'Estilo de parágrafo' }));
    await user.click(screen.getByRole('button', { name: 'Título H2' }));
    expect(markdown(getEditor)).toBe('## Título qualquer');

    await user.click(screen.getByRole('button', { name: 'Estilo de parágrafo' }));
    await user.click(screen.getByRole('button', { name: 'Título H3' }));
    expect(markdown(getEditor)).toBe('### Título qualquer');

    await user.click(screen.getByRole('button', { name: 'Estilo de parágrafo' }));
    await user.click(screen.getByRole('button', { name: 'Título H4' }));
    expect(markdown(getEditor)).toBe('#### Título qualquer');

    await user.click(screen.getByRole('button', { name: 'Estilo de parágrafo' }));
    await user.click(screen.getByRole('button', { name: 'Parágrafo' }));
    expect(markdown(getEditor)).toBe('Título qualquer');
  });

  it('H1 não existe como opção no dropdown Parágrafo (mesma regra de sempre -- H1 é do frontmatter)', async () => {
    const user = userEvent.setup();
    renderHarness('x');
    await user.click(screen.getByRole('button', { name: 'Estilo de parágrafo' }));
    const menu = screen.getByRole('group', { name: 'Estilo de parágrafo' });
    expect(within(menu).queryByText(/título h1/i)).not.toBeInTheDocument();
  });

  it('Dropdown Inserir: lista com marcadores, lista numerada e citação', async () => {
    const user = userEvent.setup();
    const getEditor = renderHarness('item um');
    selectRange(getEditor, 1, 1);

    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    await user.click(screen.getByRole('button', { name: 'Lista com marcadores' }));
    expect(markdown(getEditor)).toBe('- item um');

    // alterna de volta pra parágrafo antes de testar o próximo (toggle)
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    await user.click(screen.getByRole('button', { name: 'Lista com marcadores' }));
    expect(markdown(getEditor)).toBe('item um');

    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    await user.click(screen.getByRole('button', { name: 'Lista numerada' }));
    expect(markdown(getEditor)).toBe('1. item um');

    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    await user.click(screen.getByRole('button', { name: 'Lista numerada' }));

    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    await user.click(screen.getByRole('button', { name: 'Citação' }));
    expect(markdown(getEditor)).toBe('> item um');
  });

  it('Link com seleção: usa o texto selecionado como label do modal e aplica a marca no range original', async () => {
    const user = userEvent.setup();
    const getEditor = renderHarness('veja a cachoeira');
    const start = 'veja a '.length + 1;
    selectRange(getEditor, start, start + 'cachoeira'.length);

    await user.click(within(getToolbar()).getByRole('button', { name: 'Link' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Texto')).toHaveValue('cachoeira');

    await user.type(within(dialog).getByLabelText('URL'), 'guiaurubici.com.br/cachoeira');
    await user.click(within(dialog).getByRole('button', { name: 'Inserir' }));

    expect(markdown(getEditor)).toBe('veja a [cachoeira](https://guiaurubici.com.br/cachoeira)');
  });

  it('Link sem seleção: insere no cursor com o texto digitado no modal', async () => {
    const user = userEvent.setup();
    const getEditor = renderHarness('ab');
    selectRange(getEditor, 2, 2); // cursor entre "a" e "b"

    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Texto'), 'cachoeira');
    await user.type(within(dialog).getByLabelText('URL'), 'https://example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Inserir' }));

    expect(markdown(getEditor)).toBe('a[cachoeira](https://example.com)b');
  });

  it('Destaque (SHOULD, não MUST): monta a sintaxe `> [!TIPO]` e insere como citação no editor', async () => {
    const user = userEvent.setup();
    const getEditor = renderHarness('ab');
    selectRange(getEditor, 2, 2);

    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    await user.click(screen.getByRole('button', { name: 'Destaque (caixa colorida)' }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Texto do destaque'), 'cuidado com a trilha');
    await user.click(within(dialog).getByRole('button', { name: 'Inserir' }));

    // colchetes do marcador vêm escapados na serialização (texto puro com
    // `[`/`]`) -- seguro pro `remark-destaque.mjs` do site, que resolve o
    // escape de volta ao reler (ver test/markdownRoundtrip.test.ts, caso
    // "bloco Destaque"). O importante aqui é que nada se perde.
    expect(markdown(getEditor)).toContain('DICA');
    expect(markdown(getEditor)).toContain('cuidado com a trilha');
    expect(markdown(getEditor)).toContain('>');
    // devolve o foco pro gatilho "Inserir" depois de fechar (mesmo
    // comportamento do DestaqueDialog, já coberto em DestaqueDialog.test.tsx
    // isoladamente -- aqui só confirmamos que a fiação não quebrou).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inserir elemento' })).toHaveFocus());
  });

  it('menu flutuante aparece com seleção não vazia e some sem seleção', () => {
    const getEditor = renderHarness('oi mundo grande');
    expect(querySelectionMenu()).not.toBeInTheDocument();

    selectRange(getEditor, 1, 3);
    expect(getSelectionMenu()).toBeInTheDocument();

    selectRange(getEditor, 4, 4);
    expect(querySelectionMenu()).not.toBeInTheDocument();
  });

  it('menu flutuante: H2/H3/H4 e Link, com aria-label', () => {
    const getEditor = renderHarness('oi mundo');
    selectRange(getEditor, 1, 3);
    const menu = getSelectionMenu();
    expect(within(menu).getByRole('button', { name: 'Título H2' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Título H3' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Título H4' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Link' })).toBeInTheDocument();
  });

  it('menu flutuante: clicar H2 aplica o heading e fecha o menu', async () => {
    const user = userEvent.setup();
    const getEditor = renderHarness('titulo aqui');
    selectRange(getEditor, 1, 1);

    const menu = getSelectionMenu.bind(null);
    selectRange(getEditor, 1, 7); // "titulo"
    await user.click(within(getSelectionMenu()).getByRole('button', { name: 'Título H2' }));

    expect(markdown(getEditor)).toBe('## titulo aqui');
    expect(querySelectionMenu()).not.toBeInTheDocument();
    void menu;
  });

  it('Alt+Enter na PRIMEIRA seleção (sem Esc prévio) já foca o primeiro botão do menu', async () => {
    // Regressão do bug reportado pela Marivone em QA (2026-11-03): o menu
    // flutuante já aparece sozinho quando o usuário seleciona texto (ver
    // `syncFromSelection`), ou seja `floatingMenuVisible` já é `true` ANTES
    // do Alt+Enter ser pressionado aqui. O mecanismo antigo (`focusMenuOnShowRef`
    // + efeito dependente só de `floatingMenuVisible`) só focava o botão
    // quando esse booleano fazia a transição false -> true -- que não
    // acontece neste caminho (já era true), então o foco nunca ia pro botão
    // na primeira seleção, só depois de um Esc prévio (ver teste abaixo).
    // Agora o gatilho é `focusRequestId` (contador que SEMPRE muda a cada
    // Alt+Enter), então este caminho precisa funcionar sem nenhum Esc antes.
    const getEditor = renderHarness('oi mundo');
    selectRange(getEditor, 1, 3);
    expect(getSelectionMenu()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Enter', altKey: true });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Título H2' })).toHaveFocus());
  });

  it('Alt+Enter reabre o menu flutuante (mesmo depois de fechado com Esc) e foca o primeiro botão', async () => {
    const getEditor = renderHarness('oi mundo');
    selectRange(getEditor, 1, 3);
    expect(getSelectionMenu()).toBeInTheDocument();

    // Fecha primeiro -- este teste cobre especificamente o caminho PÓS-Esc
    // (que já funcionava antes da correção); o caminho da primeira seleção,
    // sem Esc, está coberto no teste anterior.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(querySelectionMenu()).not.toBeInTheDocument());

    fireEvent.keyDown(document, { key: 'Enter', altKey: true });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Título H2' })).toHaveFocus());
  });

  it('Alt+Enter pressionado duas vezes em seguida (sem Esc) continua focando o botão', async () => {
    // Garante que o contador `focusRequestId` não "satura": duas chamadas
    // consecutivas de Alt+Enter, ambas sem o menu nunca ter sido fechado,
    // devem focar o botão nas duas vezes -- não só na primeira.
    const getEditor = renderHarness('oi mundo');
    selectRange(getEditor, 1, 3);
    expect(getSelectionMenu()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Enter', altKey: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Título H2' })).toHaveFocus());

    // Move o foco embora de propósito pra garantir que o 2o Alt+Enter é
    // quem traz ele de volta (não um acidente de o foco já estar lá) --
    // pro handler de Alt+Enter processar a tecla, o foco precisa continuar
    // dentro do editor OU do próprio menu flutuante (ver `onKeyDown` em
    // `MarkdownToolbar.tsx`), por isso move pra outro botão do MENU (H3),
    // não pra toolbar fixa.
    screen.getByRole('button', { name: 'Título H3' }).focus();
    expect(screen.getByRole('button', { name: 'Título H2' })).not.toHaveFocus();

    fireEvent.keyDown(document, { key: 'Enter', altKey: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Título H2' })).toHaveFocus());
  });

  it('Alt+Enter sem seleção (cursor colapsado) não abre o menu', () => {
    const getEditor = renderHarness('oi mundo');
    selectRange(getEditor, 3, 3);

    fireEvent.keyDown(document, { key: 'Enter', altKey: true });

    expect(querySelectionMenu()).not.toBeInTheDocument();
  });

  it('Esc fecha o menu flutuante e devolve o foco pro editor', async () => {
    const getEditor = renderHarness('oi mundo');
    selectRange(getEditor, 1, 3);
    expect(getSelectionMenu()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(querySelectionMenu()).not.toBeInTheDocument());
  });

  it('clicar fora do editor e do menu fecha o menu flutuante', () => {
    const getEditor = renderHarness('oi mundo');
    selectRange(getEditor, 1, 3);
    expect(getSelectionMenu()).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(querySelectionMenu()).not.toBeInTheDocument();
  });

  it('editor null (ainda não montado): botões ficam desabilitados, sem quebrar', () => {
    render(<MarkdownToolbar editor={null} />);
    expect(screen.getByRole('button', { name: 'Negrito' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Estilo de parágrafo' })).toBeDisabled();
  });

  it('dropdowns fecham com Escape e devolvem o foco pro gatilho', async () => {
    const user = userEvent.setup();
    renderHarness('x');
    const trigger = screen.getByRole('button', { name: 'Estilo de parágrafo' });
    await user.click(trigger);
    expect(screen.getByRole('group', { name: 'Estilo de parágrafo' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Estilo de parágrafo' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('não quebra o uso em DestaqueDialog aberto sem seleção prévia (regression Marivone 2026-11-03: sem foco/scroll roubado no mount)', () => {
    renderHarness('');
    // mesmo bug relatado pro `insertTriggerRef`: no mount, sem nenhuma
    // interação, o botão "Inserir" não deveria estar focado sozinho.
    expect(screen.getByRole('button', { name: 'Inserir elemento' })).not.toHaveFocus();
  });
});

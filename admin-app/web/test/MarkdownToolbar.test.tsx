import { useLayoutEffect, useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MarkdownToolbar } from '../src/components/MarkdownToolbar';
import { renderMarkdownPreview } from '../src/lib/markdownPreview';
import type { SelectionResult } from '../src/lib/markdownToolbarActions';

/**
 * Harness que reproduz a fiação real feita em `PostFormPage.tsx`: um
 * textarea controlado + a toolbar, onde `onApply` escreve o texto novo e
 * reposiciona seleção/foco via `useLayoutEffect` (ver `pendingSelectionRef`
 * lá). Testar contra esse harness, não só funções puras isoladas, é o que
 * garante que o requisito #9 do handoff ("foco/cursor corretos após
 * qualquer inserção") realmente se sustenta integrado ao DOM.
 */
function Harness({ initialValue = '' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    const el = textareaRef.current;
    if (!pending || !el) return;
    el.focus();
    el.setSelectionRange(pending.start, pending.end);
    pendingRef.current = null;
  }, [value]);

  function onApply(result: SelectionResult) {
    pendingRef.current = { start: result.selectionStart, end: result.selectionEnd };
    setValue(result.text);
  }

  return (
    <div>
      <MarkdownToolbar textareaRef={textareaRef} value={value} onApply={onApply} />
      <textarea ref={textareaRef} aria-label="corpo" value={value} onChange={(e) => setValue(e.target.value)} />
    </div>
  );
}

function selectRange(el: HTMLTextAreaElement, start: number, end: number) {
  el.focus();
  el.setSelectionRange(start, end);
}

/** Mesma seleção de `selectRange`, mas dispara o `mouseup` que o menu
 *  flutuante escuta de verdade pra detectar seleção (ver efeito em
 *  `MarkdownToolbar.tsx`) -- `setSelectionRange` sozinho não emite nenhum
 *  evento no jsdom (nem emitiria num browser real: é uma seleção
 *  simulada/instantânea, não um gesto de mouse/teclado). */
function selectRangeViaMouse(el: HTMLTextAreaElement, start: number, end: number) {
  selectRange(el, start, end);
  fireEvent.mouseUp(el);
}

function getSelectionMenu() {
  return screen.getByRole('group', { name: 'Formatação rápida da seleção' });
}

function querySelectionMenu() {
  return screen.queryByRole('group', { name: 'Formatação rápida da seleção' });
}

describe('MarkdownToolbar', () => {
  it('todos os controles de nível superior têm aria-label', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Negrito' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Itálico' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Código inline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Estilo de parágrafo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inserir elemento' })).toBeInTheDocument();
  });

  it('Negrito sem seleção insere marcadores vazios com cursor no meio e mantém o foco', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 0, 0);

    await user.click(screen.getByRole('button', { name: 'Negrito' }));

    expect(textarea.value).toBe('****');
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
  });

  it('Negrito com seleção envolve o texto selecionado e mantém o foco no textarea', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="texto importante" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 6, 16); // "importante"

    await user.click(screen.getByRole('button', { name: 'Negrito' }));

    expect(textarea.value).toBe('texto **importante**');
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('importante');
  });

  it('Link sem seleção abre modal vazio, foco no campo URL, Inserir desabilitado', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 0, 0);

    await user.click(screen.getByRole('button', { name: 'Link' }));

    const dialog = screen.getByRole('dialog', { name: 'Inserir link' });
    const urlInput = within(dialog).getByLabelText('URL') as HTMLInputElement;
    const textInput = within(dialog).getByLabelText('Texto') as HTMLInputElement;
    expect(urlInput.value).toBe('');
    expect(textInput.value).toBe('');
    await waitFor(() => expect(urlInput).toHaveFocus());
    expect(within(dialog).getByRole('button', { name: 'Inserir' })).toBeDisabled();
    // textarea não muda enquanto o modal só está aberto, sem confirmar.
    expect(textarea.value).toBe('');
  });

  it('Link com seleção pré-preenche "Texto" com a seleção, "URL" continua vazio', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="veja a cachoeira" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 7, 16); // "cachoeira"

    await user.click(screen.getByRole('button', { name: 'Link' }));

    const dialog = screen.getByRole('dialog', { name: 'Inserir link' });
    expect((within(dialog).getByLabelText('Texto') as HTMLInputElement).value).toBe('cachoeira');
    expect((within(dialog).getByLabelText('URL') as HTMLInputElement).value).toBe('');
  });

  it('Inserir fica desabilitado até URL e Texto estarem preenchidos', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="" />);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = screen.getByRole('dialog', { name: 'Inserir link' });
    const insertBtn = within(dialog).getByRole('button', { name: 'Inserir' });

    expect(insertBtn).toBeDisabled();
    await user.type(within(dialog).getByLabelText('URL'), 'https://example.com');
    expect(insertBtn).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Texto'), 'cachoeira');
    expect(insertBtn).not.toBeDisabled();
  });

  it('Inserir monta [Texto](URL) na posição onde a seleção estava quando o modal abriu, fecha o modal e devolve o foco pro botão Link', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="veja a cachoeira" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 7, 16); // "cachoeira"
    const linkBtn = screen.getByRole('button', { name: 'Link' });

    await user.click(linkBtn);
    const dialog = screen.getByRole('dialog', { name: 'Inserir link' });
    await user.type(within(dialog).getByLabelText('URL'), 'guiaurubici.com.br/trilha');
    await user.click(within(dialog).getByRole('button', { name: 'Inserir' }));

    expect(screen.queryByRole('dialog', { name: 'Inserir link' })).not.toBeInTheDocument();
    expect(textarea.value).toBe('veja a [cachoeira](https://guiaurubici.com.br/trilha)');
    // Foco volta pro botão Link (mesmo padrão do ConfirmDialog: volta pro
    // elemento que abriu o diálogo) -- não pro textarea.
    await waitFor(() => expect(linkBtn).toHaveFocus());
  });

  it('Cancelar fecha o modal sem alterar o textarea e devolve o foco pro botão Link', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="veja a cachoeira" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 7, 16);
    const linkBtn = screen.getByRole('button', { name: 'Link' });

    await user.click(linkBtn);
    const dialog = screen.getByRole('dialog', { name: 'Inserir link' });
    await user.type(within(dialog).getByLabelText('URL'), 'https://example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog', { name: 'Inserir link' })).not.toBeInTheDocument();
    expect(textarea.value).toBe('veja a cachoeira');
    await waitFor(() => expect(linkBtn).toHaveFocus());
  });

  it('Esc fecha o modal de link sem alterar o textarea e devolve o foco pro botão Link', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="veja a cachoeira" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 7, 16);
    const linkBtn = screen.getByRole('button', { name: 'Link' });

    await user.click(linkBtn);
    expect(screen.getByRole('dialog', { name: 'Inserir link' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Inserir link' })).not.toBeInTheDocument();
    expect(textarea.value).toBe('veja a cachoeira');
    await waitFor(() => expect(linkBtn).toHaveFocus());
  });

  it('clique no backdrop fecha o modal de link sem alterar o textarea', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="veja a cachoeira" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 7, 16);

    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = screen.getByRole('dialog', { name: 'Inserir link' });
    const backdrop = dialog.parentElement as HTMLElement;
    await user.click(backdrop);

    expect(screen.queryByRole('dialog', { name: 'Inserir link' })).not.toBeInTheDocument();
    expect(textarea.value).toBe('veja a cachoeira');
  });

  it('dropdown Parágrafo abre, aplica H2 na linha do cursor e fecha o menu', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="Minha seção" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 3, 3);

    await user.click(screen.getByRole('button', { name: 'Estilo de parágrafo' }));
    const menu = screen.getByRole('group', { name: 'Estilo de parágrafo' });
    await user.click(within(menu).getByRole('button', { name: 'Título H2' }));

    expect(textarea.value).toBe('## Minha seção');
    expect(screen.queryByRole('group', { name: 'Estilo de parágrafo' })).not.toBeInTheDocument();
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('dropdown Parágrafo não lista H1, mas lista H2/H3/H4 nessa ordem', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Estilo de parágrafo' }));
    const menu = screen.getByRole('group', { name: 'Estilo de parágrafo' });
    expect(within(menu).queryByText(/^Título H1$/)).not.toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Parágrafo' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Título H2' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Título H3' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Título H4' })).toBeInTheDocument();

    const labels = within(menu)
      .getAllByRole('button')
      .map((btn) => btn.textContent);
    expect(labels).toEqual(['Parágrafo', 'Título H2', 'Título H3', 'Título H4']);
  });

  it('dropdown Parágrafo aplica H4 na linha do cursor', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="Minha seção" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 3, 3);

    await user.click(screen.getByRole('button', { name: 'Estilo de parágrafo' }));
    const menu = screen.getByRole('group', { name: 'Estilo de parágrafo' });
    await user.click(within(menu).getByRole('button', { name: 'Título H4' }));

    expect(textarea.value).toBe('#### Minha seção');
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('dropdown Inserir aplica lista com marcadores em seleção multi-linha', async () => {
    const user = userEvent.setup();
    const text = 'primeira linha\nsegunda linha';
    render(<Harness initialValue={text} />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 0, text.length);

    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    const menu = screen.getByRole('group', { name: 'Inserir elemento' });
    await user.click(within(menu).getByRole('button', { name: /Lista com marcadores/ }));

    expect(textarea.value).toBe('- primeira linha\n- segunda linha');
  });

  it('Esc fecha o dropdown e devolve o foco pro botão que abriu', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Inserir elemento' });
    await user.click(trigger);
    expect(screen.getByRole('group', { name: 'Inserir elemento' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group', { name: 'Inserir elemento' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('clicar fora fecha o dropdown', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness />
        <button>fora</button>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    expect(screen.getByRole('group', { name: 'Inserir elemento' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'fora' }));

    expect(screen.queryByRole('group', { name: 'Inserir elemento' })).not.toBeInTheDocument();
  });

  describe('Menu flutuante de seleção (H2/H3/H4 + Link ao marcar texto)', () => {
    it('não aparece sem seleção (seleção colapsada no mouseup)', async () => {
      render(<Harness initialValue="melhores trilhas" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRangeViaMouse(textarea, 3, 3);

      expect(querySelectionMenu()).not.toBeInTheDocument();
    });

    it('aparece ao selecionar texto via mouseup, com H2/H3/H4 e Link', () => {
      render(<Harness initialValue="melhores trilhas de Urubici" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRangeViaMouse(textarea, 0, 16); // "melhores trilhas"

      const menu = getSelectionMenu();
      expect(within(menu).getByRole('button', { name: 'Título H2' })).toBeInTheDocument();
      expect(within(menu).getByRole('button', { name: 'Título H3' })).toBeInTheDocument();
      expect(within(menu).getByRole('button', { name: 'Título H4' })).toBeInTheDocument();
      expect(within(menu).getByRole('button', { name: 'Link' })).toBeInTheDocument();
    });

    it('aparece também ao selecionar via teclado (keyup com seleção não vazia)', () => {
      render(<Harness initialValue="melhores trilhas de Urubici" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRange(textarea, 0, 16);
      fireEvent.keyUp(textarea, { key: 'ArrowLeft', shiftKey: true });

      expect(querySelectionMenu()).toBeInTheDocument();
    });

    it('H2 no menu flutuante aplica o heading na linha do cursor e fecha o menu', async () => {
      const user = userEvent.setup();
      render(<Harness initialValue="Melhores trilhas" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRangeViaMouse(textarea, 0, 8); // "Melhores"

      await user.click(within(getSelectionMenu()).getByRole('button', { name: 'Título H2' }));

      expect(textarea.value).toBe('## Melhores trilhas');
      expect(querySelectionMenu()).not.toBeInTheDocument();
      await waitFor(() => expect(textarea).toHaveFocus());
    });

    it('H4 no menu flutuante aplica o heading', async () => {
      const user = userEvent.setup();
      render(<Harness initialValue="Melhores trilhas" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRangeViaMouse(textarea, 0, 8);

      await user.click(within(getSelectionMenu()).getByRole('button', { name: 'Título H4' }));

      expect(textarea.value).toBe('#### Melhores trilhas');
    });

    it('Link no menu flutuante abre o LinkDialog pré-preenchido com a seleção e fecha o menu', async () => {
      const user = userEvent.setup();
      render(<Harness initialValue="veja a cachoeira" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRangeViaMouse(textarea, 7, 16); // "cachoeira"

      await user.click(within(getSelectionMenu()).getByRole('button', { name: 'Link' }));

      expect(querySelectionMenu()).not.toBeInTheDocument();
      const dialog = screen.getByRole('dialog', { name: 'Inserir link' });
      expect((within(dialog).getByLabelText('Texto') as HTMLInputElement).value).toBe('cachoeira');

      await user.type(within(dialog).getByLabelText('URL'), 'https://example.com');
      await user.click(within(dialog).getByRole('button', { name: 'Inserir' }));
      expect(textarea.value).toBe('veja a [cachoeira](https://example.com)');
    });

    it('Esc fecha o menu flutuante sem alterar o texto e devolve o foco pro textarea', () => {
      render(<Harness initialValue="melhores trilhas" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRangeViaMouse(textarea, 0, 8);
      expect(querySelectionMenu()).toBeInTheDocument();

      fireEvent.keyDown(textarea, { key: 'Escape' });

      expect(querySelectionMenu()).not.toBeInTheDocument();
      expect(textarea.value).toBe('melhores trilhas');
      expect(textarea).toHaveFocus();
    });

    it('clicar fora (fora do textarea e do menu) fecha o menu flutuante', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <Harness initialValue="melhores trilhas" />
          <button>fora</button>
        </div>,
      );
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRangeViaMouse(textarea, 0, 8);
      expect(querySelectionMenu()).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'fora' }));

      expect(querySelectionMenu()).not.toBeInTheDocument();
    });

    it('Alt+Enter com seleção ativa foca o primeiro botão do menu (reabre mesmo depois de um Esc)', () => {
      render(<Harness initialValue="melhores trilhas" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRangeViaMouse(textarea, 0, 8);
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(querySelectionMenu()).not.toBeInTheDocument();

      fireEvent.keyDown(textarea, { key: 'Enter', altKey: true });

      const menu = getSelectionMenu();
      expect(within(menu).getByRole('button', { name: 'Título H2' })).toHaveFocus();
    });

    it('Alt+Enter sem seleção (cursor colapsado) não abre o menu', () => {
      render(<Harness initialValue="melhores trilhas" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRange(textarea, 3, 3);

      fireEvent.keyDown(textarea, { key: 'Enter', altKey: true });

      expect(querySelectionMenu()).not.toBeInTheDocument();
    });
  });

  describe('Destaque (caixa colorida)', () => {
    async function openDestaqueDialog(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
      const menu = screen.getByRole('group', { name: 'Inserir elemento' });
      await user.click(within(menu).getByRole('button', { name: /Destaque \(caixa colorida\)/ }));
      return screen.getByRole('dialog', { name: 'Inserir destaque' });
    }

    it('item "Destaque (caixa colorida)" existe no dropdown Inserir', async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
      const menu = screen.getByRole('group', { name: 'Inserir elemento' });
      expect(within(menu).getByRole('button', { name: /Destaque \(caixa colorida\)/ })).toBeInTheDocument();
    });

    it('sem seleção: abre com "Dica" marcada por padrão, texto vazio, foco no primeiro rádio, Inserir desabilitado', async () => {
      const user = userEvent.setup();
      render(<Harness initialValue="" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRange(textarea, 0, 0);

      const dialog = await openDestaqueDialog(user);

      const dicaRadio = within(dialog).getByRole('radio', { name: /Dica/ }) as HTMLInputElement;
      expect(dicaRadio.checked).toBe(true);
      await waitFor(() => expect(dicaRadio).toHaveFocus());
      expect((within(dialog).getByLabelText('Texto do destaque') as HTMLTextAreaElement).value).toBe('');
      expect(within(dialog).getByRole('button', { name: 'Inserir' })).toBeDisabled();
    });

    it('com seleção: pré-preenche "Texto do destaque" com a seleção', async () => {
      const user = userEvent.setup();
      render(<Harness initialValue="acesso com barro em dias de chuva" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRange(textarea, 0, textarea.value.length);

      const dialog = await openDestaqueDialog(user);

      expect((within(dialog).getByLabelText('Texto do destaque') as HTMLTextAreaElement).value).toBe(
        'acesso com barro em dias de chuva',
      );
    });

    it('Inserir fica desabilitado até o texto estar preenchido (tipo já nasce com "Dica" marcada)', async () => {
      const user = userEvent.setup();
      render(<Harness />);
      const dialog = await openDestaqueDialog(user);
      const insertBtn = within(dialog).getByRole('button', { name: 'Inserir' });

      expect(insertBtn).toBeDisabled();
      await user.type(within(dialog).getByLabelText('Texto do destaque'), 'cuidado com a trilha');
      expect(insertBtn).not.toBeDisabled();
    });

    it('escolher "Atenção" + preencher texto + Inserir monta "> [!ATENCAO]\\n> texto", fecha o modal e devolve o foco pro botão Inserir', async () => {
      const user = userEvent.setup();
      render(<Harness initialValue="" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRange(textarea, 0, 0);
      const insertTrigger = screen.getByRole('button', { name: 'Inserir elemento' });

      const dialog = await openDestaqueDialog(user);
      await user.click(within(dialog).getByRole('radio', { name: /Atenção/ }));
      await user.type(within(dialog).getByLabelText('Texto do destaque'), 'acesso escorregadio na chuva');
      await user.click(within(dialog).getByRole('button', { name: 'Inserir' }));

      expect(screen.queryByRole('dialog', { name: 'Inserir destaque' })).not.toBeInTheDocument();
      expect(textarea.value).toBe('> [!ATENCAO]\n> acesso escorregadio na chuva');
      // Foco volta pro botão "Inserir" da toolbar (gatilho do dropdown), não
      // pro textarea nem pro item de menu (que já desmontou) -- ver comentário
      // do `returnFocusRef` em DestaqueDialog.tsx.
      await waitFor(() => expect(insertTrigger).toHaveFocus());
    });

    it('Cancelar fecha o modal sem alterar o textarea e devolve o foco pro botão Inserir', async () => {
      const user = userEvent.setup();
      render(<Harness initialValue="texto original" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      const insertTrigger = screen.getByRole('button', { name: 'Inserir elemento' });

      const dialog = await openDestaqueDialog(user);
      await user.type(within(dialog).getByLabelText('Texto do destaque'), 'algo');
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('dialog', { name: 'Inserir destaque' })).not.toBeInTheDocument();
      expect(textarea.value).toBe('texto original');
      await waitFor(() => expect(insertTrigger).toHaveFocus());
    });

    it('Esc fecha o modal de destaque sem alterar o textarea e devolve o foco pro botão Inserir', async () => {
      const user = userEvent.setup();
      render(<Harness initialValue="texto original" />);
      const insertTrigger = screen.getByRole('button', { name: 'Inserir elemento' });

      await openDestaqueDialog(user);
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog', { name: 'Inserir destaque' })).not.toBeInTheDocument();
      await waitFor(() => expect(insertTrigger).toHaveFocus());
    });

    it('markdown inserido pelo fluxo completo da UI já nasce reconhecível pelo Preview como caixa colorida', async () => {
      const user = userEvent.setup();
      render(<Harness initialValue="" />);
      const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
      selectRange(textarea, 0, 0);

      const dialog = await openDestaqueDialog(user);
      await user.type(within(dialog).getByLabelText('Texto do destaque'), 'leve água e protetor solar');
      await user.click(within(dialog).getByRole('button', { name: 'Inserir' }));

      expect(textarea.value).toBe('> [!DICA]\n> leve água e protetor solar');
      expect(renderMarkdownPreview(textarea.value)).toBe(
        '<div class="destaque destaque--dica">' +
          '<p class="destaque__label"><span aria-hidden="true">💡</span> Dica</p>' +
          '<p>leve água e protetor solar</p>' +
          '</div>',
      );
    });
  });
});

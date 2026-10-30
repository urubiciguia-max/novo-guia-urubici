import { useLayoutEffect, useRef, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MarkdownToolbar } from '../src/components/MarkdownToolbar';
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

  it('Link sem seleção pré-seleciona "texto do link" pra sobrescrever', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 0, 0);

    await user.click(screen.getByRole('button', { name: 'Link' }));

    expect(textarea.value).toBe('[texto do link](url)');
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('texto do link');
  });

  it('Link com seleção usa a seleção como texto e pré-seleciona "url"', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="veja a cachoeira" />);
    const textarea = screen.getByLabelText('corpo') as HTMLTextAreaElement;
    selectRange(textarea, 7, 16); // "cachoeira"

    await user.click(screen.getByRole('button', { name: 'Link' }));

    expect(textarea.value).toBe('veja a [cachoeira](url)');
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('url');
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

  it('dropdown Parágrafo não lista H1', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Estilo de parágrafo' }));
    const menu = screen.getByRole('group', { name: 'Estilo de parágrafo' });
    expect(within(menu).queryByText(/^Título H1$/)).not.toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Parágrafo' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Título H2' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Título H3' })).toBeInTheDocument();
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
});

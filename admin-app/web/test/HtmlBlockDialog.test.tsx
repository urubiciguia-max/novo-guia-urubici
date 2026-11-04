import { useRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HtmlBlockDialog } from '../src/components/HtmlBlockDialog';

/**
 * Harness com um botão-gatilho real já montado no DOM ANTES do diálogo
 * abrir -- mesmo padrão do `DestaqueDialog.test.tsx` (`returnFocusRef`
 * explícito, não captura de `document.activeElement`), porque este
 * diálogo tem dois chamadores reais com essa mesma exigência: o item
 * "Inserir HTML" do dropdown (desmonta no clique) e o botão "Editar" de
 * `RawHtmlBlockView` (nunca desmonta, mas é outro ref).
 */
function Harness({
  initialHtml = '',
  onConfirm,
}: {
  initialHtml?: string;
  onConfirm: (html: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Inserir elemento
      </button>
      <HtmlBlockDialog
        open={open}
        initialHtml={initialHtml}
        returnFocusRef={triggerRef}
        onConfirm={(html) => {
          onConfirm(html);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

describe('HtmlBlockDialog', () => {
  it('não rouba o foco do botão-gatilho no mount, com o diálogo fechado', () => {
    render(<Harness onConfirm={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Inserir elemento' });
    expect(trigger).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it('não renderiza nada quando `open` é false', () => {
    render(<Harness onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ao abrir, foca o textarea; ao fechar (depois de aberto), devolve o foco pro gatilho', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Inserir elemento' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('HTML')).toHaveFocus());

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('textarea vazio: botão Inserir fica desabilitado', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    expect(screen.getByRole('button', { name: 'Inserir' })).toBeDisabled();
  });

  it('confirmar com HTML preenchido chama onConfirm e devolve o foco pro gatilho', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const trigger = screen.getByRole('button', { name: 'Inserir elemento' });
    await user.click(trigger);

    await user.type(screen.getByLabelText('HTML'), '<iframe src="https://x.com"></iframe>');
    await user.click(screen.getByRole('button', { name: 'Inserir' }));

    expect(onConfirm).toHaveBeenCalledWith('<iframe src="https://x.com"></iframe>');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('pré-preenche o textarea com `initialHtml` (fluxo de EDITAR um bloco existente)', async () => {
    const user = userEvent.setup();
    render(<Harness initialHtml="<p>já salvo</p>" onConfirm={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    expect(screen.getByLabelText('HTML')).toHaveValue('<p>já salvo</p>');
  });

  it('Esc fecha sem chamar onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    await user.type(screen.getByLabelText('HTML'), 'rascunho não confirmado');

    await user.keyboard('{Escape}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clique no backdrop fecha sem chamar onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));

    await user.click(document.querySelector('.dialog-backdrop')!);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

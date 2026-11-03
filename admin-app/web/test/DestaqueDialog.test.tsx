import { useRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DestaqueDialog } from '../src/components/DestaqueDialog';

/**
 * Harness com um botão-gatilho real já montado no DOM ANTES do diálogo abrir
 * -- reproduz exatamente a fiação de `MarkdownToolbar` (`insertTriggerRef` é
 * o botão "Inserir", que existe desde o mount, bem diferente do
 * `triggerRef` do `LinkDialog`/`ConfirmDialog`, que só é preenchido dentro
 * do `if (open)`). É essa diferença que causava o roubo de foco no mount.
 */
function Harness({ onConfirm }: { onConfirm: (type: string, text: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Inserir elemento
      </button>
      <DestaqueDialog
        open={open}
        initialText=""
        returnFocusRef={triggerRef}
        onConfirm={(type, text) => {
          onConfirm(type, text);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

describe('DestaqueDialog', () => {
  it('não rouba o foco do botão-gatilho no mount, com o diálogo fechado', () => {
    render(<Harness onConfirm={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Inserir elemento' });
    // Bug original: `returnFocusRef.current` já existe no DOM nesse momento
    // (diferente do `LinkDialog`/`ConfirmDialog`), então o `else` do efeito
    // de devolução de foco disparava `.focus()` nele mesmo sem o diálogo
    // nunca ter aberto -- o que também causava scroll automático indesejado
    // em telas onde esse botão fica abaixo da dobra.
    expect(trigger).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it('não renderiza nada quando `open` é false', () => {
    render(<Harness onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ao abrir, foca o primeiro rádio; ao fechar (depois de ter aberto), devolve o foco pro gatilho', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Inserir elemento' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: /dica/i })).toHaveFocus());

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('confirmar insere o destaque e devolve o foco pro gatilho', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const trigger = screen.getByRole('button', { name: 'Inserir elemento' });
    await user.click(trigger);

    await user.type(screen.getByLabelText('Texto do destaque'), 'Atenção aqui');
    await user.click(screen.getByRole('button', { name: 'Inserir' }));

    expect(onConfirm).toHaveBeenCalledWith('dica', 'Atenção aqui');
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

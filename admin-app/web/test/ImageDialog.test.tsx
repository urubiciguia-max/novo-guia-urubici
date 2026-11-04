import { useRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ImageDialog } from '../src/components/ImageDialog';

const { validateImageFileMock, compressCoverImageMock } = vi.hoisted(() => ({
  validateImageFileMock: vi.fn(),
  compressCoverImageMock: vi.fn(),
}));

vi.mock('../src/lib/imageUpload', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/imageUpload')>('../src/lib/imageUpload');
  return {
    ...actual,
    validateImageFile: validateImageFileMock,
    compressCoverImage: compressCoverImageMock,
  };
});

function makeFile(): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], 'foto.jpg', { type: 'image/jpeg' });
}

/**
 * Mesmo motivo do `HtmlBlockDialog.test.tsx`/`DestaqueDialog.test.tsx`:
 * `returnFocusRef` explícito, gatilho real montado antes do diálogo abrir
 * (reproduz o item "Inserir imagem" do dropdown "Inserir", que desmonta no
 * mesmo clique que abre este diálogo).
 */
function Harness({
  onConfirm,
  upload,
}: {
  onConfirm: (r: { path: string; alt: string }) => void;
  upload: (file: File) => Promise<{ path: string }>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Inserir elemento
      </button>
      <ImageDialog
        open={open}
        returnFocusRef={triggerRef}
        upload={upload}
        onConfirm={(r) => {
          onConfirm(r);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

beforeEach(() => {
  validateImageFileMock.mockReset();
  compressCoverImageMock.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:fake-preview');
  URL.revokeObjectURL = vi.fn();
});

describe('ImageDialog', () => {
  it('não renderiza nada quando `open` é false', () => {
    render(<Harness onConfirm={vi.fn()} upload={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('não rouba o foco do gatilho no mount, com o diálogo fechado', () => {
    render(<Harness onConfirm={vi.fn()} upload={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Inserir elemento' })).not.toHaveFocus();
  });

  it('abre com alt desabilitado e botão Inserir desabilitado até enviar uma imagem com sucesso', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} upload={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));

    expect(screen.getByLabelText('Texto alternativo (alt)')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Inserir' })).toBeDisabled();
  });

  it('rejeita arquivo inválido na validação client-side e NUNCA chama upload', async () => {
    const user = userEvent.setup();
    const upload = vi.fn();
    validateImageFileMock.mockResolvedValue({ ok: false, error: 'Este arquivo não é uma imagem reconhecida.' });

    render(<Harness onConfirm={vi.fn()} upload={upload} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    const input = screen.getByTestId('content-image-input') as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/não é uma imagem reconhecida/i));
    expect(compressCoverImageMock).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Inserir' })).toBeDisabled();
  });

  it('fluxo feliz: valida, comprime, sobe, libera alt obrigatório e confirma com {path, alt}', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const upload = vi.fn().mockResolvedValue({ path: './meu-post-img-abc123.jpg' });
    const compressedBlob = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });

    validateImageFileMock.mockResolvedValue({ ok: true, type: 'jpeg' });
    compressCoverImageMock.mockResolvedValue({
      ok: true,
      blob: compressedBlob,
      mimeType: 'image/jpeg',
      width: 1200,
      height: 800,
    });

    render(<Harness onConfirm={onConfirm} upload={upload} />);
    const trigger = screen.getByRole('button', { name: 'Inserir elemento' });
    await user.click(trigger);
    const input = screen.getByTestId('content-image-input') as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(upload).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Texto alternativo (alt)')).not.toBeDisabled());
    expect(screen.getByAltText(/pré-visualização/i)).toBeInTheDocument();

    // Inserir ainda desabilitado sem alt preenchido
    expect(screen.getByRole('button', { name: 'Inserir' })).toBeDisabled();

    await user.type(screen.getByLabelText('Texto alternativo (alt)'), 'Cachoeira em Urubici');
    await user.click(screen.getByRole('button', { name: 'Inserir' }));

    expect(onConfirm).toHaveBeenCalledWith({ path: './meu-post-img-abc123.jpg', alt: 'Cachoeira em Urubici' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('erro de upload aparece na UI e não chama onConfirm', async () => {
    const user = userEvent.setup();
    validateImageFileMock.mockResolvedValue({ ok: true, type: 'jpeg' });
    compressCoverImageMock.mockResolvedValue({
      ok: true,
      blob: new Blob([new Uint8Array(500)], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    });
    const upload = vi.fn().mockRejectedValue(new Error('Erro de rede ao comunicar com a API do GitHub.'));
    const onConfirm = vi.fn();

    render(<Harness onConfirm={onConfirm} upload={upload} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    const input = screen.getByTestId('content-image-input') as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/erro de rede/i));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Inserir' })).toBeDisabled();
  });

  it('Esc fecha sem chamar onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} upload={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));

    await user.keyboard('{Escape}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

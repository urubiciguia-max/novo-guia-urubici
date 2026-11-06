import { useRef, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AffiliateCardDialog } from '../src/components/AffiliateCardDialog';
import { DEFAULT_AFFILIATE_CARD_VALUE, type AffiliateCardFormValue } from '../src/lib/affiliateCardShared';

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

/** Mesmo padrão de `ImageDialog.test.tsx`/`DestaqueDialog.test.tsx`:
 *  `returnFocusRef` explícito, gatilho real montado antes do diálogo abrir. */
function Harness({
  initialValue = DEFAULT_AFFILIATE_CARD_VALUE,
  upload,
  onConfirm,
}: {
  initialValue?: AffiliateCardFormValue;
  upload?: (file: File) => Promise<{ path: string }>;
  onConfirm: (value: AffiliateCardFormValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Inserir elemento
      </button>
      <AffiliateCardDialog
        open={open}
        initialValue={initialValue}
        returnFocusRef={triggerRef}
        upload={upload}
        onConfirm={(value) => {
          onConfirm(value);
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

async function uploadHappyPathImage(user: ReturnType<typeof userEvent.setup>, uploadedPath = './post-img-abc123.jpg') {
  validateImageFileMock.mockResolvedValue({ ok: true, type: 'jpeg' });
  compressCoverImageMock.mockResolvedValue({
    ok: true,
    blob: new Blob([new Uint8Array(1000)], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    width: 1200,
    height: 800,
  });
  const input = screen.getByTestId('affiliate-card-image-input') as HTMLInputElement;
  await user.upload(input, makeFile());
  await waitFor(() => expect(screen.getByLabelText(/texto alternativo da imagem/i)).not.toBeDisabled());
  return uploadedPath;
}

describe('AffiliateCardDialog', () => {
  it('não renderiza nada quando `open` é false', () => {
    render(<Harness onConfirm={vi.fn()} upload={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('não rouba o foco do gatilho no mount, com o diálogo fechado', () => {
    render(<Harness onConfirm={vi.fn()} upload={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Inserir elemento' })).not.toHaveFocus();
  });

  it('abre com layout "vertical" e botão "Inserir" desabilitado até os campos obrigatórios serem preenchidos', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} upload={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));

    expect(screen.getByRole('radio', { name: /vertical \(imagem em cima\)/i })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Inserir' })).toBeDisabled();
  });

  it('fluxo feliz: upload de imagem + campos obrigatórios habilitam Inserir, e o payload final bate', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const upload = vi.fn().mockResolvedValue({ path: './hotel-img-abc123.jpg' });

    render(<Harness onConfirm={onConfirm} upload={upload} />);
    const trigger = screen.getByRole('button', { name: 'Inserir elemento' });
    await user.click(trigger);

    await uploadHappyPathImage(user);
    await user.type(screen.getByLabelText(/texto alternativo da imagem/i), 'Fachada do hotel');

    await user.click(screen.getByRole('radio', { name: /horizontal \(imagem do lado\)/i }));
    await user.click(screen.getByRole('radio', { name: 'Escudo / Segurança' }));
    await user.type(screen.getByLabelText('Texto do selo'), 'Segurança Máxima');
    await user.type(screen.getByLabelText('Título'), 'Aluguel de SUV ou 4x4');

    await user.type(screen.getByLabelText('Texto do botão 1'), 'Ver Preços');
    await user.type(screen.getByLabelText('Link do botão 1'), 'https://rentcars.example.com/suv');
    await user.click(screen.getByRole('radio', { name: 'Laranja' }));

    await user.type(screen.getByLabelText('Texto do botão 2'), 'Modelos');
    await user.type(screen.getByLabelText('Link do botão 2'), 'https://rentcars.example.com/modelos');

    await user.type(screen.getByLabelText('Dica: (opcional)'), 'Reserve com antecedência na alta temporada.');

    const confirmBtn = screen.getByRole('button', { name: 'Inserir' });
    expect(confirmBtn).not.toBeDisabled();
    await user.click(confirmBtn);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      layout: 'horizontal',
      image: './hotel-img-abc123.jpg',
      imageAlt: 'Fachada do hotel',
      badgeIcon: 'escudo',
      badgeText: 'Segurança Máxima',
      title: 'Aluguel de SUV ou 4x4',
      button1Text: 'Ver Preços',
      button1Url: 'https://rentcars.example.com/suv',
      button1Color: 'orange',
      button2Text: 'Modelos',
      button2Url: 'https://rentcars.example.com/modelos',
      tip: 'Reserve com antecedência na alta temporada.',
    });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('botão 2 e dica são opcionais -- confirma sem eles', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const upload = vi.fn().mockResolvedValue({ path: './pousada-img-xyz.jpg' });

    render(<Harness onConfirm={onConfirm} upload={upload} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    await uploadHappyPathImage(user);

    await user.type(screen.getByLabelText(/texto alternativo da imagem/i), 'Vista da pousada');
    await user.type(screen.getByLabelText('Texto do selo'), 'Conforto & Charme');
    await user.type(screen.getByLabelText('Título'), 'La Mansarda Hotel');
    await user.type(screen.getByLabelText('Texto do botão 1'), 'Reservar Agora');
    await user.type(screen.getByLabelText('Link do botão 1'), 'https://booking.example.com/la-mansarda');

    const confirmBtn = screen.getByRole('button', { name: 'Inserir' });
    expect(confirmBtn).not.toBeDisabled();
    await user.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ button2Text: '', button2Url: '', tip: '' }),
    );
  });

  it('sem `upload` (fluxo de EDITAR um card já inserido): mostra a imagem atual como fixa, sem botão de trocar', async () => {
    const user = userEvent.setup();
    const existing: AffiliateCardFormValue = {
      ...DEFAULT_AFFILIATE_CARD_VALUE,
      image: './ja-salvo-img.jpg',
      imageAlt: 'Já salvo',
      badgeText: 'Selo existente',
      title: 'Título existente',
      button1Text: 'Botão existente',
      button1Url: 'https://exemplo.com',
    };

    render(<Harness initialValue={existing} onConfirm={vi.fn()} upload={undefined} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));

    expect(screen.queryByRole('button', { name: /trocar imagem|selecionar imagem/i })).not.toBeInTheDocument();
    expect(screen.getByText(/imagem já definida/i)).toBeInTheDocument();
    // campos já vêm preenchidos e o card já tem imagem -- Inserir/Salvar
    // habilitado sem precisar reenviar nada.
    expect(screen.getByRole('button', { name: 'Inserir' })).not.toBeDisabled();
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

  it('clique no backdrop fecha sem chamar onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} upload={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));

    await user.click(document.querySelector('.dialog-backdrop')!);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejeita arquivo inválido na validação client-side e NUNCA chama upload', async () => {
    const user = userEvent.setup();
    const upload = vi.fn();
    validateImageFileMock.mockResolvedValue({ ok: false, error: 'Este arquivo não é uma imagem reconhecida.' });

    render(<Harness onConfirm={vi.fn()} upload={upload} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));
    const input = screen.getByTestId('affiliate-card-image-input') as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/não é uma imagem reconhecida/i));
    expect(compressCoverImageMock).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Inserir' })).toBeDisabled();
  });

  it('mostra a prévia ao vivo com o texto do título digitado', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} upload={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Inserir elemento' }));

    await user.type(screen.getByLabelText('Título'), 'Pousada da Serra');

    const preview = document.querySelector('.affiliate-card-dialog__preview');
    expect(preview).not.toBeNull();
    expect(within(preview as HTMLElement).getByText('Pousada da Serra')).toBeInTheDocument();
  });
});

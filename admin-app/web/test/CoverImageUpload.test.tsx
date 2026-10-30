import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CoverImageUpload } from '../src/components/CoverImageUpload';

// `vi.mock(...)` é hoisted pro topo do arquivo -- os mocks precisam ser
// criados via `vi.hoisted` pra não virar `ReferenceError` de acesso antes da
// inicialização (ver https://vitest.dev/api/vi.html#vi-mock).
const { uploadCoverImageMock } = vi.hoisted(() => ({ uploadCoverImageMock: vi.fn() }));

vi.mock('../src/data/PostsContext', () => ({
  usePosts: () => ({ uploadCoverImage: uploadCoverImageMock }),
}));

const { validateImageFileMock, compressCoverImageMock, blobToBase64Mock } = vi.hoisted(() => ({
  validateImageFileMock: vi.fn(),
  compressCoverImageMock: vi.fn(),
  blobToBase64Mock: vi.fn(),
}));

vi.mock('../src/lib/imageUpload', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/imageUpload')>('../src/lib/imageUpload');
  return {
    ...actual,
    validateImageFile: validateImageFileMock,
    compressCoverImage: compressCoverImageMock,
    blobToBase64: blobToBase64Mock,
  };
});

function makeFile(): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], 'foto.jpg', { type: 'image/jpeg' });
}

beforeEach(() => {
  uploadCoverImageMock.mockReset();
  validateImageFileMock.mockReset();
  compressCoverImageMock.mockReset();
  blobToBase64Mock.mockReset();
  // jsdom não implementa `URL.createObjectURL`/`revokeObjectURL` de verdade -- o preview só precisa de uma string.
  URL.createObjectURL = vi.fn(() => 'blob:fake-preview');
  URL.revokeObjectURL = vi.fn();
});

describe('CoverImageUpload', () => {
  it('desabilita o botão de upload e explica o motivo quando o slug ainda não foi preenchido', () => {
    render(<CoverImageUpload legacySlug="" currentPath="" onUploaded={vi.fn()} />);
    expect(screen.getByRole('button', { name: /enviar imagem/i })).toBeDisabled();
    expect(screen.getByText(/preencha o slug/i)).toBeInTheDocument();
  });

  it('rejeita arquivo inválido na validação client-side e NUNCA chama uploadCoverImage', async () => {
    const user = userEvent.setup();
    validateImageFileMock.mockResolvedValue({ ok: false, error: 'Este arquivo não é uma imagem reconhecida.' });

    render(<CoverImageUpload legacySlug="meu-post" currentPath="" onUploaded={vi.fn()} />);
    const input = screen.getByTestId('cover-upload-input') as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/não é uma imagem reconhecida/i));
    expect(compressCoverImageMock).not.toHaveBeenCalled();
    expect(uploadCoverImageMock).not.toHaveBeenCalled();
  });

  it('mostra erro claro quando a compressão não consegue ficar abaixo do limite, sem chamar o upload', async () => {
    const user = userEvent.setup();
    validateImageFileMock.mockResolvedValue({ ok: true, type: 'jpeg' });
    compressCoverImageMock.mockResolvedValue({
      ok: false,
      error: 'Imagem muito grande, tente outra foto ou uma versão menor.',
    });

    render(<CoverImageUpload legacySlug="meu-post" currentPath="" onUploaded={vi.fn()} />);
    const input = screen.getByTestId('cover-upload-input') as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/imagem muito grande, tente outra foto/i)
    );
    expect(uploadCoverImageMock).not.toHaveBeenCalled();
  });

  it('fluxo feliz: valida, comprime, mostra preview, envia e preenche `cover` com o path devolvido', async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    const compressedBlob = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });

    validateImageFileMock.mockResolvedValue({ ok: true, type: 'jpeg' });
    compressCoverImageMock.mockResolvedValue({
      ok: true,
      blob: compressedBlob,
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1067,
    });
    blobToBase64Mock.mockResolvedValue('ZmFrZS1iYXNlNjQ=');
    uploadCoverImageMock.mockResolvedValue({
      path: './meu-post-capa.jpg',
      sha: 'sha-1',
      commitSha: 'commit-1',
    });

    render(<CoverImageUpload legacySlug="meu-post" currentPath="" onUploaded={onUploaded} />);
    const input = screen.getByTestId('cover-upload-input') as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('./meu-post-capa.jpg'));

    expect(uploadCoverImageMock).toHaveBeenCalledWith('meu-post', {
      name: 'meu-post-capa.jpg',
      mimeType: 'image/jpeg',
      base64Content: 'ZmFrZS1iYXNlNjQ=',
    });
    expect(screen.getByAltText(/pré-visualização/i)).toBeInTheDocument();
    expect(screen.getByText(/1600×1067px/)).toBeInTheDocument();
  });

  it('erro do upload (ex: rede/409) aparece pra UI sem travar o form', async () => {
    const user = userEvent.setup();
    validateImageFileMock.mockResolvedValue({ ok: true, type: 'jpeg' });
    compressCoverImageMock.mockResolvedValue({
      ok: true,
      blob: new Blob([new Uint8Array(500)], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    });
    blobToBase64Mock.mockResolvedValue('ZmFrZQ==');
    uploadCoverImageMock.mockRejectedValue(new Error('Erro de rede ao comunicar com a API do GitHub.'));

    render(<CoverImageUpload legacySlug="meu-post" currentPath="" onUploaded={vi.fn()} />);
    const input = screen.getByTestId('cover-upload-input') as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/erro de rede/i));
    // O botão volta a ficar clicável -- não trava o form depois do erro.
    expect(screen.getByRole('button', { name: /enviar imagem/i })).not.toBeDisabled();
  });
});

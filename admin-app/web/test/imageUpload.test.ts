import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_COMPRESSED_BYTES,
  MAX_RAW_FILE_BYTES,
  compressCoverImage,
  detectImageType,
  validateImageFile,
} from '../src/lib/imageUpload';

function fileFromBytes(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

describe('detectImageType -- magic bytes reais, não confia em extensão/MIME', () => {
  it('reconhece JPEG pela assinatura FF D8 FF', async () => {
    const file = fileFromBytes(JPEG_HEAD, 'foto.jpg', 'image/jpeg');
    expect(await detectImageType(file)).toBe('jpeg');
  });

  it('reconhece PNG pela assinatura de 8 bytes', async () => {
    const file = fileFromBytes(PNG_HEAD, 'foto.png', 'image/png');
    expect(await detectImageType(file)).toBe('png');
  });

  it('reconhece WebP (RIFF....WEBP)', async () => {
    const file = fileFromBytes(WEBP_HEAD, 'foto.webp', 'image/webp');
    expect(await detectImageType(file)).toBe('webp');
  });

  it('devolve null pra conteúdo que não bate com nenhuma assinatura conhecida', async () => {
    const file = fileFromBytes([0x00, 0x01, 0x02, 0x03], 'misterioso.bin', 'application/octet-stream');
    expect(await detectImageType(file)).toBeNull();
  });

  it('bloqueia SVG mesmo com extensão/MIME de imagem -- conteúdo real é texto XML, não bate assinatura nenhuma', async () => {
    const svgBytes = Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    // Arquivo deliberadamente renomeado e com `type` falsificado -- é exatamente o ataque que a defesa precisa pegar.
    const file = fileFromBytes(svgBytes, 'foto-capa.jpg', 'image/jpeg');
    expect(await detectImageType(file)).toBeNull();
  });

  it('não confia em `file.type` -- JPEG real com `type` errado ainda é reconhecido pelo conteúdo', async () => {
    const file = fileFromBytes(JPEG_HEAD, 'arquivo-qualquer.txt', 'text/plain');
    expect(await detectImageType(file)).toBe('jpeg');
  });
});

describe('validateImageFile', () => {
  it('aceita JPEG/PNG/WebP válidos', async () => {
    expect(await validateImageFile(fileFromBytes(JPEG_HEAD, 'a.jpg', 'image/jpeg'))).toEqual({
      ok: true,
      type: 'jpeg',
    });
    expect(await validateImageFile(fileFromBytes(PNG_HEAD, 'a.png', 'image/png'))).toEqual({ ok: true, type: 'png' });
    expect(await validateImageFile(fileFromBytes(WEBP_HEAD, 'a.webp', 'image/webp'))).toEqual({
      ok: true,
      type: 'webp',
    });
  });

  it('rejeita arquivo que não é imagem reconhecida (ex: PDF/SVG renomeado), com mensagem clara', async () => {
    const pdfHead = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
    const result = await validateImageFile(fileFromBytes(pdfHead, 'documento.jpg', 'image/jpeg'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/JPEG, PNG ou WebP/);
      expect(result.error).toMatch(/SVG não é aceito/);
    }
  });

  it('recusa arquivo bruto maior que o teto ANTES de examinar o conteúdo', async () => {
    const big = fileFromBytes(new Array(MAX_RAW_FILE_BYTES + 1).fill(0xff), 'gigante.jpg', 'image/jpeg');
    const result = await validateImageFile(big);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/muito grande/);
    }
  });
});

// ---------------------------------------------------------------------------
// compressCoverImage -- mocka `Image`/canvas (jsdom não implementa decode de
// imagem real nem `HTMLCanvasElement#getContext`/`toBlob` por padrão).
// ---------------------------------------------------------------------------

class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((err?: unknown) => void) | null = null;
  naturalWidth = 3000;
  naturalHeight = 2000;
  width = 3000;
  height = 2000;
  private _src = '';
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }
}

class FailingImage extends FakeImage {
  set src(value: string) {
    void value;
    queueMicrotask(() => this.onerror?.());
  }
}

/** Faz `canvas.toBlob` devolver blobs com os tamanhos dados, um por chamada (uma por tentativa de qualidade). */
function stubCanvas(blobSizes: number[]) {
  let call = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const toBlobSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      const size = blobSizes[Math.min(call, blobSizes.length - 1)];
      call += 1;
      cb(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
    });
  return toBlobSpy;
}

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('compressCoverImage', () => {
  it('redimensiona o lado maior pra 1600px mantendo proporção quando a primeira tentativa (qualidade 0.8) já cabe no limite', async () => {
    vi.stubGlobal('Image', FakeImage);
    const toBlobSpy = stubCanvas([MAX_COMPRESSED_BYTES - 1000]);

    const file = fileFromBytes(JPEG_HEAD, 'foto.jpg', 'image/jpeg');
    const result = await compressCoverImage(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.width).toBe(1600); // lado maior (3000) escalado pra 1600
      expect(result.height).toBe(1067); // 2000 * (1600/3000), arredondado
      expect(result.blob.size).toBeLessThanOrEqual(MAX_COMPRESSED_BYTES);
    }
    expect(toBlobSpy).toHaveBeenCalledTimes(1);
    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8);
  });

  it('não faz upscale de imagem já menor que o teto de dimensão', async () => {
    class SmallImage extends FakeImage {
      naturalWidth = 800;
      naturalHeight = 600;
      width = 800;
      height = 600;
    }
    vi.stubGlobal('Image', SmallImage);
    stubCanvas([1000]);

    const file = fileFromBytes(PNG_HEAD, 'foto.png', 'image/png');
    const result = await compressCoverImage(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    }
  });

  it('reduz qualidade progressivamente (0.8 -> 0.6 -> 0.4) até o resultado caber no limite', async () => {
    vi.stubGlobal('Image', FakeImage);
    const toBlobSpy = stubCanvas([2_000_000, 1_000_000, 500_000]);

    const file = fileFromBytes(JPEG_HEAD, 'foto.jpg', 'image/jpeg');
    const result = await compressCoverImage(file, { maxBytes: MAX_COMPRESSED_BYTES });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.blob.size).toBe(500_000);
    }
    expect(toBlobSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 'image/jpeg', 0.8);
    expect(toBlobSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 'image/jpeg', 0.6);
    expect(toBlobSpy).toHaveBeenNthCalledWith(3, expect.any(Function), 'image/jpeg', 0.4);
  });

  it('desiste com erro claro (sem truncar, sem enviar em silêncio) quando nem a qualidade mais baixa cabe no limite', async () => {
    vi.stubGlobal('Image', FakeImage);
    const toBlobSpy = stubCanvas([2_000_000, 2_000_000, 2_000_000]);

    const file = fileFromBytes(JPEG_HEAD, 'foto-enorme.jpg', 'image/jpeg');
    const result = await compressCoverImage(file, { maxBytes: MAX_COMPRESSED_BYTES });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Imagem muito grande, tente outra foto ou uma versão menor.');
    }
    expect(toBlobSpy).toHaveBeenCalledTimes(3); // tentou as 3 qualidades, não menos
  });

  it('devolve erro (não lança) quando a imagem não carrega (arquivo corrompido)', async () => {
    vi.stubGlobal('Image', FailingImage);
    stubCanvas([1000]);

    const file = fileFromBytes(JPEG_HEAD, 'corrompido.jpg', 'image/jpeg');
    const result = await compressCoverImage(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/não foi possível carregar/i);
    }
  });
});

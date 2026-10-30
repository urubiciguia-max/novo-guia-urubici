/**
 * Validação (magic bytes reais) + compressão client-side da imagem de capa,
 * ANTES de qualquer upload via `uploadCoverImage()` (ver
 * `admin-app/src/github-client.ts`, Jurandir -- TRACK B da spec em
 * `.agents/inbox/genilson.md`).
 *
 * O `GitHubPostsClient.uploadCoverImage()` também valida tipo/tamanho do
 * lado dele (defesa em profundidade) -- mas aqui é onde o usuário recebe o
 * erro ANTES de gastar uma chamada de rede, e onde a imagem é reduzida pra
 * caber no limite de ~1MB de base64 da Contents API.
 */

export type DetectedImageType = 'jpeg' | 'png' | 'webp';

/** Recusa arquivo bruto maior que isso ANTES de tentar ler/comprimir -- evita travar o navegador com upload absurdo. */
export const MAX_RAW_FILE_BYTES = 15 * 1024 * 1024; // 15MB

/**
 * Teto do arquivo JÁ COMPRIMIDO que tentamos entregar pro
 * `uploadCoverImage()`. A Contents API aceita ~1MB de *base64*, que infla
 * ~33% sobre o bruto -- 750KB de raw bytes é a margem segura documentada na
 * spec (750KB * 1.333 ≈ 1000KB), com folga real sobre o teto do Jurandir,
 * não "quase passando".
 */
export const MAX_COMPRESSED_BYTES = 750 * 1024; // 750KB

/** Lado maior da imagem após redimensionar, mantendo proporção. */
export const MAX_COVER_DIMENSION = 1600;

/** Reduz qualidade progressivamente até caber no teto, antes de desistir. */
const JPEG_QUALITY_STEPS = [0.8, 0.6, 0.4] as const;

export interface ImageValidationOk {
  ok: true;
  type: DetectedImageType;
}

export interface ImageValidationError {
  ok: false;
  error: string;
}

export type ImageValidationResult = ImageValidationOk | ImageValidationError;

/**
 * Confere a assinatura binária real dos primeiros bytes do arquivo --
 * NUNCA confia em `file.type`/extensão (falsificável: um `.svg` renomeado
 * pra `.jpg` passa pelo filtro `accept` do input e o navegador pode
 * reportar `file.type` vazio ou errado). Bloqueia SVG implicitamente (não
 * está em nenhuma assinatura abaixo -- some como "tipo não reconhecido").
 *
 * Assinaturas:
 * - JPEG: `FF D8 FF`
 * - PNG:  `89 50 4E 47 0D 0A 1A 0A`
 * - WebP: `RIFF????WEBP` (bytes 0-3 "RIFF", bytes 8-11 "WEBP")
 */
/**
 * Lê um `Blob` inteiro via `FileReader.readAsArrayBuffer` -- de propósito
 * NÃO usa `Blob#arrayBuffer()`/`Blob#slice().arrayBuffer()` (API mais nova,
 * mais direta), porque `FileReader` tem suporte mais amplo entre
 * implementações (inclusive no ambiente de teste, jsdom, que não implementa
 * `Blob#arrayBuffer`).
 */
function readArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function detectImageType(file: Blob): Promise<DetectedImageType | null> {
  // Lê o arquivo inteiro em vez de só os primeiros bytes -- ver
  // `readArrayBuffer`. Seguro de qualquer forma: a validação de tamanho
  // bruto (`MAX_RAW_FILE_BYTES`) já rodou antes desta função ser chamada
  // (ver `validateImageFile`), então o teto real é ~15MB, leitura trivial
  // pro navegador.
  const buffer = await readArrayBuffer(file);
  const bytes = new Uint8Array(buffer.slice(0, 16));

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Validação client-side ANTES de qualquer upload: tamanho bruto (recusa
 * cedo, sem nem ler o arquivo inteiro) e tipo real via magic bytes.
 * Mensagens em português, prontas pra UI.
 */
export async function validateImageFile(file: File): Promise<ImageValidationResult> {
  if (file.size > MAX_RAW_FILE_BYTES) {
    return {
      ok: false,
      error: `Arquivo muito grande (${formatBytes(file.size)}). O máximo aceito é ${formatBytes(MAX_RAW_FILE_BYTES)}.`,
    };
  }

  const type = await detectImageType(file);
  if (type === null) {
    return {
      ok: false,
      error:
        'Este arquivo não é uma imagem JPEG, PNG ou WebP reconhecida (conferimos o conteúdo real do arquivo, não a extensão). SVG não é aceito.',
    };
  }

  return { ok: true, type };
}

export interface CompressedCoverImage {
  ok: true;
  blob: Blob;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

export interface CompressionError {
  ok: false;
  error: string;
}

export type CompressionResult = CompressedCoverImage | CompressionError;

function scaleToFit(width: number, height: number, maxDimension: number): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Carrega o arquivo num `<img>` só pra ler as dimensões naturais e permitir `drawImage` no canvas. */
function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível carregar a imagem selecionada -- o arquivo pode estar corrompido.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Redimensiona o lado maior pra `maxDimension` (mantendo proporção) e
 * reencode como JPEG, reduzindo qualidade progressivamente
 * (0.8 → 0.6 → 0.4) até o resultado caber em `maxBytes`. Se mesmo na
 * qualidade mais baixa ainda passar do limite, devolve erro em vez de
 * truncar ou enviar silenciosamente um arquivo grande demais.
 */
export async function compressCoverImage(
  file: File,
  opts: { maxDimension?: number; maxBytes?: number } = {}
): Promise<CompressionResult> {
  const maxDimension = opts.maxDimension ?? MAX_COVER_DIMENSION;
  const maxBytes = opts.maxBytes ?? MAX_COMPRESSED_BYTES;

  let img: HTMLImageElement;
  try {
    img = await loadImageElement(file);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Não foi possível carregar a imagem selecionada.' };
  }

  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  const { width, height } = scaleToFit(naturalWidth, naturalHeight, maxDimension);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { ok: false, error: 'Não foi possível processar a imagem neste navegador (canvas 2D indisponível).' };
  }
  ctx.drawImage(img, 0, 0, width, height);

  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob && blob.size <= maxBytes) {
      return { ok: true, blob, mimeType: 'image/jpeg', width, height };
    }
  }

  return {
    ok: false,
    error: 'Imagem muito grande, tente outra foto ou uma versão menor.',
  };
}

/** `Blob` -> string base64 pura (sem o prefixo `data:...;base64,`), formato que `uploadCoverImage()` espera. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Não foi possível ler a imagem comprimida.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem comprimida.'));
    reader.readAsDataURL(blob);
  });
}

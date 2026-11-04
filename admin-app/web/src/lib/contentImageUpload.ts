import { blobToBase64 } from './imageUpload';
import type { UploadContentImageFile, UploadContentImageResult } from './postsClient';

/**
 * Fábrica do `upload` que `MarkdownToolbar`/`ImageDialog` esperam
 * (`(file: File) => Promise<{ path: string }>`, ver
 * `MarkdownToolbarImageUpload`) -- usada por `PostFormPage.tsx`/
 * `PageFormPage.tsx` pra amarrar `uploadContentImage` (mesmo nome exposto
 * por `usePosts()`/`usePages()`, ver handoff do Jurandir em
 * `.agents/inbox/francisgleydisson.md`) a um slug já conhecido.
 *
 * Único lugar onde o `Blob`/`File` já comprimido (`ImageDialog` já rodou
 * `validateImageFile`/`compressCoverImage` antes de chamar isto) vira
 * base64 -- mesmo encadeamento que `CoverImageUpload.handleFileSelected`
 * já faz pra imagem de capa.
 */
export function createContentImageUploader(
  uploadContentImage: (slug: string, file: UploadContentImageFile) => Promise<UploadContentImageResult>,
  slug: string,
): (file: File) => Promise<{ path: string }> {
  return async (file) => {
    const base64Content = await blobToBase64(file);
    const result = await uploadContentImage(slug, {
      name: file.name,
      mimeType: file.type,
      base64Content,
    });
    return { path: result.path };
  };
}

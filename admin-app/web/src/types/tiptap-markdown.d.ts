/**
 * `tiptap-markdown` não faz a augmentação de tipo de `editor.storage` que
 * extensões TipTap costumam fazer (ver `@tiptap/core`'s `Storage` --
 * interface vazia por padrão, cada extensão deveria "somar" sua própria
 * chave via `declare module`). Sem isso, `editor.storage.markdown.
 * getMarkdown()`/`.parser.parse(...)` (usados em `PostFormPage.tsx`,
 * `PageFormPage.tsx`, `MarkdownToolbar.tsx`) não tipam -- TS2339.
 *
 * `MarkdownStorage` (de `tiptap-markdown/index.d.ts`) só declara `options`/
 * `getMarkdown()`, mas o objeto real em runtime (`Markdown.js`,
 * `onBeforeCreate`) também expõe `parser`/`serializer` -- completamos aqui
 * pra bater com o que o código de verdade usa.
 */
import type { MarkdownOptions } from 'tiptap-markdown';

declare module '@tiptap/core' {
  interface Storage {
    markdown: {
      options: MarkdownOptions;
      getMarkdown(): string;
      parser: {
        parse(content: string, options?: { inline?: boolean }): string;
      };
      serializer: {
        serialize(content: unknown): string;
      };
    };
  }
}

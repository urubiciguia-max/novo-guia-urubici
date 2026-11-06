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
import type { MarkdownToolbarImageUpload } from '../components/MarkdownToolbar';

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
    /**
     * `addStorage()` do node `AffiliateCard` (ver `lib/affiliateCardNode.tsx`)
     * -- mesmo motivo da augmentação de `markdown` acima: sem isso,
     * `editor.storage.affiliateCard.imageUpload` (lido/escrito em
     * `AffiliateCardView`, `PostFormPage.tsx` e `PageFormPage.tsx`) não tipa
     * (TS2339). Canal pelo qual o fluxo de EDITAR um card já inserido ganha
     * acesso à mesma função de upload que o fluxo de INSERIR recebe via
     * prop direta da `MarkdownToolbar`.
     */
    affiliateCard: {
      imageUpload: MarkdownToolbarImageUpload | null;
    };
  }
}

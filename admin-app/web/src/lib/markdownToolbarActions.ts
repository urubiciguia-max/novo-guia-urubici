/**
 * Transformações puras de texto/seleção usadas pela `MarkdownToolbar`
 * (`components/MarkdownToolbar.tsx`) -- cada função recebe o texto inteiro
 * do campo `body` + a seleção atual do textarea e devolve o novo texto +
 * onde a seleção deve ficar depois. Puro de propósito: sem DOM aqui, sem
 * `useState` -- fácil de testar (`test/markdownToolbarActions.test.ts`) e
 * reusar tanto pros botões simples (negrito/itálico/código) quanto pros
 * dropdowns (Parágrafo, Inserir) e pro modal "Inserir link" (`LinkDialog`).
 *
 * Estilo "editor do GitHub": insere sintaxe markdown na posição do cursor,
 * não é WYSIWYG contenteditable (decisão do brief, ver handoff do Genilson).
 */

import { resolveLinkHref } from './markdownPreview';

export interface SelectionResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Mapeia um offset dentro de uma linha (relativo ao início dela) de "antes"
 * pra "depois" quando só o prefixo da linha muda (heading/lista/citação
 * sempre mexem no início da linha, nunca no meio). Se o offset caía dentro
 * do prefixo antigo (que deixou de existir), ele cai pro início do conteúdo
 * novo -- não faz sentido manter cursor "dentro" de um prefixo que sumiu.
 */
function mapLineOffset(offset: number, oldPrefixLen: number, newPrefixLen: number): number {
  if (offset <= oldPrefixLen) return newPrefixLen;
  return offset - oldPrefixLen + newPrefixLen;
}

/** Envolve a seleção com `marker` dos dois lados (negrito/itálico/código inline).
 *  Sem seleção: insere os marcadores vazios com o cursor entre eles.
 *  Com seleção: envolve o texto selecionado e mantém a MESMA seleção (agora
 *  deslocada pelo tamanho do marcador à esquerda), pra dar pra continuar
 *  editando/sobrescrevendo sem precisar reselecionar. */
export function wrapInline(text: string, start: number, end: number, marker: string): SelectionResult {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const newText = `${before}${marker}${selected}${marker}${after}`;

  if (start === end) {
    const pos = start + marker.length;
    return { text: newText, selectionStart: pos, selectionEnd: pos };
  }

  return {
    text: newText,
    selectionStart: start + marker.length,
    selectionEnd: end + marker.length,
  };
}

/** Monta a sintaxe `[texto](url)` normalizando a URL com a MESMA regra do
 *  Preview (`resolveLinkHref` em `markdownPreview.ts`): sem protocolo ganha
 *  `https://` automaticamente. Esquema explícito não-http(s) (`mailto:`,
 *  `tel:`, ...) não é bloqueado aqui -- `resolveLinkHref` devolve `null`
 *  nesse caso só pra proteger o `dangerouslySetInnerHTML` do Preview; na
 *  hora de MONTAR o markdown (não renderizar HTML), não há esse risco, então
 *  cai no fallback e usa a URL exatamente como o usuário digitou. */
export function buildLinkMarkdown(text: string, url: string): string {
  const href = resolveLinkHref(url) ?? url;
  return `[${text}](${href})`;
}

/** Confirmação do modal "Inserir link" (`LinkDialog`): monta `[texto](url)`
 *  (via `buildLinkMarkdown`) e substitui o intervalo [start, end] -- a
 *  posição do cursor/seleção capturada no momento em que o botão Link foi
 *  clicado, ANTES do modal abrir (`MarkdownToolbar` guarda isso, já que a
 *  inserção real só acontece depois, no confirm). Cursor fica colapsado no
 *  fim do link inserido. */
export function insertLinkMarkdown(
  text: string,
  start: number,
  end: number,
  label: string,
  url: string,
): SelectionResult {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const markdown = buildLinkMarkdown(label, url);
  const pos = start + markdown.length;
  return { text: before + markdown + after, selectionStart: pos, selectionEnd: pos };
}

export type HeadingLevel = 0 | 2 | 3 | 4;

const HEADING_RE = /^(#{1,4})\s+/;

/** Dropdown "Parágrafo": aplica no nível de uma única linha (a que contém o
 *  cursor), nunca em múltiplas linhas de uma seleção -- um heading é sempre
 *  uma linha só. `level: 0` = "Parágrafo" (remove heading existente).
 *  H1 não existe aqui de propósito: `src/pages/[...slug].astro` já renderiza
 *  `<h1>` a partir do frontmatter, então H1 no corpo duplicaria hierarquia
 *  (ver handoff). */
export function applyHeading(text: string, cursorPos: number, level: HeadingLevel): SelectionResult {
  const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
  let lineEnd = text.indexOf('\n', cursorPos);
  if (lineEnd === -1) lineEnd = text.length;

  const line = text.slice(lineStart, lineEnd);
  const match = HEADING_RE.exec(line);
  const oldPrefixLen = match ? match[0].length : 0;
  const content = line.slice(oldPrefixLen);
  const newPrefix = level === 0 ? '' : `${'#'.repeat(level)} `;
  const newLine = newPrefix + content;

  const newText = text.slice(0, lineStart) + newLine + text.slice(lineEnd);
  const offsetInLine = cursorPos - lineStart;
  const newOffset = mapLineOffset(offsetInLine, oldPrefixLen, newPrefix.length);
  const newPos = lineStart + newOffset;

  return { text: newText, selectionStart: newPos, selectionEnd: newPos };
}

interface LineTransformResult {
  newLine: string;
  oldPrefixLen: number;
  newPrefixLen: number;
}

/** Aplica `transform` em cada linha tocada pela seleção [start, end]
 *  (linha inteira, mesmo que a seleção pegue só um pedaço dela) e remapeia
 *  a seleção pro texto novo. Cada `transform` só pode mexer no PREFIXO da
 *  linha (inserir/remover texto no início) -- é o que `mapLineOffset`
 *  assume. Usado pelo dropdown "Inserir" (lista/lista numerada/citação). */
function transformLines(
  text: string,
  start: number,
  end: number,
  transform: (line: string, lineIndex: number) => LineTransformResult,
): SelectionResult {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;

  const chunk = text.slice(lineStart, lineEnd);
  const lines = chunk.split('\n');

  const relStart = start - lineStart;
  const relEnd = end - lineStart;

  let oldCursor = 0;
  let newCursor = 0;
  let mappedStart: number | null = null;
  let mappedEnd: number | null = null;
  const newLines: string[] = [];

  lines.forEach((line, index) => {
    const oldLineStart = oldCursor;
    const oldLineEnd = oldLineStart + line.length;
    const { newLine, oldPrefixLen, newPrefixLen } = transform(line, index);

    if (mappedStart === null && relStart >= oldLineStart && relStart <= oldLineEnd) {
      mappedStart = newCursor + mapLineOffset(relStart - oldLineStart, oldPrefixLen, newPrefixLen);
    }
    if (mappedEnd === null && relEnd >= oldLineStart && relEnd <= oldLineEnd) {
      mappedEnd = newCursor + mapLineOffset(relEnd - oldLineStart, oldPrefixLen, newPrefixLen);
    }

    newLines.push(newLine);
    oldCursor = oldLineEnd + 1;
    newCursor += newLine.length + 1;
  });

  const newChunk = newLines.join('\n');
  const newText = text.slice(0, lineStart) + newChunk + text.slice(lineEnd);

  return {
    text: newText,
    selectionStart: lineStart + (mappedStart ?? 0),
    selectionEnd: lineStart + (mappedEnd ?? newChunk.length),
  };
}

export type InsertKind = 'bullet' | 'numbered' | 'quote';

/** Dropdown "Inserir": prefixa cada linha selecionada (ou só a linha do
 *  cursor, sem seleção) com `- `, `1. `/`2. `/... ou `> `. */
export function applyLinePrefix(text: string, start: number, end: number, kind: InsertKind): SelectionResult {
  let counter = 1;
  return transformLines(text, start, end, (line) => {
    const marker = kind === 'bullet' ? '- ' : kind === 'quote' ? '> ' : `${counter++}. `;
    return { newLine: marker + line, oldPrefixLen: 0, newPrefixLen: marker.length };
  });
}

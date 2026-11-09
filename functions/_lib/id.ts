/**
 * ID de comentário pendente: `Date.now()` em base36 + 6 chars aleatórios em
 * base36 -- mesmo padrão que `admin-app/src/github-client.ts` já usa em
 * `uniqueContentImageSuffix()` pra nome de arquivo único. Não precisa ser
 * criptograficamente forte (não é segredo, não é usado pra auth) -- só
 * precisa não colidir entre submissões próximas no tempo, e isso cobre.
 */
export function generatePendingId(): string {
  const timestampBase36 = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${timestampBase36}-${randomSuffix}`;
}

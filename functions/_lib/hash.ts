/**
 * SHA-256 em hex -- usado pra nunca guardar o IP cru do visitante no KV
 * (ver `PendingComment.ip` em `types.ts`). `crypto.subtle` é a Web Crypto
 * API, nativa no runtime do Cloudflare Workers E no Node 18+/20+ -- isso
 * deixa a função testável em vitest sem mock nenhum.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

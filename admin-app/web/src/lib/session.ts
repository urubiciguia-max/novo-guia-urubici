/**
 * Onde o token do GitHub vive entre navegações dentro da SPA.
 *
 * DECISÃO (pedida explicitamente no brief, Severino revisa depois):
 * `sessionStorage`, não `localStorage`. Motivo:
 *  - `localStorage` persiste indefinidamente entre sessões do navegador e é
 *    acessível de qualquer aba da mesma origem -- se um dia existir uma
 *    vulnerabilidade de XSS em QUALQUER página servida dessa origem (não só
 *    o admin), o token fica exposto pra sempre até alguém limpar manualmente.
 *  - `sessionStorage` é escopado à ABA (não vaza pra outras abas/janelas) e
 *    morre quando a aba fecha -- reduz a janela de exposição sem exigir
 *    nenhuma infra extra (não dá pra usar cookie HttpOnly aqui porque não
 *    existe servidor próprio pra setar esse cookie -- é a API do GitHub que
 *    é chamada direto do browser).
 *  - Alternativa considerada e descartada por ora: manter só em memória (zero
 *    storage) + re-login a cada F5. Mais seguro ainda, mas pior UX pra um
 *    painel que o editor deixa aberto o dia inteiro recarregando a página
 *    entre posts. `sessionStorage` é o meio-termo: sobrevive a um F5/reload
 *    da aba, não sobrevive a fechar a aba nem a abrir em outra aba/janela.
 *
 * Isto NÃO neutraliza XSS -- se houver XSS na própria página do admin
 * enquanto a aba está aberta, o token ainda é legível. É mitigação de
 * superfície (defesa em profundidade), não a solução completa; a solução
 * completa seria um backend próprio trocando esse token por uma sessão
 * HttpOnly, que é exatamente o que o escopo deste projeto evita ("zero
 * servidor próprio"). Documentado pra revisão do Severino.
 */
const STORAGE_KEY = 'guia-urubici-admin:gh-token';

export function loadToken(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // sessionStorage pode lançar em contexto restrito (ex: cookies
    // bloqueados, modo privado em alguns navegadores) -- trata como "sem
    // sessão" em vez de derrubar a aplicação.
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Mesma tolerância do load -- se não conseguir persistir, o app ainda
    // funciona com o token em memória (AuthContext) até o próximo reload.
  }
}

export function clearToken(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada a fazer -- melhor esforço.
  }
}

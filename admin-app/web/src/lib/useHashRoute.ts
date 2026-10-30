import { useCallback, useEffect, useState } from 'react';

/**
 * Router minúsculo baseado em hash (`#/dashboard`, `#/posts`,
 * `#/posts/novo`, `#/posts/:slug/editar`) -- sem dependência externa.
 *
 * DECISÃO: hash routing em vez de path routing (`/admin/posts`). Motivo:
 * `/admin/` é servido como arquivo estático puro (Astro `public/`, sem
 * servidor próprio) -- path routing exigiria uma regra de rewrite tipo
 * "qualquer coisa sob /admin/* cai em /admin/index.html" configurada no
 * Cloudflare Pages (`_redirects` ou config do Pages), que é decisão de
 * pipeline do Tião (ainda não feita nesta fase). Hash routing funciona em
 * QUALQUER hospedagem de arquivo estático sem nenhuma config de servidor
 * (o navegador nunca manda o fragmento pro servidor, só pede
 * `/admin/index.html` uma vez e o resto é só JS) -- zero dependência da
 * fase de deploy. Se o Tião configurar o rewrite depois, trocar pra path
 * routing é uma mudança isolada aqui, não espalhada pela UI.
 */
function readHash(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return raw.startsWith('/') ? raw : '/dashboard';
}

export function useHashRoute(): [string, (path: string) => void] {
  const [path, setPath] = useState<string>(readHash);

  useEffect(() => {
    function onHashChange() {
      setPath(readHash());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: string) => {
    if (window.location.hash.replace(/^#/, '') === next) {
      // Mesma rota -- força o estado a refletir mesmo sem disparar
      // `hashchange` (ex: link "Artigos" clicado de dentro de /posts).
      setPath(next);
      return;
    }
    window.location.hash = next;
  }, []);

  return [path, navigate];
}

/** Casa `/posts/:slug/editar` contra o path atual. Devolve o `slug` ou `null`. */
export function matchEditRoute(path: string): string | null {
  const match = /^\/posts\/([^/]+)\/editar$/.exec(path);
  return match ? decodeURIComponent(match[1]) : null;
}

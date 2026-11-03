import { describe, expect, it } from 'vitest';
import { matchEditRoute, matchPageEditRoute } from '../src/lib/useHashRoute';

describe('matchEditRoute', () => {
  it('extrai o slug de uma rota de edição', () => {
    expect(matchEditRoute('/posts/cachoeiras-secretas-urubici/editar')).toBe('cachoeiras-secretas-urubici');
  });

  it('decodifica o slug (encodeURIComponent usado na navegação)', () => {
    expect(matchEditRoute('/posts/caf%C3%A9%20especial/editar')).toBe('café especial');
  });

  it('não casa outras rotas', () => {
    expect(matchEditRoute('/posts')).toBeNull();
    expect(matchEditRoute('/posts/novo')).toBeNull();
    expect(matchEditRoute('/dashboard')).toBeNull();
  });
});

describe('matchPageEditRoute', () => {
  it('extrai o slug de uma rota de página', () => {
    expect(matchPageEditRoute('/pages/sobre-nos')).toBe('sobre-nos');
  });

  it('decodifica o slug (encodeURIComponent usado na navegação)', () => {
    expect(matchPageEditRoute('/pages/pol%C3%ADtica-de-privacidade')).toBe('política-de-privacidade');
  });

  it('não casa outras rotas', () => {
    expect(matchPageEditRoute('/pages')).toBeNull();
    expect(matchPageEditRoute('/posts/sobre-nos')).toBeNull();
    expect(matchPageEditRoute('/dashboard')).toBeNull();
  });
});

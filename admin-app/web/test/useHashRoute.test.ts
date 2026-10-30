import { describe, expect, it } from 'vitest';
import { matchEditRoute } from '../src/lib/useHashRoute';

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

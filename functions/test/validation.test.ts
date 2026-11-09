import { describe, expect, it } from 'vitest';
import { validateSubmissionFields } from '../_lib/validation.js';

describe('validateSubmissionFields', () => {
  it('aceita slug/name/text válidos e aplica trim', () => {
    const result = validateSubmissionFields({
      slug: 'cachoeiras-secretas-urubici',
      name: '  Maria  ',
      text: '  Adorei o passeio, recomendo muito!  ',
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      slug: 'cachoeiras-secretas-urubici',
      name: 'Maria',
      text: 'Adorei o passeio, recomendo muito!',
    });
  });

  it('rejeita slug fora do kebab-case', () => {
    const result = validateSubmissionFields({ slug: 'Cachoeiras_Urubici', name: 'Maria', text: '1234567890' });
    expect(result.ok).toBe(false);
  });

  it('rejeita slug com path traversal', () => {
    const result = validateSubmissionFields({ slug: '../../etc/passwd', name: 'Maria', text: '1234567890' });
    expect(result.ok).toBe(false);
  });

  it('rejeita name menor que o mínimo', () => {
    const result = validateSubmissionFields({ slug: 'cachoeiras-urubici', name: 'M', text: '1234567890' });
    expect(result.ok).toBe(false);
  });

  it('rejeita name maior que o máximo', () => {
    const result = validateSubmissionFields({ slug: 'cachoeiras-urubici', name: 'a'.repeat(81), text: '1234567890' });
    expect(result.ok).toBe(false);
  });

  it('rejeita text menor que o mínimo', () => {
    const result = validateSubmissionFields({ slug: 'cachoeiras-urubici', name: 'Maria', text: 'curto' });
    expect(result.ok).toBe(false);
  });

  it('rejeita text maior que o máximo', () => {
    const result = validateSubmissionFields({ slug: 'cachoeiras-urubici', name: 'Maria', text: 'a'.repeat(2001) });
    expect(result.ok).toBe(false);
  });

  it('rejeita quando algum campo não é string', () => {
    const result = validateSubmissionFields({ slug: null, name: 'Maria', text: '1234567890' });
    expect(result.ok).toBe(false);
  });
});

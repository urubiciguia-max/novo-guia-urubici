import { defineCollection, z } from 'astro:content';

/**
 * Scaffold da collection de posts do blog "Guia Urubici".
 * Nenhum post real ainda — isso e so a base de schema pra quem for
 * escrever conteudo (Maria/Valdisney) encaixar sem precisar redesenhar nada.
 *
 * `cover` usa o helper `image()` do Astro pra ganhar otimizacao automatica
 * (resize/AVIF/WebP) via <Image /> quando houver fotos reais. Enquanto nao
 * houver, deixe o campo de fora do frontmatter — e opcional.
 */
const posts = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      title: z.string().max(90),
      description: z.string().max(160),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      draft: z.boolean().default(false),
    }),
});

export const collections = { posts };

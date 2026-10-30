import type { PostListItem } from '@admin-data/index.js';

export interface PostsFilter {
  search: string;
  category: string | 'all';
  status: 'all' | 'published' | 'draft';
}

export const EMPTY_FILTER: PostsFilter = { search: '', category: 'all', status: 'all' };

/** Função pura (sem React) -- busca por título (client-side) + filtro de categoria/status. Testada isoladamente em `test/filterPosts.test.ts`. */
export function filterPosts(items: PostListItem[], filter: PostsFilter): PostListItem[] {
  const query = filter.search.trim().toLowerCase();
  return items.filter((item) => {
    if (query && !item.title.toLowerCase().includes(query)) return false;
    if (filter.category !== 'all' && item.category !== filter.category) return false;
    if (filter.status === 'published' && item.draft) return false;
    if (filter.status === 'draft' && !item.draft) return false;
    return true;
  });
}

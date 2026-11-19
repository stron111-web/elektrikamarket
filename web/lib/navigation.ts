import type { Category } from './data';

export type MenuCategory = Category & { count: number };
export type NavigationFilters = { q?: string; brand?: number };
export function categoryHref(slug = '', filters: NavigationFilters = {}, products = false) {
  const params = new URLSearchParams();
  if (slug) params.set('category', slug);
  if (filters.q) params.set('q', filters.q);
  if (filters.brand) params.set('brand', String(filters.brand));
  if (products) params.set('view', 'products');
  return '/catalog' + (params.size ? '?' + params.toString() : '');
}
export function categoryTrail(categories: Category[], selected?: Category) {
  const path: Category[] = [], seen = new Set<number>(), byId = new Map(categories.map(c => [c.id,c]));
  let current = selected;
  while (current && !seen.has(current.id)) {
    path.unshift(current); seen.add(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path;
}
export function menuRoots(categories: MenuCategory[]) {
  const known = new Set(categories.map(c => c.id));
  const priority = (c: Category) => c.name === 'Освещение' ? 0 : c.name.startsWith('Низковольтное') ? 1 : c.name.startsWith('Кабели,') ? 2 : 3;
  return categories.filter(c => c.parentId === null || !known.has(c.parentId)).sort((a,b) => priority(a)-priority(b));
}

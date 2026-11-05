import type { Category, Variant } from './types';
export const variants = [
  { id: 1 as Variant, name: 'Быстрое меню', reference: 'Логика DNS', description: 'Все уровни под рукой. Выберите раздел слева и переходите сразу в нужную товарную группу.' },
  { id: 2 as Variant, name: 'Шаг за шагом', reference: 'Логика ВсеИнструменты', description: 'Крупные разделы и наглядные страницы подкатегорий. Удобно спокойно изучать ассортимент.' },
  { id: 3 as Variant, name: 'Два пути к товару', reference: 'Гибрид', description: 'Быстрое меню для знакомых задач и обзор раздела с контекстной навигацией для новых.' },
];
export function href(v: Variant, category = '', q = '', page = 1, products = false) {
  const p = new URLSearchParams();
  if (category) p.set('category', category);
  if (q) p.set('q', q);
  if (page > 1) p.set('page', String(page));
  if (products) p.set('view', 'products');
  return `/demo/catalog-v${v}` + (p.size ? '?' + p : '');
}
export function roots(categories: Category[]) {
  const ids = new Set(categories.map(c => c.id));
  const priority = (c: Category) => /^Освещение$/.test(c.name) ? 0 : /^Низковольтное/.test(c.name) ? 1 : /^Кабели,/.test(c.name) ? 2 : 3;
  return categories.filter(c => c.parentId === null || !ids.has(c.parentId)).sort((a, b) => priority(a) - priority(b));
}
export function trail(categories: Category[], category?: Category) {
  const path: Category[] = [], seen = new Set<number>(), byId = new Map(categories.map(c => [c.id, c]));
  let current = category;
  while (current && !seen.has(current.id)) { path.unshift(current); seen.add(current.id); current = current.parentId === null ? undefined : byId.get(current.parentId); }
  return path;
}
export function iconKey(name: string) {
  if (/освещ|ламп/i.test(name)) return 'light';
  if (/кабеленес|прокладки кабел/i.test(name)) return 'trunking';
  if (/кабел|провод/i.test(name)) return 'cable';
  if (/низковол|выключател/i.test(name)) return 'lv';
  if (/высоковол|щитов/i.test(name)) return 'hv';
  if (/климат/i.test(name)) return 'climate';
  if (/телеком|связь/i.test(name)) return 'telecom';
  if (/электроустанов/i.test(name)) return 'install';
  if (/питания|генератор/i.test(name)) return 'power';
  if (/безопасн|защит/i.test(name)) return 'safety';
  if (/инструмент/i.test(name)) return 'tools';
  return 'wiring';
}
export function examples(categories: Category[]) {
  return [/^Лампы \(источники света\)$/i, /^Выключатель автоматический модульный$/i, /^Кабели и провода$/i]
    .flatMap(re => { const c = categories.find(c => re.test(c.name)); return c ? [c] : []; });
}

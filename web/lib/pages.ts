import 'server-only';
import { shop } from './shop';

export const pageSlugs = {
  about: 'О компании',
  contacts: 'Контакты',
  requisites: 'Реквизиты',
  delivery: 'Оплата и доставка',
  legal: 'Правовая информация',
  certificates: 'Сертификаты',
  brands: 'Производители',
} as const;

export type PageSlug = keyof typeof pageSlugs;

export function isPageSlug(value: string): value is PageSlug {
  return value in pageSlugs;
}

export async function savedPage(slug: string) {
  if (!isPageSlug(slug)) return null;
  try {
    const rows = await shop()<{ body: string | null }[]>`SELECT body FROM pages WHERE slug = ${slug}`;
    const body = rows[0]?.body?.trim();
    return body ? body : null;
  } catch {
    return null;
  }
}

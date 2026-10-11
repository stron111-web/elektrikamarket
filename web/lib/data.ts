import 'server-only';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'node:path';
import { readStorefrontPrices, readAvailableStocks } from '../../scripts/import/pricat-store.cjs';

const root = path.resolve(process.cwd(), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const globalDb = globalThis as unknown as { storefrontDb?: ReturnType<typeof postgres> };
function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required on the server');
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')) throw new Error('PostgreSQL public schema required');
  url.searchParams.delete('schema');
  return globalDb.storefrontDb ??= postgres(url.toString(), {
    max: 4, idle_timeout: 20, connect_timeout: 10,
    connection: { application_name: 'elektrikamarket-storefront', default_transaction_read_only: true, search_path: 'public' },
    onnotice: () => {},
  });
}
export type Category = { id: number; name: string; slug: string; parentId: number | null };
export type Price = { supplierCode: string; priceSource: string; retailPrice: string; currency: string; uom: string };
export type Stock = { warehouse: string; quantity: string; uom: string };
export type Product = { id: number; supplierCode: string; vendorNumber: string | null; name: string; slug: string; brand: string | null; category: string | null; categorySlug: string | null; image: string | null; description: string | null; [key: string]: unknown };
export type Item = Product & { price: Price | null; stocks: Stock[] };
export type Filters = { q: string; category: string; brand: number; page: number };
export const PAGE_SIZE = 24;
export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const one = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const integer = (s: string, fallback: number) => /^\d{1,7}$/.test(s) && Number(s) > 0 ? Number(s) : fallback;
  return { q: one('q').trim().slice(0, 120), category: one('category').slice(0, 200), brand: integer(one('brand'), 0), page: integer(one('page'), 1) };
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
async function commercial(tx: postgres.TransactionSql, rows: Product[]): Promise<Item[]> {
  const codes = rows.map(p => p.supplierCode);
  const prices: Price[] = await readStorefrontPrices(tx, codes);
  const stocks: (Stock & { supplierCode: string })[] = await readAvailableStocks(tx, codes);
  const byPrice = new Map(prices.map(p => [p.supplierCode, p]));
  return rows.map(p => ({ ...p, price: byPrice.get(p.supplierCode) ?? null, stocks: stocks.filter(s => s.supplierCode === p.supplierCode) }));
}
export async function catalog(filters: Filters) {
  return database().begin('isolation level repeatable read read only', async tx => {
    const categories = await tx<Category[]>`SELECT id,name,slug,"parentId" FROM categories WHERE NOT "isArchived" ORDER BY name`;
    const brands = await tx<{ id: number; name: string }[]>`SELECT id,name FROM brands ORDER BY name`;
    const ids = new Set<number>();
    const selected = categories.find(c => c.slug === filters.category);
    if (selected) { ids.add(selected.id); for (let changed = true; changed;) { changed = false; for (const c of categories) if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) { ids.add(c.id); changed = true; } } }
    // Escape LIKE metacharacters: search text is literal, all values parameterized.
    const term = '%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%';
    const categoryIds = [...ids, -1];
    const where = tx`NOT p."isArchived" AND (${!filters.q} OR p.name ILIKE ${term} OR p."supplierCode" ILIKE ${term} OR p."vendorNumber" ILIKE ${term}) AND (${!filters.category} OR p."categoryId" IN ${tx(categoryIds)}) AND (${!filters.brand} OR p."brandId"=${filters.brand})`;
    const [{ total }] = await tx<{ total: number }[]>`SELECT count(*)::int total FROM products p WHERE ${where}`;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)); const page = Math.min(filters.page, pages);
    const rows = await tx<Product[]>`SELECT p.id,p."supplierCode",p."vendorNumber",p.name,p.slug,b.name brand,c.name category,c.slug "categorySlug",NULL::text description,(SELECT url FROM product_images i WHERE i."productId"=p.id ORDER BY "sortOrder",id LIMIT 1) image FROM products p LEFT JOIN brands b ON b.id=p."brandId" LEFT JOIN categories c ON c.id=p."categoryId" WHERE ${where} ORDER BY p.id LIMIT ${PAGE_SIZE} OFFSET ${(page-1)*PAGE_SIZE}`;
    return { categories, brands, total, pages, page, items: await commercial(tx, rows) };
  });
}
export async function product(slug: string) {
  return database().begin('isolation level repeatable read read only', async tx => {
    const rows = await tx<Product[]>`SELECT p.*,b.name brand,c.name category,c.slug "categorySlug",NULL::text image FROM products p LEFT JOIN brands b ON b.id=p."brandId" LEFT JOIN categories c ON c.id=p."categoryId" WHERE p.slug=${slug} AND NOT p."isArchived" LIMIT 1`;
    if (!rows.length) return null;
    const [item] = await commercial(tx, rows);
    const images = await tx<{ url: string; alt: string | null }[]>`SELECT url,alt FROM product_images WHERE "productId"=${item.id} ORDER BY "sortOrder",id`;
    const documents = await tx<{ type: string; name: string | null; url: string }[]>`SELECT type,name,url FROM product_documents WHERE "productId"=${item.id} ORDER BY "sortOrder",id`;
    // Packaging must follow the chosen sale price's source, never the PRODAT context.
    const packaging = item.price ? await tx`SELECT uom,"itemsPerUnit","itemsPerUom",multiplicity,"multiplicityRaw" FROM product_commercial_data WHERE "productId"=${item.id} AND source::text=${item.price.priceSource}` : [];
    return { item, images, documents, packaging: packaging[0] ?? null };
  });
}

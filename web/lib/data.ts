import 'server-only';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'node:path';
import { readStorefrontPrices, readAvailableStocks } from '../../scripts/import/pricat-store.cjs';
import { availabilitySql } from './availability.cjs';

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
export type Item = Product & { price: Price | null; stocks: Stock[]; priceAbsent: boolean };
export type Filters = { q: string; category: string; brand: number; page: number; availability: 'stock' | 'all' };
export const PAGE_SIZE = 24;
export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const one = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const integer = (s: string, fallback: number) => /^\d{1,7}$/.test(s) && Number(s) > 0 ? Number(s) : fallback;
  return { q: one('q').trim().slice(0, 120), category: one('category').slice(0, 200), brand: integer(one('brand'), 0), page: integer(one('page'), 1), availability: one('availability') === 'all' ? 'all' : 'stock' };
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
  const missing = codes.filter(code => !byPrice.has(code));
  const evidence = missing.length ? await tx<{ supplierCode: string }[]>`
    SELECT p."supplierCode" FROM public.products p WHERE p."supplierCode" IN ${tx(missing)}
    AND (EXISTS(SELECT 1 FROM public.product_commercial_data c WHERE c."productId"=p.id)
      OR EXISTS(SELECT 1 FROM public.import_issues i JOIN public.import_files f ON f.id=i."fileId"
        JOIN public.import_runs r ON r.id=f."runId"
        WHERE i."supplierCode"=p."supplierCode" AND f.source IN ('PRICAT1','PRICAT2')
          AND f.status='SUCCEEDED' AND r.status='SUCCEEDED'))` : [];
  const known = new Set(evidence.map(p => p.supplierCode));
  return rows.map(p => ({ ...p, price: byPrice.get(p.supplierCode) ?? null,
    stocks: stocks.filter(s => s.supplierCode === p.supplierCode),
    priceAbsent: !byPrice.has(p.supplierCode) && !known.has(p.supplierCode) }));
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
    const candidates = tx`SELECT p.id,p."supplierCode" FROM products p WHERE ${where}`;
    const eligible = filters.availability === 'all'
      ? tx`SELECT id FROM (${candidates}) candidates`
      : tx`SELECT p.id FROM public.products p JOIN (SELECT DISTINCT "supplierCode" FROM (${(await availabilitySql(tx, tx`SELECT "supplierCode" FROM (${candidates}) candidates`)).query}) available_stocks) available ON available."supplierCode"=p."supplierCode"`;
    // Materialize matching ids once in PostgreSQL: exact count and page use the
    // same snapshot/set. Only the page's product data reaches the application.
    const [{ total, rows }] = await tx<{ total: number; rows: Product[] }[]>`
      WITH eligible AS MATERIALIZED (${eligible}),
      tally AS (SELECT count(*)::int total FROM eligible),
      page AS (
        SELECT p.id,p."supplierCode",p."vendorNumber",p.name,p.slug,b.name brand,
          c.name category,c.slug "categorySlug",NULL::text description,
          (SELECT url FROM public.product_images i WHERE i."productId"=p.id ORDER BY "sortOrder",id LIMIT 1) image
        FROM eligible e JOIN public.products p ON p.id=e.id
        LEFT JOIN public.brands b ON b.id=p."brandId"
        LEFT JOIN public.categories c ON c.id=p."categoryId"
        ORDER BY p.id LIMIT ${PAGE_SIZE}
        OFFSET (SELECT (least(${filters.page},greatest(ceil(total::numeric/${PAGE_SIZE})::int,1))-1)*${PAGE_SIZE} FROM tally)
      )
      SELECT total,coalesce((SELECT jsonb_agg(page ORDER BY id) FROM page),'[]'::jsonb) rows FROM tally`;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)); const page = Math.min(filters.page, pages);
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

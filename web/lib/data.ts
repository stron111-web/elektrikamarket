import 'server-only';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'node:path';
import {readSnapshotOffers,activeAssortment} from '../../scripts/storefront/assortment.cjs';
import {readCatalog,attachSnapshotOffers} from '../../scripts/storefront/catalog.cjs';

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
export type Item = Product & { price: Price | null; stocks: Stock[]; priceAbsent: boolean; offerUnavailable: boolean };
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
type CatalogData = {categories: Category[];brands:{id:number;name:string}[];total:number;pages:number;page:number;searchMode:"catalog"|"strict"|"typo";items:Item[]};
export async function catalog(filters: Filters): Promise<CatalogData> {
  return await database().begin('isolation level repeatable read read only', tx => readCatalog(tx,filters)) as unknown as CatalogData;
}
/** Итог для клиента с наценкой. Закупочную цену наружу не возвращает. */
export async function markupPrices(ids: number[], percent: string) {
  if (!ids.length) return new Map<number, string>();
  const rows = await database()<{ product_id: number; price: string | null }[]>`
    SELECT product_id, price::text FROM buyer_markup_price(${ids}::integer[], ${percent}::numeric)`;
  return new Map(rows.flatMap((row) => row.price ? [[row.product_id, row.price] as const] : []));
}

export async function offerPacks(ids: number[]) {
  if (!ids.length) return new Map<number, { multiplicity: string | null; multiplicityRaw: string | null }>();
  return database().begin('isolation level repeatable read read only', async (tx) => {
    const snapshot = await activeAssortment(tx);
    const offers = await readSnapshotOffers(tx, snapshot.id, ids) as { productId: number; multiplicity: string | null; multiplicityRaw: string | null }[];
    return new Map(offers.map((offer) => [offer.productId, { multiplicity: offer.multiplicity, multiplicityRaw: offer.multiplicityRaw }]));
  });
}

export async function productCode(id: number) {
  const rows = await database()<{ code: string }[]>`SELECT "supplierCode" AS code FROM products WHERE id = ${id} AND NOT "isArchived" LIMIT 1`;
  return rows[0]?.code ?? null;
}

export type ListedProduct = { item: Item; packaging: { itemsPerUnit: string | null; itemsPerUom: string | null; multiplicityRaw: string | null } | null };

export async function productsForLists(ids: number[]): Promise<ListedProduct[]> {
  if (!ids.length) return [];
  return database().begin('isolation level repeatable read read only', async (tx) => {
    const rows = await tx<Product[]>`
      SELECT p.id, p."supplierCode", p.name, p.slug, p."vendorNumber", p.description, p.series, p.countries,
        p."guaranteePeriod", p.weight, p."weightUnit", p.depth, p.width, p.height, p."dimensionUnit",
        p.tnved, p.okpd2, p.gost, p.ty, b.name brand
      FROM products p LEFT JOIN brands b ON b.id = p."brandId"
      WHERE p.id IN ${tx(ids)} AND NOT p."isArchived"`;
    const snapshot = await activeAssortment(tx);
    const items = await attachSnapshotOffers(tx, snapshot.id, rows) as Item[];
    const offers = await readSnapshotOffers(tx, snapshot.id, ids) as { productId: number; itemsPerUnit: string | null; itemsPerUom: string | null; multiplicityRaw: string | null }[];
    const byId = new Map(items.map((item) => [item.id, item]));
    const packaging = new Map(offers.map((offer) => [offer.productId, offer]));
    return ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [{ item, packaging: packaging.get(id) ?? null }] : [];
    });
  });
}

export async function product(slug: string) {
  return database().begin('isolation level repeatable read read only', async tx => {
    const rows = await tx<Product[]>`SELECT p.*,b.name brand,c.name category,c.slug "categorySlug",NULL::text image FROM products p LEFT JOIN brands b ON b.id=p."brandId" LEFT JOIN categories c ON c.id=p."categoryId" WHERE p.slug=${slug} AND NOT p."isArchived" LIMIT 1`;
    if (!rows.length) return null;
    const snapshot=await activeAssortment(tx);
    const [item] = await attachSnapshotOffers(tx,snapshot.id,rows) as Item[];
    const images = await tx<{ url: string; alt: string | null }[]>`SELECT url,alt FROM product_images WHERE "productId"=${item.id} ORDER BY "sortOrder",id`;
    const documents = await tx<{ type: string; name: string | null; url: string }[]>`SELECT type,name,url FROM product_documents WHERE "productId"=${item.id} ORDER BY "sortOrder",id`;
    const offers = await readSnapshotOffers(tx,snapshot.id,[item.id]);
    return { item, images, documents, packaging: offers[0] ?? null };
  });
}

/** Source category hierarchy for navigation; read-only, separate from shop data. */
export async function catalogCategories(): Promise<Category[]> {
  // Next.js prerenders the not-found shell at build time without a database secret.
  if (!process.env.DATABASE_URL) return [];
  return database()<Category[]>`SELECT id,name,slug,"parentId" FROM categories WHERE NOT "isArchived" ORDER BY name`;
}

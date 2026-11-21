import 'server-only';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'node:path';
import { cache } from 'react';
import type { MenuCategory } from './navigation';
import {readSnapshotOffers,activeAssortment} from '../../scripts/storefront/assortment.cjs';
import {readCatalog,attachSnapshotOffers} from '../../scripts/storefront/catalog.cjs';
import {parseCatalogFilters} from '../../scripts/storefront/filters.cjs';
import {readEtimPage,etimRequest} from '../../scripts/storefront/etim.cjs';
import {productFeatures} from './product-features.cjs';

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
// Navigation counts use the accepted commercial snapshot; no trading recomputation.
// React cache shares this read within one request only, including header and page.
export const navigation = cache(async (): Promise<MenuCategory[]> => database().begin('isolation level repeatable read read only', async tx => {
  const snapshot = await activeAssortment(tx);
  const rows = await tx<(Category & {directCount:number})[]>`
    SELECT c.id,c.name,c.slug,c."parentId",coalesce(n.total,0)::int "directCount"
    FROM categories c LEFT JOIN (
      SELECT p."categoryId",count(*)::int total FROM assortment_items a JOIN products p ON p.id=a."productId"
      WHERE a."snapshotId"=${snapshot.id} AND NOT p."isArchived" GROUP BY p."categoryId"
    ) n ON n."categoryId"=c.id WHERE NOT c."isArchived" ORDER BY c.name`;
  const counts = new Map(rows.map(c => [c.id,0])), byId = new Map(rows.map(c => [c.id,c]));
  for (const row of rows) {
    const seen = new Set<number>(); let c: Category | undefined = row;
    while (c && !seen.has(c.id)) { seen.add(c.id); counts.set(c.id,(counts.get(c.id) ?? 0)+row.directCount); c=c.parentId===null ? undefined : byId.get(c.parentId); }
  }
  return rows.map(({directCount: _direct,...c}) => ({...c,count:counts.get(c.id) ?? 0}));
}));
export type Price = { supplierCode: string; priceSource: string; retailPrice: string; currency: string; uom: string };
export type Stock = { warehouse: string; quantity: string; uom: string };
export type Product = { id: number; supplierCode: string; vendorNumber: string | null; name: string; slug: string; brand: string | null; category: string | null; categorySlug: string | null; image: string | null; description: string | null; [key: string]: unknown };
export type Item = Product & { price: Price | null; stocks: Stock[]; priceAbsent: boolean; offerUnavailable: boolean };
export type EtimSelection = {code:string|null;name:string;uom:string|null;values:string[]};
export type Filters = { q: string; category: string; brand: number; page: number; minPrice:string; maxPrice:string; stock:string;sort:string;etim:EtimSelection[] };
export const PAGE_SIZE = 24;
export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  return parseCatalogFilters(params);
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
export type EtimFacet = {code:string|null;name:string;uom:string|null;coverage:number;variants:number;nextOffset:number|null;loaded?:boolean;options:{value:string;total:number;token:string}[]};
export type CatalogFacets = {minPrice:string|null;maxPrice:string|null;stocks:{warehouse:string;total:number}[];etim:EtimFacet[];etimTotal:number;etimNextOffset:number|null;etimSnapshot:string};
export async function etimPage(params:Record<string,string>){
 const request=etimRequest(params);
 return database().begin('isolation level repeatable read read only',async tx=>readEtimPage(tx,request,await activeAssortment(tx)));
}
type CatalogData = {categories: Category[];brands:{id:number;name:string}[];facets:CatalogFacets;total:number;pages:number;page:number;searchMode:"catalog"|"strict"|"typo";items:Item[]};
export async function catalog(filters: Filters): Promise<CatalogData> {
  return await database().begin('isolation level repeatable read read only', tx => readCatalog(tx,filters)) as unknown as CatalogData;
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
    // Only this product and the five already-authorized public columns. No LIMIT:
    // disclosure on the page must never discard characteristics after the first 12.
    const features = await tx<{featureCode:string|null;featureName:string;featureValue:string;featureUom:string|null}[]>`
      SELECT "featureCode","featureName","featureValue","featureUom" FROM product_features WHERE "productId"=${item.id}`;
    return { item, images, documents, features:productFeatures(features), packaging: offers[0] ?? null };
  });
}

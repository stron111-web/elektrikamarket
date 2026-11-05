import 'server-only';
import postgres from 'postgres';
import { activeAssortment } from '../../../scripts/storefront/assortment.cjs';
import { readCatalog, attachSnapshotOffers } from '../../../scripts/storefront/catalog.cjs';
import type { Category, Filters, Snapshot, Catalog, Item } from './types';
// This application never loads a writer secret or the Preview customer/session modules.
const globalDb = globalThis as unknown as { catalogDemoDb?: ReturnType<typeof postgres> };
function database() {
  const u = new URL(process.env.DATABASE_URL || '');
  if (decodeURIComponent(u.username) !== 'storefront_test_ro' || u.pathname !== '/elektrikamarket_test_20261029t010219z_2761a73c') throw Error('Read-only demo target required');
  u.searchParams.delete('schema');
  return globalDb.catalogDemoDb ??= postgres(u.toString(), { max: 3, idle_timeout: 20, connect_timeout: 10,
    connection: { default_transaction_read_only: true, statement_timeout: 15000, application_name: 'elektrikamarket-catalog-demo' }, onnotice: () => {} });
}
export async function loadCatalog(filters: Filters, variant: number, forceProducts: boolean) {
  return database().begin('isolation level repeatable read read only', async tx => {
    const active = await activeAssortment(tx);
    const snapshot: Snapshot = { id: String(active.id), productCount: active.productCount, createdAt: active.createdAt.toISOString() };
    const categories = await tx<Category[]>`SELECT id,name,slug,"parentId",0::int count FROM categories WHERE NOT "isArchived" ORDER BY name`;
    const counts = await tx<{ id: number; count: number }[]>`SELECT p."categoryId" id,count(*)::int count FROM assortment_items a JOIN products p ON p.id=a."productId" WHERE a."snapshotId"=${active.id} AND NOT p."isArchived" GROUP BY p."categoryId"`;
    const byId = new Map(categories.map(c => [c.id, c]));
    for (const row of counts) { let c = byId.get(row.id); const seen = new Set<number>(); while (c && !seen.has(c.id)) { seen.add(c.id); c.count += row.count; c = c.parentId === null ? undefined : byId.get(c.parentId); } }
    const selected = categories.find(c => c.slug === filters.category);
    const children = categories.filter(c => c.parentId === selected?.id);
    const showProducts = Boolean(filters.q || forceProducts || (selected && (variant === 1 || children.length === 0)));
    const catalog = showProducts ? await readCatalog(tx, filters) as Catalog : null;
    return { snapshot, categories, selected, children, catalog };
  });
}
export async function loadProduct(slug: string): Promise<Item | null> {
  return database().begin('isolation level repeatable read read only', async tx => {
    const active = await activeAssortment(tx);
    const rows = await tx`SELECT p.id,p.name,p.slug,p."supplierCode",p."vendorNumber",p.description,b.name brand,c.name category,c.slug "categorySlug",(SELECT url FROM product_images i WHERE i."productId"=p.id ORDER BY "sortOrder",id LIMIT 1) image FROM products p JOIN assortment_items a ON a."productId"=p.id AND a."snapshotId"=${active.id} LEFT JOIN brands b ON b.id=p."brandId" LEFT JOIN categories c ON c.id=p."categoryId" WHERE p.slug=${slug} AND NOT p."isArchived" LIMIT 1`;
    const items = await attachSnapshotOffers(tx, active.id, rows) as Item[];
    return items[0] ?? null;
  });
}
export const safeImage = (value: string | null) => { try { const u = new URL(value || ''); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };

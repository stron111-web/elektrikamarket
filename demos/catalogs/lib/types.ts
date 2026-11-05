export type Category = { id: number; name: string; slug: string; parentId: number | null; count: number };
export type Snapshot = { id: string; productCount: number; createdAt: string };
export type Variant = 1 | 2 | 3;
export type Filters = { q: string; category: string; page: number; brand: number };
export type Item = { id: number; supplierCode: string; name: string; slug: string; vendorNumber: string | null; brand: string | null; category: string | null; categorySlug: string | null; image: string | null; description?: string | null; price: { retailPrice: string; uom: string; currency: string } | null; stocks: { warehouse: string; quantity: string; uom: string }[] };
export type Catalog = { items: Item[]; total: number; page: number; pages: number; searchMode: string };

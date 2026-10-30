'use strict';
const {activeAssortment,readSnapshotOffers}=require('./assortment.cjs');
async function attachSnapshotOffers(tx,snapshotId,rows) {
  const offers=await readSnapshotOffers(tx,snapshotId,rows.map(p=>p.id));
  const byId=new Map(offers.map(o=>[o.productId,o]));
  return rows.map(p=>{
    const o=byId.get(p.id);
    return {...p,price:o?{supplierCode:p.supplierCode,priceSource:o.priceSource,
      retailPrice:o.retailPrice,currency:o.currency,uom:o.uom}:null,
      stocks:o?.stocks ?? [],priceAbsent:false,offerUnavailable:!o};
  });
}
// Caller holds one REPEATABLE READ READ ONLY transaction for count, page and offers.
async function readCatalog(tx,filters) {
  // Fragment selectivity varies by orders of magnitude. A cached generic plan
  // can scan Product.id for a rare article despite the GIN indices. This setting
  // is scoped to the caller's read-only transaction, never the server/session.
  if(filters.q)await tx`SET LOCAL plan_cache_mode=force_custom_plan`;
  const snapshot=await activeAssortment(tx);
  const categories=await tx`SELECT id,name,slug,"parentId" FROM categories WHERE NOT "isArchived" ORDER BY name`;
  const brands=await tx`SELECT id,name FROM brands ORDER BY name`;
  const ids=new Set(),selected=categories.find(c=>c.slug===filters.category);
  if(selected){ids.add(selected.id);for(let changed=true;changed;){changed=false;for(const c of categories)if(c.parentId&&ids.has(c.parentId)&&!ids.has(c.id)){ids.add(c.id);changed=true;}}}
  const term='%'+filters.q.replace(/[\\%_]/g,'\\$&')+'%';
  // Compose only supplied filters: avoid generic plans for boolean OR switches.
  const search=filters.q?tx`(p.name ILIKE ${term} OR p."supplierCode" ILIKE ${term} OR p."vendorNumber" ILIKE ${term})`:tx`TRUE`;
  const category=filters.category?tx`p."categoryId" IN ${tx([...ids,-1])}`:tx`TRUE`;
  const brand=filters.brand?tx`p."brandId"=${filters.brand}`:tx`TRUE`;
  const where=tx`NOT p."isArchived" AND ${search} AND ${category} AND ${brand}`;
  const from=tx`assortment_items a JOIN products p ON p.id=a."productId"`;
  const eligible=tx`${where} AND a."snapshotId"=${snapshot.id}`;
  const [{total}]=await tx`SELECT count(*)::int total FROM ${from} WHERE ${eligible}`;
  const pages=Math.max(1,Math.ceil(total/24)),page=Math.min(filters.page,pages);
  const rows=await tx`SELECT p.id,p."supplierCode",p."vendorNumber",p.name,p.slug,b.name brand,
    c.name category,c.slug "categorySlug",NULL::text description,
    (SELECT url FROM product_images i WHERE i."productId"=p.id ORDER BY "sortOrder",id LIMIT 1) image
    FROM ${from} LEFT JOIN brands b ON b.id=p."brandId" LEFT JOIN categories c ON c.id=p."categoryId"
    WHERE ${eligible} ORDER BY p.id LIMIT 24 OFFSET ${(page-1)*24}`;
  return {categories,brands,total,pages,page,items:await attachSnapshotOffers(tx,snapshot.id,rows)};
}
module.exports={readCatalog,attachSnapshotOffers};

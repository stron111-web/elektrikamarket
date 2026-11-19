'use strict';
const {activeAssortment,readSnapshotOffers}=require('./assortment.cjs');
const {searchPlan}=require('./search.cjs');
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
  const ids=new Set(),selected=categories.find(c=>c.slug===filters.category);
  if(selected){ids.add(selected.id);for(let changed=true;changed;){changed=false;for(const c of categories)if(c.parentId&&ids.has(c.parentId)&&!ids.has(c.id)){ids.add(c.id);changed=true;}}}
  let search=searchPlan(tx,filters.q);
  const category=filters.category?tx`p."categoryId" IN ${tx([...ids,-1])}`:tx`TRUE`;
  const brand=filters.brand?tx`p."brandId"=${filters.brand}`:tx`TRUE`;
  const from=tx`assortment_items a JOIN products p ON p.id=a."productId"`;
  const base=tx`NOT p."isArchived" AND ${category} AND a."snapshotId"=${snapshot.id}`;
  // Options are real accepted offers in this category, never the full PRODAT.
  const brands=await tx`SELECT b.id,b.name FROM ${from} JOIN brands b ON b.id=p."brandId" WHERE ${base} GROUP BY b.id,b.name ORDER BY b.name`;
  const [range]=await tx`SELECT min(a."retailPrice")::text "minPrice",max(a."retailPrice")::text "maxPrice" FROM ${from} WHERE ${base}`;
  const stocks=await tx`SELECT s->>'warehouse' warehouse,count(*)::int total FROM ${from} CROSS JOIN LATERAL jsonb_array_elements(a.stocks) s WHERE ${base} GROUP BY s->>'warehouse' ORDER BY warehouse`;
  // Filter only published sale prices and permitted stocks; no live rule rebuild.
  const priceMin=filters.minPrice?tx`a."retailPrice">=${filters.minPrice}::numeric`:tx`TRUE`;
  const priceMax=filters.maxPrice?tx`a."retailPrice"<=${filters.maxPrice}::numeric`:tx`TRUE`;
  const stock=['stock1','stock2','stock3'].includes(filters.stock)?tx`a.stocks @> ${tx.json([{warehouse:filters.stock}])}::jsonb`:tx`TRUE`;
  const where=tx`NOT p."isArchived" AND ${category} AND ${brand} AND ${priceMin} AND ${priceMax} AND ${stock}`;
  let eligible=tx`${where} AND ${search.where} AND a."snapshotId"=${snapshot.id}`;
  let [{total}]=await tx`SELECT count(*)::int total FROM ${from} WHERE ${eligible}`;
  let searchMode=filters.q?'strict':'catalog';
  if(!total&&search.canFuzzy){
    await tx`SET LOCAL pg_trgm.word_similarity_threshold=0.3`;
    search=searchPlan(tx,filters.q,{fuzzy:true});
    eligible=tx`${where} AND ${search.where} AND a."snapshotId"=${snapshot.id}`;
    [{total}]=await tx`SELECT count(*)::int total FROM ${from} WHERE ${eligible}`;
    searchMode=total?'typo':'strict';
  }
  const pages=Math.max(1,Math.ceil(total/24)),page=Math.min(filters.page,pages);
  const rows=await tx`SELECT p.id,p."supplierCode",p."vendorNumber",p.name,p.slug,b.name brand,
    c.name category,c.slug "categorySlug",NULL::text description,
    (SELECT url FROM product_images i WHERE i."productId"=p.id ORDER BY "sortOrder",id LIMIT 1) image
    FROM ${from} LEFT JOIN brands b ON b.id=p."brandId" LEFT JOIN categories c ON c.id=p."categoryId"
    WHERE ${eligible} ORDER BY ${search.order} LIMIT 24 OFFSET ${(page-1)*24}`;
  return {categories,brands,facets:{...range,stocks},total,pages,page,searchMode,items:await attachSnapshotOffers(tx,snapshot.id,rows)};
}
module.exports={readCatalog,attachSnapshotOffers};

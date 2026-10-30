'use strict';
const fs=require('fs'),assert=require('assert/strict'),postgres=require('postgres');
const {performance}=require('perf_hooks'),{stripTypeScriptTypes}=require('module');
const {buildAssortmentSnapshot,activeAssortment}=require('./assortment.cjs');
const {readCatalog}=require('./catalog.cjs');
const {readStorefrontPrices,readAvailableStocks,availableStocksQuery}=require('../import/pricat-store.cjs');
if(!process.env.ASSORTMENT_COPY_URL)throw new Error('Explicit ASSORTMENT_COPY_URL for an isolated copy is required');
const db=postgres(process.env.ASSORTMENT_COPY_URL,{max:1,onnotice:()=>{},connection:{statement_timeout:'60s'}});
const filters=v=>({q:'',category:'',brand:0,page:1,availability:'stock',...v});
const shape=d=>({total:d.total,pages:d.pages,page:d.page,items:d.items.map(p=>({id:p.id,price:p.price,stocks:p.stocks.map(({warehouse,quantity,uom,source})=>({warehouse,quantity,uom,source}))}))});
(async()=>{try{
 const before=await db.unsafe('SELECT (SELECT count(*) FROM products)::int products,(SELECT count(*) FROM product_prices)::int prices,(SELECT count(*) FROM product_stocks)::int stocks,(SELECT count(*) FROM import_issues)::int issues');
 let t=performance.now();const snap=await db.begin(tx=>buildAssortmentSnapshot(tx));console.log('COPY_BUILD '+JSON.stringify({ms:+(performance.now()-t).toFixed(2),products:snap.productCount}));
 await db.begin('isolation level repeatable read read only',async tx=>{
  const active=await activeAssortment(tx),available=await availableStocksQuery(tx,tx.unsafe('SELECT "supplierCode" FROM products WHERE NOT "isArchived"'));
  const [diff]=await tx`WITH expected AS MATERIALIZED (${available.query}),
   actual AS MATERIALIZED (
    SELECT p."supplierCode",s->>'warehouse' warehouse,(s->>'quantity')::numeric quantity,s->>'uom' uom,
     s->>'source' source,a."priceSource"::text "priceSource",a."retailPrice",a.currency
    FROM assortment_items a JOIN products p ON p.id=a."productId"
    CROSS JOIN jsonb_array_elements(a.stocks) s WHERE a."snapshotId"=${active.id}
   )
   SELECT (SELECT count(*) FROM (SELECT "supplierCode",warehouse,quantity,uom,source::text,"priceSource"::text,"retailPrice",currency FROM expected
    EXCEPT ALL SELECT * FROM actual) missing)::int missing,
    (SELECT count(*) FROM (SELECT * FROM actual EXCEPT ALL
     SELECT "supplierCode",warehouse,quantity,uom,source::text,"priceSource"::text,"retailPrice",currency FROM expected) extra)::int extra`;
  assert.equal(diff.missing,0);assert.equal(diff.extra,0);
  const [context]=await tx.unsafe('SELECT count(*)::int invalid FROM assortment_items a JOIN product_commercial_data c ON c."productId"=a."productId" AND c.source=a."priceSource" JOIN product_prices p ON p."commercialDataId"=c.id WHERE a."snapshotId"=$1 AND (a."purchasePrice" IS DISTINCT FROM p."price2" OR a."itemsPerUnit" IS DISTINCT FROM c."itemsPerUnit" OR a."itemsPerUom" IS DISTINCT FROM c."itemsPerUom" OR a.multiplicity IS DISTINCT FROM c.multiplicity OR a."multiplicityRaw" IS DISTINCT FROM c."multiplicityRaw")',[active.id]);
  assert.equal(context.invalid,0);console.log('COPY_EQUIVALENCE '+JSON.stringify({missing:diff.missing,extra:diff.extra,invalidCostOrPackage:context.invalid}));
 });
 let legacy=fs.readFileSync('/checks/legacy-data.ts','utf8');legacy=legacy.slice(legacy.indexOf('export type Category'));
 legacy=stripTypeScriptTypes(legacy).replace(/export /g,'').replaceAll('database().begin','db.begin');
 const old=new Function('db','readStorefrontPrices','readAvailableStocks','availabilitySql',legacy+';return {catalog};')(db,readStorefrontPrices,readAvailableStocks,availableStocksQuery);
 const [sample]=await db.unsafe('SELECT p."brandId",c.slug FROM assortment_items a JOIN products p ON p.id=a."productId" LEFT JOIN categories c ON c.id=p."categoryId" JOIN assortment_snapshots s ON s.id=a."snapshotId" WHERE s.active AND c.slug IS NOT NULL LIMIT 1');
 const cases=[{}, {page:2},{q:'82066'},{q:'розетка'},{category:sample.slug},{brand:sample.brandId}];
 for(const f of cases){
  const times={old:[],snapshot:[]};
  for(let repeat=0;repeat<2;repeat++){
   t=performance.now();const a=await old.catalog(filters(f));times.old.push(+(performance.now()-t).toFixed(2));
   t=performance.now();const b=await db.begin('isolation level repeatable read read only',tx=>readCatalog(tx,filters(f)));times.snapshot.push(+(performance.now()-t).toFixed(2));
   assert.deepEqual(shape(b),shape(a));
  }
  console.log('COPY_BENCH '+JSON.stringify({filter:f,...times}));
 }
 const after=await db.unsafe('SELECT (SELECT count(*) FROM products)::int products,(SELECT count(*) FROM product_prices)::int prices,(SELECT count(*) FROM product_stocks)::int stocks,(SELECT count(*) FROM import_issues)::int issues');
 assert.deepEqual(after,before);
 console.log('PASS complete copied-data equivalence, exact filters/pages, source table counts unchanged');
}finally{await db.end({timeout:5});}})().catch(e=>{console.error(e.message);process.exitCode=1;});

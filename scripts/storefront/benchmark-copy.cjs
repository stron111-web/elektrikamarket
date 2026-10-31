'use strict';
const fs=require('fs'),assert=require('assert/strict'),postgres=require('postgres');
const {performance}=require('perf_hooks'),{stripTypeScriptTypes}=require('module');
const {buildAssortmentSnapshot,activeAssortment}=require('./assortment.cjs');
const {readCatalog}=require('./catalog.cjs');
const {readStorefrontPrices,readAvailableStocks,availableStocksQuery}=require('../import/pricat-store.cjs');
if(!process.env.ASSORTMENT_COPY_URL)throw new Error('Explicit ASSORTMENT_COPY_URL for an isolated copy is required');
const trace=[];
const db=postgres(process.env.ASSORTMENT_COPY_URL,{max:1,onnotice:()=>{},connection:{statement_timeout:'60s'},debug:(_id,sql,parameters)=>trace.push({sql,parameters})});
const filters=v=>({q:'',category:'',brand:0,page:1,...v});
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
 // The restored tables were analysed before publication; the new generation also
 // needs statistics BEFORE either baseline or indexed measurements. Do not wait
 // for autoanalyze or confuse prepared-plan invalidation with index performance.
 await db.unsafe('ANALYZE assortment_snapshots; ANALYZE assortment_items;');
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

 // Same reader, snapshot, data and statistics on both sides: only the three new
 // indices differ. First measured calls are NOT guaranteed cold (equivalence warmed data).
 const [exact]=await db.unsafe('SELECT p."vendorNumber" article FROM assortment_items a JOIN products p ON p.id=a."productId" JOIN assortment_snapshots s ON s.id=a."snapshotId" WHERE s.active AND length(p."vendorNumber")>=3 ORDER BY p.id LIMIT 1');
 const searchCases=['ВА47-','лам','розетка','16А','82066',exact.article];
 const perfCases=[...searchCases.map(q=>({q})),{}, {page:2},{category:sample.slug},{brand:sample.brandId}];
 const expected=new Map();
 const percentile=(values,p)=>{const a=[...values].sort((x,y)=>x-y);return +(p===0.5?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:a[Math.ceil(p*a.length)-1]).toFixed(2);};
 async function idsFor(term){
  const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';
  return (await db.unsafe('SELECT p.id FROM assortment_items a JOIN products p ON p.id=a."productId" JOIN assortment_snapshots s ON s.id=a."snapshotId" WHERE s.active AND NOT p."isArchived" AND (p.name ILIKE $1 OR p."supplierCode" ILIKE $1 OR p."vendorNumber" ILIKE $1) ORDER BY p.id',[pattern])).map(p=>p.id);
 }
 for(const phase of ['without_trgm','with_trgm']){
  if(phase==='with_trgm'){
   t=performance.now();await db.unsafe(fs.readFileSync(require('path').resolve(__dirname,'../../prisma/migrations/20261031000000_catalog_search_trgm/migration.sql'),'utf8'));
   console.log('COPY_SEARCH_INDEX_BUILD '+JSON.stringify({ms:+(performance.now()-t).toFixed(2)}));
   console.log('COPY_SEARCH_INDEX_SIZE '+JSON.stringify(await db.unsafe("SELECT c.relname name,pg_relation_size(c.oid)::int bytes FROM pg_class c WHERE c.relname IN ('products_name_trgm_idx','products_supplierCode_trgm_idx','products_vendorNumber_trgm_idx') ORDER BY c.relname")));
  }
  for(const f of perfCases){
   const values=[];let data,firstMs;
   for(let i=0;i<13;i++){
    trace.length=0;t=performance.now();data=await db.begin('isolation level repeatable read read only',tx=>readCatalog(tx,filters(f)));
    const elapsed=performance.now()-t;if(i===0)firstMs=+elapsed.toFixed(2);else values.push(elapsed);
   }
   if(f.q){
    const ids=await idsFor(f.q);
    assert.equal(data.total,ids.length);assert.deepEqual(data.items.map(p=>p.id),ids.slice(0,24));
    assert.deepEqual(await idsFor(f.q.toLowerCase()),ids);assert.deepEqual(await idsFor(f.q.toUpperCase()),ids);
    if(phase==='without_trgm')expected.set(f.q,ids);else assert.deepEqual(ids,expected.get(f.q));
   }
   console.log('COPY_SEARCH_BENCH '+JSON.stringify({phase,filter:f,total:data.total,repeats:values.length,firstMs,medianMs:percentile(values,0.5),p95Ms:percentile(values,0.95)}));
   // Capture the exact count and page statements emitted by the production reader.
   trace.length=0;await db.begin('isolation level repeatable read read only',tx=>readCatalog(tx,filters(f)));
   const statements=trace.filter(q=>/SELECT count\(\*\)::int total FROM|SELECT p\.id,p\."supplierCode"/.test(q.sql));
   assert.equal(statements.length,2);
   for(const [i,statement]of statements.entries()){
    const [result]=await db.begin('read only',tx=>tx.unsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+statement.sql,statement.parameters));
    const plan=result['QUERY PLAN'][0],indexes=new Set(),nodes=new Set();
    const walk=n=>{nodes.add(n['Node Type']);if(n['Index Name'])indexes.add(n['Index Name']);for(const c of n.Plans??[])walk(c);};walk(plan.Plan);
    console.log('COPY_SEARCH_PLAN '+JSON.stringify({phase,filter:f,statement:i===0?'count':'page',executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],sharedHitBlocks:plan.Plan['Shared Hit Blocks'],sharedReadBlocks:plan.Plan['Shared Read Blocks'],indexes:[...indexes],nodes:[...nodes]}));
   }
  }
 }
 console.log('PASS full search ID sets before/after indices, case-insensitivity, snapshot-only totals/pages');

 const after=await db.unsafe('SELECT (SELECT count(*) FROM products)::int products,(SELECT count(*) FROM product_prices)::int prices,(SELECT count(*) FROM product_stocks)::int stocks,(SELECT count(*) FROM import_issues)::int issues');
 assert.deepEqual(after,before);
 console.log('PASS complete copied-data equivalence, exact filters/pages, source table counts unchanged');
}finally{await db.end({timeout:5});}})().catch(e=>{console.error(e.message);process.exitCode=1;});

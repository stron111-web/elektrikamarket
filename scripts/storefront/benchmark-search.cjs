'use strict';
// Read-only comparative measurements on a restored, explicitly named disposable copy.
// Never loads .env, creates schema, clears caches or contacts the supplier.
const fs=require('fs'),assert=require('node:assert/strict'),postgres=require('postgres'),{performance}=require('perf_hooks');
assert.equal(process.env.SEARCH_BENCHMARK_ISOLATED,'1','Explicit isolated-fixture opt-in required');
assert.ok(/^\/(?:search_|pricat_predeployment_)[a-z0-9_]+$/.test(new URL(process.env.SEARCH_COPY_URL).pathname),'Only named disposable fixture databases allowed');
assert.ok(require('path').isAbsolute(process.env.SEARCH_BASELINE_MODULE||''),'Explicit baseline module required');
let capture=false,queries=[];const db=postgres(process.env.SEARCH_COPY_URL,{max:1,onnotice:()=>{},connection:{statement_timeout:'10s',default_transaction_read_only:true},debug:(_id,q,p)=>{if(capture&&/^\s*SELECT (p\.id|count\(\*\))/.test(q))queries.push({sql:q,params:p});}});
const old=require(process.env.SEARCH_BASELINE_MODULE).readCatalog,newReader=require('./catalog.cjs').readCatalog;
const quantile=(a,q)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*q)-1];
(async()=>{
 const [dataset]=await db`SELECT (SELECT count(*)::int FROM products) products,(SELECT "productCount" FROM assortment_snapshots WHERE active) active,(SELECT pg_relation_size('products_storefront_fts_gin')) newGinBytes`;
 const [facet]=await db`SELECT p."brandId" brand,c.slug category FROM products p JOIN assortment_items a ON a."productId"=p.id JOIN assortment_snapshots s ON s.id=a."snapshotId" AND s.active JOIN categories c ON c.id=p."categoryId" WHERE p."supplierCode"='53667'`;
 const cases=[{q:''},{q:'автом 16 10'},{q:'MVA40-3-016-C'},{q:'автомат 16а 10ка'},{q:'автмоат 16а 10ка'},{q:'розетка'},{q:'розтка'},{q:'лам'},{q:'ВА47-'},{q:'82066'},{q:'C16'},{q:'С16'},{q:'автом 16 10',category:facet.category,brand:facet.brand},{q:'',category:facet.category}];
 const results=[];const plans=[];
 for(let i=0;i<cases.length;i++){
  const filter={q:'',category:'',brand:0,page:1,...cases[i]},row={...filter};
  for(const [label,reader] of [['old',old],['fts',newReader]]){
   const times=[];let last;
   for(let j=0;j<21;j++){queries=[];capture=j===20;const start=performance.now();last=await db.begin('isolation level repeatable read read only',tx=>reader(tx,filter));const ms=performance.now()-start;capture=false;if(j===0)row[label+'FirstMs']=ms;else times.push(ms);}
   row[label]={count:last.total,mode:last.searchMode??'ilike',medianMs:quantile(times,.5),p95Ms:quantile(times,.95)};
   if(label==='fts'&&[1,2,4,6].includes(i))for(const query of queries){const p=await db.unsafe('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query.sql,query.params);plans.push({case:filter,sql:query.sql,params:query.params,plan:p[0]['QUERY PLAN']});}
   if(filter.q==='MVA40-3-016-C')assert.equal(last.items[0].supplierCode,'53667');
  }
  results.push(row);console.log(JSON.stringify(row));
 }
 const report={at:new Date().toISOString(),dataset,repetitions:20,cache:'warm repetitions, first calls separate; OS/shared-buffer cold cache not forced',results,settings:await db`SELECT name,setting FROM pg_settings WHERE name IN ('shared_buffers','work_mem','max_parallel_workers_per_gather')`};
 fs.writeFileSync(process.env.SEARCH_BENCHMARK_OUTPUT||'search-benchmark.json',JSON.stringify(report,null,2));fs.writeFileSync(process.env.SEARCH_EXPLAIN_OUTPUT||'search-explain.json',JSON.stringify(plans,null,2));

})().catch(e=>{console.error(e.name+' '+e.message);process.exitCode=1}).finally(()=>db.end());

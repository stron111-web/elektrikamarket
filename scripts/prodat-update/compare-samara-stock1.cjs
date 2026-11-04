'use strict';
// Read-only test of the regional-catalog/warehouse hypothesis; no FTP access.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{createHash}=require('node:crypto'),postgres=require('postgres');
const {readProdatZip,getText}=require('../import/prodat.cjs');
const {availableStocksQuery}=require('../import/pricat-store.cjs');
const guard=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
async function sha(file){const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
const countCommon=(a,b)=>{let n=0;for(const code of a)if(b.has(code))n++;return n;};
(async()=>{
 process.umask(0o077);const startedAt=new Date().toISOString();
 const prior=JSON.parse(await fsp.readFile('/samara/comparison.json','utf8'));
 const input=prior.files.find(f=>f.set==='sklad'&&f.name==='PRODAT_369147_1326896258.zip');guard(input,'SKLAD_INPUT_REQUIRED');
 const file=path.join('/samara',input.name);guard(await sha(file)===input.sha256,'SKLAD_SHA_MISMATCH');
 const sklad=new Set();let records=0;
 for await(const {record} of readProdatZip(file)){const code=getText(record.SenderPrdCode);guard(code,'SUPPLIER_CODE_REQUIRED');sklad.add(code);records++;}
 guard(records===input.records&&sklad.size===21635&&await sha(file)===input.sha256,'SKLAD_INPUT_CHANGED');
 console.log(JSON.stringify({phase:'parsed-sklad',records,uniqueCodes:sklad.size}));
 const url=new URL((await fsp.readFile('/run/db/database_url','utf8')).trim());
 guard(url.username==='storefront_test_ro'&&url.pathname==='/elektrikamarket_test_20261029t010219z_2761a73c','READ_ONLY_TARGET_REQUIRED');url.searchParams.delete('schema');
 const db=postgres(url.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:true,application_name:'prodat-samara-stock1-readonly'}});
 let result;
 try{result=await db.begin('isolation level repeatable read read only',async tx=>{
  guard((await tx`SHOW transaction_read_only`)[0].transaction_read_only==='on','READ_ONLY_REQUIRED');
  const checkedAt=new Date().toISOString();
  // Only this read-only transaction gets a longer query limit for canonical SQL.
  await tx`SET LOCAL statement_timeout='120s'`;
  const [warehouse]=await tx`SELECT id,code,"isArchived" FROM public.warehouses WHERE code='stock1'`;
  guard(warehouse&&!warehouse.isArchived,'STOCK1_REQUIRED');
  const [snapshot]=await tx`SELECT id,"productCount","pricat1FileId","pricat2FileId" FROM public.assortment_snapshots WHERE active`;
  guard(snapshot,'ACTIVE_SNAPSHOT_REQUIRED');
  const available=await availableStocksQuery(tx,tx`SELECT p."supplierCode" FROM public.products p JOIN public.product_stocks s ON s."productId"=p.id WHERE s."warehouseId"=${warehouse.id} AND s.quantity>0`);
  const liveRows=await tx`SELECT DISTINCT "supplierCode" FROM (${available.query}) available WHERE warehouse='stock1'`;
  const positive=new Set(liveRows.map(r=>r.supplierCode));
  const snapshotRows=await tx`SELECT p."supplierCode" FROM public.assortment_items a JOIN public.products p ON p.id=a."productId" WHERE a."snapshotId"=${snapshot.id} AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.stocks) s WHERE s->>'warehouse'='stock1' AND (s->>'quantity')::numeric>0)`;
  const snapshotPositive=new Set(snapshotRows.map(r=>r.supplierCode));
  const raw=await tx`SELECT p."supplierCode",s.id "stockId",s.quantity::text quantity,(s.quantity>0) positive,(s.quantity=0) zero,(s.quantity<0) negative FROM public.products p LEFT JOIN public.product_stocks s ON s."productId"=p.id AND s."warehouseId"=${warehouse.id} WHERE p."supplierCode" IN ${tx([...sklad])}`;
  const classification={availablePositive:0,explicitZero:0,positiveButUnavailable:0,unknownQuantity:0,noStockRow:0,negativeQuantity:0,notInDatabase:sklad.size-raw.length};
  for(const row of raw){
   if(positive.has(row.supplierCode)){guard(row.positive,'AVAILABLE_WITHOUT_POSITIVE_STOCK');classification.availablePositive++;}
   else if(row.stockId===null)classification.noStockRow++;
   else if(row.quantity===null)classification.unknownQuantity++;
   else if(row.zero)classification.explicitZero++;
   else if(row.positive)classification.positiveButUnavailable++;
   else if(row.negative)classification.negativeQuantity++;
   else guard(false,'UNCLASSIFIED_STOCK');
  }
  guard(Object.values(classification).reduce((s,n)=>s+n,0)===sklad.size,'CLASSIFICATION_MISMATCH');
  const common=countCommon(sklad,positive);guard(common===classification.availablePositive,'INTERSECTION_MISMATCH');
  const union=sklad.size+positive.size-common;
  return {checkedAt,transactionReadOnly:true,availabilityMethod:'Canonical availableStocksQuery from pricat-store.cjs: positive stock, valid sale price, UOM, archive and all quarantine rules',snapshotId:String(snapshot.id),snapshotProducts:snapshot.productCount,
   skladCodes:sklad.size,availableStock1Codes:positive.size,common,onlySklad:sklad.size-common,availableStock1MissingFromSklad:positive.size-common,classification,
   percentages:{skladCodesWithAvailableStock1:100*common/sklad.size,availableStock1CoveredBySklad:positive.size?100*common/positive.size:null,jaccard:union?100*common/union:null},
   snapshotConsistency:{snapshotStock1Codes:snapshotPositive.size,onlyLive:positive.size-countCommon(positive,snapshotPositive),onlySnapshot:snapshotPositive.size-countCommon(positive,snapshotPositive)}};
 });}finally{await db.end();}
 const report={status:'COMPLETED',startedAt,finishedAt:new Date().toISOString(),input:{name:input.name,sha256:input.sha256,records},...result};
 await fsp.writeFile('/research/stock1-comparison.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({phase:'completed',...report}));
})().catch(e=>{console.error(JSON.stringify({status:'FAILED',code:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'STOCK1_RESEARCH_FAILED'}));process.exitCode=1;});

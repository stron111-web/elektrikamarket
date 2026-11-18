'use strict';
// Deliberately fixed existing restore. Never load dotenv, runtime config or production credentials.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),postgres=require('postgres');
const {readIndex}=require('./source-review.cjs');
const {importReviewedPair}=require('./reviewed-import.cjs');
const {readAvailableStocks}=require('../import/pricat-store.cjs');
const DB='pricat_restore_20261117t152456z',SCHEMA='pricat_v2_test_20261117';
const URL='postgres://fixture_admin@127.0.0.1:5432/'+DB;
const db=postgres(URL,{max:1,connect_timeout:10,onnotice:()=>{}});
const OUT='/results',manifest=require('/results/inputs.json');
const events=[];let lastProgress=Date.now();
function event(kind,data={}){lastProgress=Date.now();const item={at:new Date().toISOString(),kind,...data};events.push(item);console.log(JSON.stringify(item));}
// This only terminates the isolated test process; a disconnected transaction rolls back.
const watchdog=setInterval(()=>{if(Date.now()-lastProgress>300000){console.error('FIXTURE_NO_PROGRESS_300S');process.exit(124);}},10000);
async function save(){await fs.writeFile(OUT+'/results.json',JSON.stringify(events,null,2));}
async function state(){return (await db`SELECT (SELECT count(*) FROM products)::int products,(SELECT count(*) FROM product_prices)::int prices,(SELECT count(*) FROM product_stocks)::int stocks,(SELECT id FROM assortment_snapshots WHERE active) snapshot,(SELECT "productCount" FROM assortment_snapshots WHERE active) offers`)[0];}
async function master(){
 const excluded=['import_runs','import_files','import_issues','product_commercial_data','product_prices','product_stocks','assortment_snapshots','assortment_items'];
 const tables=await db`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ${db(excluded)} ORDER BY tablename`;
 const result={};for(const {tablename:t} of tables){result[t]=(await db.unsafe(`SELECT count(*)::text count,coalesce(sum(hashtextextended(to_jsonb(t)::text,0)::numeric),0)::text hash FROM public."${t}" t`))[0];}return result;
}
async function checkpoint(name){
 assert.match(name,/^[a-z0-9_]+$/);
 for(const [short,table] of [['prices','product_prices'],['stocks','product_stocks'],['commercial','product_commercial_data']])await db.unsafe(`CREATE TABLE ${SCHEMA}.${name}_${short} AS SELECT * FROM public.${table}`);
 await db.unsafe(`CREATE TABLE ${SCHEMA}.${name}_items AS SELECT i.* FROM public.assortment_items i JOIN public.assortment_snapshots s ON s.id=i."snapshotId" WHERE s.active`);
 return state();
}
async function diff(name){
 const out={};for(const [short,table,fields] of [['prices','product_prices',['retailPrice','price2','currency','retailCurrency']],['stocks','product_stocks',['quantity','uom','source']],['commercial','product_commercial_data',['uom','itemsPerUnit','itemsPerUom','multiplicity']]]){
  const semantic=(await db.unsafe(`SELECT count(*) FILTER(WHERE o.id IS NULL)::int inserted,count(*) FILTER(WHERE n.id IS NULL)::int deleted,count(*) FILTER(WHERE o.id IS NOT NULL AND n.id IS NOT NULL AND (to_jsonb(o)-'updatedAt'-'importFileId') IS DISTINCT FROM (to_jsonb(n)-'updatedAt'-'importFileId'))::int changed FROM ${SCHEMA}.${name}_${short} o FULL JOIN public.${table} n USING(id)`))[0];
  for(const field of fields)semantic[field]=(await db.unsafe(`SELECT count(*)::int n FROM ${SCHEMA}.${name}_${short} o JOIN public.${table} n USING(id) WHERE o."${field}" IS DISTINCT FROM n."${field}"`))[0].n;
  out[short]=semantic;
 }
 out.offers=(await db.unsafe(`SELECT count(*) FILTER(WHERE o."productId" IS NULL)::int added,count(*) FILTER(WHERE n."productId" IS NULL)::int removed,count(*) FILTER(WHERE n."retailPrice" IS DISTINCT FROM o."retailPrice" AND n."productId" IS NOT NULL AND o."productId" IS NOT NULL)::int priceChanged FROM ${SCHEMA}.${name}_items o FULL JOIN (SELECT i.* FROM assortment_items i JOIN assortment_snapshots s ON s.id=i."snapshotId" WHERE s.active) n USING("productId")`))[0];
 out.changedProducts=(await db.unsafe(`SELECT count(DISTINCT "productId")::int n FROM (
 SELECT n."productId" FROM ${SCHEMA}.${name}_stocks o FULL JOIN product_stocks n USING(id) WHERE (to_jsonb(o)-'updatedAt'-'importFileId') IS DISTINCT FROM (to_jsonb(n)-'updatedAt'-'importFileId')
 UNION SELECT n."productId" FROM ${SCHEMA}.${name}_commercial o FULL JOIN product_commercial_data n USING(id) WHERE (to_jsonb(o)-'updatedAt'-'importFileId') IS DISTINCT FROM (to_jsonb(n)-'updatedAt'-'importFileId')
 UNION SELECT c."productId" FROM ${SCHEMA}.${name}_prices o FULL JOIN product_prices n USING(id) JOIN product_commercial_data c ON c.id=coalesce(n."commercialDataId",o."commercialDataId") WHERE (to_jsonb(o)-'updatedAt'-'importFileId') IS DISTINCT FROM (to_jsonb(n)-'updatedAt'-'importFileId')) d`))[0].n;
 return out;
}
async function exactCheck(name){
 const result={};for(const [short,table] of [['prices','product_prices'],['stocks','product_stocks'],['commercial','product_commercial_data']]){const r=(await db.unsafe(`SELECT count(*)::int n FROM ${SCHEMA}.${name}_${short} o FULL JOIN public.${table} n USING(id) WHERE to_jsonb(o) IS DISTINCT FROM to_jsonb(n)`))[0];assert.equal(r.n,0,short+' changed');result[short]=r.n;}return result;
}
async function sourceIndex(label,files){
 for(const file of files){const i=await readIndex(file.path,file.source);assert.equal(i.sha256,file.sha256);
  await db.unsafe(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.source_codes (phase text,source text,code text,conflict boolean,invalid boolean,stocks jsonb,PRIMARY KEY(phase,source,code))`);
  let batch=[];const flush=async()=>{if(batch.length){await db.unsafe(`INSERT INTO ${SCHEMA}.source_codes SELECT * FROM jsonb_populate_recordset(NULL::${SCHEMA}.source_codes,$1::jsonb)`,[db.json(batch)]);batch=[];}};
  for(const [code,v] of i.codes){batch.push({phase:label,source:file.source,code,conflict:v.conflict,invalid:v.invalid,stocks:v.stocks});if(batch.length===1000)await flush();}await flush();event('source-index',{label,source:file.source,rows:i.rows,codes:i.codes.size});
 }
}
async function verifySnapshot(){
 const [v]=await db`SELECT (SELECT count(*)::int FROM assortment_snapshots WHERE active) active,count(*)::int offers,count(*) FILTER(WHERE p.id IS NULL OR p."isArchived" OR i."retailPrice"<=0 OR i.currency<>'RUB' OR i.uom IS NULL OR jsonb_array_length(i.stocks)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(i.stocks) s WHERE (s->>'quantity')::numeric<=0 OR s->>'uom'<>i.uom))::int invalid FROM assortment_items i JOIN assortment_snapshots a ON a.id=i."snapshotId" AND a.active LEFT JOIN products p ON p.id=i."productId"`;
 assert.equal(v.active,1);assert.equal(v.invalid,0);const s=await state();assert.equal(v.offers,s.offers);return v;
}
async function verifyAbsence(phase){
 const rows=await db.unsafe(`SELECT w.code warehouse,count(*)::int "existingAbsent",count(*) FILTER(WHERE s.quantity=0)::int zeroed,count(*) FILTER(WHERE s.quantity>0 AND NOT(s."isLocked" OR 'stocks'=ANY(p."lockedFields") OR 'commercialData'=ANY(p."lockedFields") OR coalesce(c."isLocked",false)))::int "unsafePositive" FROM product_stocks s JOIN products p ON p.id=s."productId" JOIN warehouses w ON w.id=s."warehouseId" LEFT JOIN product_commercial_data c ON c."productId"=p.id AND c.source=s.source WHERE s.source IN ('PRICAT1','PRICAT2') AND NOT EXISTS(SELECT 1 FROM ${SCHEMA}.source_codes q WHERE q.phase=$1 AND q.source=s.source::text AND q.code=p."supplierCode") GROUP BY w.code ORDER BY w.code`,[phase]);
 for(const r of rows)assert.equal(r.unsafePositive,0);return rows;
}
async function publish(label,files,documents,extra={}){
 event('start-publication',{label});
 const r=await importReviewedPair({databaseUrl:URL,files,identities:{senderGln:'4607166859990',documents},onProgress:x=>event('progress',{label,...x}),reportPath:OUT+'/'+label+'-issues.ndjson',...extra});
 await fs.writeFile(OUT+'/'+label+'-summary.json',JSON.stringify(r,null,2));
 event('publication',{label,result:r.result});await save();return r;
}
async function main(){
 const [identity]=await db`SELECT current_database() db,current_user usr,inet_server_addr()::text host`;
 assert.equal(identity.db,DB);assert.equal(identity.usr,'fixture_admin');assert.ok(['127.0.0.1','127.0.0.1/32'].includes(identity.host));
 assert.equal((await fs.readFile('/proc/net/route','utf8')).trim().split('\n').length,1,'Unexpected external network route');
 await db`SET statement_timeout='180s'`;
 event('isolation',{identity,network:'fixture namespace, no routes',productionCredentials:false});
 const resume=process.argv.includes('--resume-after-nov5');let masters;
 if(resume){
  const saved=JSON.parse(await fs.readFile(OUT+'/results.json','utf8'));assert.ok(saved.some(e=>e.kind==='publication'&&e.label==='nov5'&&e.result.status==='SUCCEEDED'));assert.ok(!saved.some(e=>e.kind==='publication'&&e.label==='nov6'));
  const current=await state();assert.equal(current.snapshot,'9');assert.equal(current.offers,129906);
  const accepted=await db`SELECT f.source,f.sha256 FROM assortment_snapshots s JOIN import_files f ON f.id IN(s."pricat1FileId",s."pricat2FileId") WHERE s.active`;
  for(const f of manifest.nov5.files)assert.equal(accepted.find(a=>a.source===f.source)?.sha256,f.sha256);
  events.push(...saved);masters=saved.find(e=>e.kind==='master-before').tables;assert.deepEqual(await master(),masters);
  event('resumed-after-test-alias-fix',{publicationRepeated:false,state:current});
  event('comparison',{label:'nov5',before:saved.find(e=>e.kind==='baseline').state,after:current,changes:await diff('nov5'),absence:await verifyAbsence('nov5'),snapshotValidation:await verifySnapshot()});await save();
 }else{
  await db.unsafe(`CREATE SCHEMA ${SCHEMA}`);masters=await master();event('master-before',{tables:masters});
  const baseline=await checkpoint('baseline');event('baseline',{state:baseline});
  for(const label of ['nov5','nov6'])await sourceIndex(label,manifest[label].files);
 }
 for(const label of resume?['nov6']:['nov5','nov6']){
  let before;const [existing]=await db`SELECT to_regclass(${SCHEMA+'.'+label+'_prices'}) present`;
  if(resume&&existing.present){await exactCheck(label);before=await state();event('checkpoint-reused',{label,noRepeatedPublication:true});}else before=await checkpoint(label);
  await publish(label,manifest[label].files,manifest[label].documents);
  event('comparison',{label,before,after:await state(),changes:await diff(label),absence:await verifyAbsence(label),snapshotValidation:await verifySnapshot()});
  assert.deepEqual(await master(),masters);event('master-unchanged',{label});await save();
 }
 // Verify reappearing codes using two actual supplier generations, not invented codes.
 const returned=await db.unsafe(`SELECT q.source,count(*)::int codes,count(DISTINCT p.id)::int knownProducts,count(DISTINCT p.id) FILTER(WHERE a."productId" IS NOT NULL)::int nowSaleable FROM ${SCHEMA}.source_codes q LEFT JOIN ${SCHEMA}.source_codes old ON old.phase='nov5' AND old.source=q.source AND old.code=q.code LEFT JOIN products p ON p."supplierCode"=q.code LEFT JOIN assortment_items a ON a."productId"=p.id AND a."snapshotId"=(SELECT id FROM assortment_snapshots WHERE active) WHERE q.phase='nov6' AND old.code IS NULL GROUP BY q.source ORDER BY q.source`);
 event('returned-real-source-codes',{rows:returned});
 await checkpoint('repeat');const repeatState=await state();const repeat=await publish('repeat',manifest.nov6.files,manifest.nov6.documents);assert.equal(repeat.result.status,'SKIPPED');assert.deepEqual(await state(),repeatState);event('repeat-pass',{exact:await exactCheck('repeat')});
 await checkpoint('rollback');const beforeRollback=await state();let injected=false;
 try{await publish('rollback',manifest.nov6.files,manifest.nov6.documents,{reprocess:true,beforeSnapshotActivate:async()=>{const seen=await state();assert.equal(seen.snapshot,beforeRollback.snapshot);injected=true;throw Error('FIXTURE_INJECTED_ROLLBACK');}});throw Error('Expected rollback');}catch(e){assert.equal(e.message,'FIXTURE_INJECTED_ROLLBACK');assert.ok(injected);}
 assert.deepEqual(await state(),beforeRollback);event('rollback-pass',{exact:await exactCheck('rollback'),snapshot:beforeRollback.snapshot});assert.deepEqual(await master(),masters);
 event('real-sequence-complete',{state:await state(),baselineChanges:await diff('baseline')});await save();
}
main().then(async()=>{event('complete');await save();}).catch(async e=>{event('FAILED',{error:e.message,code:e.code||null});await save();process.exitCode=1;}).finally(async()=>{clearInterval(watchdog);await db.end({timeout:5});});

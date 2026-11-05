'use strict';
// Operator for the explicitly approved one-time ETIM-only publication.
// All business logic comes from the immutable 51187be runtime image.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),assert=require('node:assert/strict'),postgres=require('postgres');
const {importProdat,fingerprint,VERSION}=require('../../scripts/import/prodat-import.cjs');
const expectedHashes=['0a9d16d6192b6968fef2d2a1b32b20ba84b086629e3b48e0b88bc461d2def4a1','d0ddb0a60d9e8246decf5501f9b759eaa8660e17547bf7d23674856aaa952659'];
const excluded=new Set(['import_runs','import_files','import_issues','product_features']);
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=async(name,r)=>{await fsp.writeFile('/results/'+name,JSON.stringify(r,null,2)+'\n',{mode:0o600,flag:'wx'});};
async function fingerprintTable(tx,table){assert(/^[a-z_]+$/.test(table));return(await tx.unsafe(`SELECT count(*)::int rows,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) hash FROM public."${table}" t`))[0];}
async function checkBusiness(tx,baseline){await tx.unsafe("SET LOCAL timezone='UTC'");const result={};for(const [table,value]of Object.entries(baseline)){if(excluded.has(table))continue;const actual=await fingerprintTable(tx,table);assert.deepEqual(actual,value,'BUSINESS_TABLE_CHANGED_'+table);result[table]={rows:actual.rows,unchanged:true};}return result;}
async function featureStats(tx){return(await tx.unsafe(`SELECT count(*)::int features,count(DISTINCT "productId")::int products,count(*) FILTER(WHERE btrim("featureValue")='')::int empty,count(*) FILTER(WHERE origin<>'PRODAT' OR "isLocked")::int protected FROM product_features`))[0];}
async function pair(tx){return(await tx.unsafe(`SELECT s.id,s."productCount",f1.sha256 hash1,f2.sha256 hash2 FROM assortment_snapshots s JOIN import_files f1 ON f1.id=s."pricat1FileId" JOIN import_files f2 ON f2.id=s."pricat2FileId" WHERE s.active AND f1.status='SUCCEEDED' AND f2.status='SUCCEEDED'`))[0];}
(async()=>{
 process.umask(0o077);const mode=process.argv[2];assert(['preflight','write'].includes(mode));assert.equal(VERSION,'prodat-v1.4.0-etim');
 const u=new URL(fs.readFileSync('/run/writer-url','utf8').trim());u.searchParams.delete('schema');assert.equal(decodeURIComponent(u.pathname.slice(1)),'elektrikamarket_test_20261029t010219z_2761a73c');
 const db=postgres(u.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:true,timezone:'UTC',application_name:'approved-etim-live-audit'}});
 try{
  const state=json('/prodat-state/source-state.json'),candidate=state.currentCandidate;assert(candidate.verified&&candidate.files.length===2&&candidate.verification.status==='VERIFIED');
  assert.deepEqual(candidate.verification.parts.map(p=>p.sha256),expectedHashes);assert.equal(candidate.verification.uniqueSenderPrdCode,153673);assert.equal(candidate.verification.conflicts,0);
  const files=candidate.files.map(f=>f.path);for(let i=0;i<files.length;i++)assert.equal((await fingerprint(files[i])).sha256,expectedHashes[i]);
  const source=json('/backup/source-fingerprint.json'),baseline=Object.fromEntries(source.map(r=>[r.table.replace(/^public\./,''),{rows:r.rows,hash:r.hash}]));
  if(mode==='preflight'){
   const trial=json('/trial/source-fingerprint.json');for(const row of trial)if(!excluded.has(row.table.replace(/^public\./,'')))assert.deepEqual(baseline[row.table.replace(/^public\./,'')],{rows:row.rows,hash:row.hash},'BASELINE_DIFFERS_FROM_REHEARSAL');
   const report=await db.begin('isolation level repeatable read read only',async tx=>{
    await tx.unsafe("SET LOCAL timezone='UTC'");for(const [table,value]of Object.entries(baseline))assert.deepEqual(await fingerprintTable(tx,table),value,'FRESH_BACKUP_BASELINE_CHANGED_'+table);
    const features=await featureStats(tx);assert.equal(features.features,0);assert.equal(baseline.products.rows,180666);
    const active=await pair(tx);assert.equal(String(active.id),'8');assert.equal(active.productCount,137359);
    const cache=json('/pricat-state/ftp/state.json');assert.equal(String(cache.snapshotId),String(active.id));
    for(const [source,hash]of [['PRICAT1',active.hash1],['PRICAT2',active.hash2]]){const v=cache.versions[source][0];assert.equal(v.sha256,hash);assert.equal((await fingerprint(path.join('/pricat-state/ftp/versions',source,hash+'.'+v.format))).sha256,hash);}
    return{status:'ETIM_LIVE_PREFLIGHT_VERIFIED',at:new Date().toISOString(),baseline,pair:active,features,sourceHashes:expectedHashes,liveWrites:false};
   });await save('preflight.json',report);console.log(JSON.stringify({status:report.status,pair:report.pair,features:report.features}));return;
  }
  const preflight=json('/results/preflight.json');assert.equal(preflight.status,'ETIM_LIVE_PREFLIGHT_VERIFIED');let publishChecked=false,commitChecked=false;
  const result=await importProdat({databaseUrl:u.toString(),files,featuresOnly:true,batchSize:500,
   onProgress:p=>{if(p.phase!=='validate'||p.processedRecords%25000===0)console.log(JSON.stringify({phase:p.phase,records:p.processedRecords}));},
   beforePublish:async({db:tx,hasFresh})=>{assert(hasFresh);assert.deepEqual(await pair(tx),preflight.pair);assert.equal((await featureStats(tx)).features,0);await checkBusiness(tx,preflight.baseline);publishChecked=true;},
   beforeCommit:async ctx=>{assert(publishChecked);assert.equal(ctx.createdRecords,0);assert.equal(ctx.updatedRecords,0);assert.equal(ctx.errorCount,0);assert.equal(ctx.warningCount,0);assert.equal(ctx.references.features.created,2083808);assert.equal(ctx.references.features.emptyEntries,2176494);assert.deepEqual(await featureStats(ctx.db),{features:2083808,products:134836,empty:0,protected:0});assert.deepEqual(await pair(ctx.db),preflight.pair);await checkBusiness(ctx.db,preflight.baseline);commitChecked=true;}});
  assert(commitChecked);assert.equal(result.status,'SUCCEEDED');
  const report=await db.begin('isolation level repeatable read read only',async tx=>{const unchangedTables=await checkBusiness(tx,preflight.baseline),features=await featureStats(tx),active=await pair(tx);assert.deepEqual(active,preflight.pair);assert.deepEqual(features,{features:2083808,products:134836,empty:0,protected:0});const [dup]=await tx.unsafe('SELECT count(*)::int n FROM (SELECT "productId","identityKey" FROM product_features GROUP BY 1,2 HAVING count(*)>1)x');assert.equal(dup.n,0);return{status:'LIVE_ETIM_VERIFIED',at:new Date().toISOString(),runId:result.runId,features,duplicates:dup.n,pair:active,unchangedTables,result};});
  await save('live-etim-result.json',report);console.log(JSON.stringify({status:report.status,runId:report.runId,features:report.features,duplicates:report.duplicates,unchangedTables:Object.keys(report.unchangedTables).length,pair:report.pair}));
 }finally{await db.end({timeout:5});}
})().catch(e=>{console.error(JSON.stringify({status:'ETIM_LIVE_STOPPED',code:e.code||null,message:/postgres(?:ql)?:\/\//i.test(e.message)?'REDACTED':String(e.message).slice(0,250)}));process.exitCode=1;});

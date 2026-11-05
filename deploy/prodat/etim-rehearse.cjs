'use strict';
// Run ONLY in the network namespace of the restored, isolated PostgreSQL.
const fs=require('node:fs'),fsp=fs.promises,postgres=require('postgres');
const {importProdat}=require('../../scripts/import/prodat-import.cjs');
const assert=require('node:assert/strict');
(async()=>{
 const url=process.env.PRODAT_REHEARSAL_DATABASE_URL,u=new URL(url);
 assert(u.hostname==='127.0.0.1'&&u.pathname==='/prodat_rehearsal','Isolated fixture target required');
 const db=postgres(url,{max:1,onnotice:()=>{}});
 const state=JSON.parse(fs.readFileSync('/prodat-state/source-state.json'));
 const files=state.currentCandidate.files.map(f=>f.path);
 const result={status:'RUNNING',liveWrites:false,files:files.map(p=>p.split('/').pop()),startedAt:new Date().toISOString()};
 const tableFingerprint=async table=>(await db.unsafe(`SELECT count(*)::int rows,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) hash FROM public."${table}" t`))[0];
 const excluded=new Set(['product_features','import_runs','import_files','import_issues']);
 try{
  const tables=await db`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const baseline={};for(const {tablename}of tables)if(!excluded.has(tablename))baseline[tablename]=await tableFingerprint(tablename);
  const [beforeSnapshot]=await db`SELECT id,"productCount" FROM assortment_snapshots WHERE active`;result.beforeSnapshot=beforeSnapshot;
  const beforeFeatures=await tableFingerprint('product_features');assert.equal(beforeFeatures.rows,0);
  const run=options=>importProdat({databaseUrl:url,files,featuresOnly:true,batchSize:500,onProgress:p=>{if(p.phase!=='validate'||p.processedRecords%25000===0)console.error(JSON.stringify({phase:p.phase,records:p.processedRecords}));},...options});
  // A failure after actual feature INSERTs must leave the original empty table.
  let rollbackFeatures=0;await assert.rejects(run({beforeCommit:async({db:tx})=>{rollbackFeatures=(await tx`SELECT count(*)::int n FROM product_features`)[0].n;assert(rollbackFeatures>0);throw Error('ETIM_REHEARSAL_INJECTED_FAILURE');}}),/ETIM_REHEARSAL_INJECTED_FAILURE/);
  assert.deepEqual(await tableFingerprint('product_features'),beforeFeatures);result.rollback={verified:true,pendingInsertsRolledBack:rollbackFeatures};
  await fsp.writeFile('/results/etim-progress.json',JSON.stringify(result,null,2)+'\n');
  result.first=await run({});assert.equal(result.first.status,'SUCCEEDED');assert.equal(result.first.createdRecords,0);assert.equal(result.first.updatedRecords,0);
  const filled=await tableFingerprint('product_features');
  result.second=await run({});assert.equal(result.second.status,'SKIPPED');assert.deepEqual(await tableFingerprint('product_features'),filled);
  result.counts=(await db`SELECT count(*)::int features,count(DISTINCT "productId")::int products,count(*) FILTER(WHERE btrim("featureValue")='')::int empty FROM product_features`)[0];
  result.duplicateIdentities=(await db`SELECT count(*)::int n FROM (SELECT "productId","identityKey" FROM product_features GROUP BY 1,2 HAVING count(*)>1)x`)[0].n;assert.equal(result.duplicateIdentities,0);
  result.unchangedTables={};for(const [table,expected]of Object.entries(baseline)){const actual=await tableFingerprint(table);assert.deepEqual(actual,expected,table);result.unchangedTables[table]={rows:actual.rows,unchanged:true};}
  result.afterSnapshot=(await db`SELECT id,"productCount" FROM assortment_snapshots WHERE active`)[0];assert.deepEqual(result.afterSnapshot,beforeSnapshot);
  result.samples=await db`SELECT p."supplierCode",f."featureCode",f."featureName",f."featureValue",f."featureUom" FROM product_features f JOIN products p ON p.id=f."productId" ORDER BY f.id LIMIT 5`;
  result.status='ETIM_REHEARSAL_VERIFIED';result.finishedAt=new Date().toISOString();
 }catch(e){result.status='ETIM_REHEARSAL_FAILED';result.error={code:e.code||null,message:/postgres(?:ql)?:\/\//i.test(e.message)?'REDACTED':e.message};process.exitCode=1;}
 finally{await db.end({timeout:5});await fsp.writeFile('/results/etim-rehearsal.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
})().catch(()=>{console.error('ETIM_FIXTURE_SETUP_FAILED');process.exitCode=1;});

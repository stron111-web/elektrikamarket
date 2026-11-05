'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),postgres=require('postgres');
const {importProdat,fingerprint}=require('../import/prodat-import.cjs');
const {importPricat}=require('../import/pricat-import.cjs');
const {privateJson,json,GateError}=require('../pricat-update/update.cjs');
const guard=(ok,code)=>{if(!ok)throw new GateError(code);};
async function digest(db,query){return (await db`SELECT count(*)::int rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id),'')) hash FROM (${query}) t`)[0];}
async function bounds(db){
 const [products]=await db`SELECT count(*)::int count,coalesce(max(id),0)::int max FROM products`;
 const result={products};for(const table of ['brands','categories','product_barcodes','product_images','product_documents','product_relations'])result[table]=(await db.unsafe('SELECT coalesce(max(id),0)::int max FROM public.'+table))[0].max;
 return result;
}
async function protectedFrame(db,b){
 const frame={};
 frame.products=await digest(db,db`SELECT p.id,p.slug,p."isArchived",p."lockedFields",coalesce((SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(to_jsonb(p)) e WHERE e.key=ANY(p."lockedFields")),'{}'::jsonb) locked_values FROM products p WHERE p.id<=${b.products.max}`);
 frame.brands=await digest(db,db`SELECT * FROM brands WHERE id<=${b.brands}`);
 frame.categories=await digest(db,db`SELECT c.id,c.slug,c."isArchived",c."lockedFields",coalesce((SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(to_jsonb(c)) e WHERE e.key=ANY(c."lockedFields")),'{}'::jsonb) locked_values FROM categories c WHERE c.id<=${b.categories}`);
 frame.product_commercial_data=await digest(db,db`SELECT * FROM product_commercial_data WHERE "productId"<=${b.products.max}`);
 frame.product_prices=await digest(db,db`SELECT price.* FROM product_prices price JOIN product_commercial_data c ON c.id=price."commercialDataId" WHERE c."productId"<=${b.products.max}`);
 frame.product_stocks=await digest(db,db`SELECT * FROM product_stocks WHERE "productId"<=${b.products.max}`);
  frame.product_features=await digest(db,db`SELECT f.* FROM product_features f JOIN products p ON p.id=f."productId" WHERE f."productId"<=${b.products.max} AND (f.origin='MANUAL' OR f."isLocked" OR 'features'=ANY(p."lockedFields"))`);
 frame.warehouses=await digest(db,db`SELECT * FROM warehouses`);frame.settings=await digest(db,db`SELECT * FROM shop_settings`);
 for(const [table,layer] of [['product_barcodes','barcodes'],['product_images','images'],['product_documents','documents'],['product_relations','relations']]){
  frame[table+'_ids']=await digest(db,db`SELECT id,"productId" FROM ${db(table)} WHERE id<=${b[table]}`);
  frame[table+'_protected']=await digest(db,db`SELECT r.* FROM ${db(table)} r JOIN products p ON p.id=r."productId" WHERE r.id<=${b[table]} AND (r.origin='MANUAL' OR r."isLocked" OR ${layer}=ANY(p."lockedFields"))`);
 }
 return frame;
}
function assertFrame(actual,expected){for(const key of Object.keys(expected))guard(actual[key].hash===expected[key].hash&&actual[key].rows===expected[key].rows,'PROTECTED_DATA_CHANGED_'+key.toUpperCase());}
async function activePair(db){
 const [s]=await db`SELECT s.id,s."productCount",f1.sha256 hash1,f2.sha256 hash2 FROM assortment_snapshots s JOIN import_files f1 ON f1.id=s."pricat1FileId" JOIN import_files f2 ON f2.id=s."pricat2FileId" WHERE s.active AND f1.status='SUCCEEDED' AND f2.status='SUCCEEDED'`;
 guard(s,'ACTIVE_PRICAT_REQUIRED');return s;
}
async function publishVerified({config,files,verification,event=()=>{}}){
 guard(config.publicationEnabled===true,'PUBLICATION_DISABLED');
 guard(config.policy&&['maxNewFraction','maxUpdatedFraction'].every(k=>Number.isFinite(config.policy[k])&&config.policy[k]>0&&config.policy[k]<=1),'PUBLICATION_DELTA_POLICY_REQUIRED');
 guard(['rehearsal','production'].includes(config.environment),'EXPLICIT_ENVIRONMENT_REQUIRED');
 guard(verification?.status==='VERIFIED'&&verification.conflicts===0&&verification.invalidRecords===0&&verification.categoryConflicts===0&&files.length===2,'VERIFIED_COMPLETE_SOURCE_REQUIRED');
 const databaseUrl=(await fsp.readFile(config.databaseUrlFile,'utf8')).trim(),url=new URL(databaseUrl);url.searchParams.delete('schema');
 guard(['postgres:','postgresql:'].includes(url.protocol)&&decodeURIComponent(url.pathname.slice(1))===config.databaseName&&!url.username.startsWith('storefront_'),'EXPLICIT_WRITE_TARGET_REQUIRED');
 if(config.environment==='rehearsal')guard(url.hostname==='127.0.0.1'&&/^prodat_(rehearsal|test_)/.test(config.databaseName),'ISOLATED_REHEARSAL_REQUIRED');
 else guard(config.databaseName==='elektrikamarket_test_20261029t010219z_2761a73c','PRODUCTION_TARGET_REQUIRED');
 for(const part of verification.parts){const file=files.find(f=>path.basename(f.path)===part.name);guard(file&&(await fingerprint(file.path)).sha256===part.sha256,'VERIFIED_SOURCE_CHANGED');}
 const marker=path.join(config.stateDirectory,'needs-review.json'),resultFile=path.join(config.stateDirectory,'last-publication.json');
 const pricatRoot=path.join(config.pricatStateDirectory,'ftp'),pricatMarker=path.join(pricatRoot,'needs-review.json');
 guard(!fs.existsSync(marker)&&!fs.existsSync(pricatMarker)&&!fs.existsSync(path.join(config.pricatStateDirectory,'needs-review.json')),'PREVIOUS_PUBLICATION_NEEDS_REVIEW');
 const sourceHashes=verification.parts.map(p=>p.sha256);
 if(fs.existsSync(resultFile)){const last=await privateJson(resultFile);if(last.status==='SUCCEEDED'&&JSON.stringify(last.sourceHashes)===JSON.stringify(sourceHashes))return {status:'UNCHANGED',createdProducts:0,updatedProducts:0,newSaleOffers:0,sourceHashes};}
 const stateFile=path.join(pricatRoot,'state.json'),cache=await privateJson(stateFile);
 const db=postgres(url.toString(),{max:1,onnotice:()=>{},connection:{lock_timeout:'10s',application_name:'prodat-guarded-publication'}});
 let committed=false,prodatResult,pricatResult,started=false,before,frame,pair,scopeMetrics,reconcileTx;
 try{
  ({before,frame,pair}=await db.begin('isolation level repeatable read read only',async tx=>{const b=await bounds(tx);return {before:b,frame:await protectedFrame(tx,b),pair:await activePair(tx)};}));
  guard(String(cache.snapshotId)===String(pair.id),'PRICAT_STATE_BASELINE_MISMATCH');
  const accepted=[];
  for(const source of ['PRICAT1','PRICAT2']){
   const f=cache.versions?.[source]?.[0];guard(f&&f.sha256===(source==='PRICAT1'?pair.hash1:pair.hash2)&&/^[a-f0-9]{64}$/.test(f.sha256)&&['xml','zip'].includes(f.format),'ACCEPTED_PRICAT_PAIR_REQUIRED');
   const file=path.join(pricatRoot,'versions',source,f.sha256+'.'+f.format);guard((await fingerprint(file)).sha256===f.sha256,'ACCEPTED_PRICAT_CACHE_CORRUPT');accepted.push({source,path:file});
  }
  await json(marker,{phase:'PRODAT_PENDING',at:new Date().toISOString(),beforeMaxId:before.products.max,snapshotId:String(pair.id),sourceHashes:verification.parts.map(p=>p.sha256)});started=true;
  // A process crash releases flock/advisory locks. The existing PRICAT updater
  // must remain blocked until the entire chain has a confirmed outcome.
  await json(pricatMarker,{phase:'PRODAT_PENDING',at:new Date().toISOString()});
  let expectedNew=0;
  prodatResult=await importProdat({databaseUrl:url.toString(),files:files.map(f=>f.path),onProgress:p=>{if(p.phase!=='validate'||p.processedRecords%25000===0)event(p);},
   beforePublish:async ctx=>{
    guard(ctx.hasFresh,'SOURCE_ALREADY_IMPORTED_REQUIRES_STATE_RECONCILIATION');
    guard((await activePair(ctx.db)).id===pair.id,'PRICAT_BASELINE_CHANGED');
    assertFrame(await protectedFrame(ctx.db,before),frame);
    const [stats]=await ctx.db`SELECT count(*)::int total,count(*) FILTER(WHERE p.id IS NULL)::int fresh FROM prodat_stage s LEFT JOIN products p ON p."supplierCode"=s."supplierCode"`;
    guard(stats.total===verification.uniqueSenderPrdCode,'STAGED_PRODAT_INCOMPLETE');expectedNew=stats.fresh;
    guard(expectedNew<=before.products.count*config.policy.maxNewFraction,'NEW_PRODUCT_ANOMALY');
   },beforeCommit:async ctx=>{
    const initial=config.initialExpectedChanges;
    const firstApproved=initial&&JSON.stringify(initial.sourceHashes)===JSON.stringify(sourceHashes);
    if(firstApproved)guard(before.products.count===initial.beforeProducts&&ctx.createdRecords===initial.createdProducts&&ctx.updatedRecords===initial.updatedProducts,'REVIEWED_INITIAL_DELTA_CHANGED');
    else guard(ctx.updatedRecords<=before.products.count*config.policy.maxUpdatedFraction,'CATALOG_CHANGE_ANOMALY');
    guard(ctx.createdRecords===expectedNew,'CATALOG_NEW_COUNT_MISMATCH');
    const [n]=await ctx.db`SELECT count(*)::int n FROM products`;guard(n.n===before.products.count+expectedNew,'PRODUCT_COUNT_MISMATCH');
    assertFrame(await protectedFrame(ctx.db,before),frame);
   }});
  committed=true;guard(prodatResult.status==='SUCCEEDED','PRODAT_PUBLICATION_UNCONFIRMED');
  const newRows=await db`SELECT p."supplierCode" FROM products p JOIN import_files f ON f.id=p."lastProdatFileId" WHERE p.id>${before.products.max} AND f."runId"=${prodatResult.runId}`;
  guard(newRows.length===prodatResult.createdRecords,'NEW_PRODUCT_IDENTITIES_MISMATCH');const codes=newRows.map(r=>r.supplierCode);
  await json(marker,{phase:'PRODAT_COMMITTED',at:new Date().toISOString(),prodatRunId:prodatResult.runId,beforeMaxId:before.products.max,acceptedSnapshotId:String(pair.id),newCodes:codes});
  if(codes.length){
   await json(pricatMarker,{phase:'PRODAT_RECONCILIATION_PENDING',prodatRunId:prodatResult.runId,at:new Date().toISOString()});
   pricatResult=await importPricat({databaseUrl:url.toString(),files:accepted,mode:'production',conflictPolicy:'quarantine',reprocess:true,
    reconcileNewProducts:{prodatRunId:prodatResult.runId,afterProductId:before.products.max,acceptedSnapshotId:String(pair.id),codes},
    beforeSnapshotActivate:async({snapshotId})=>{
     // Query on importer's transaction, not another connection: assigned below.
     guard(reconcileTx,'RECONCILIATION_TRANSACTION_REQUIRED');
     assertFrame(await protectedFrame(reconcileTx,before),frame);
     const [delta]=await reconcileTx`SELECT count(*)::int n FROM assortment_items o LEFT JOIN assortment_items n ON n."snapshotId"=${snapshotId} AND n."productId"=o."productId" WHERE o."snapshotId"=${pair.id} AND (n."productId" IS NULL OR (to_jsonb(o)-'snapshotId') IS DISTINCT FROM (to_jsonb(n)-'snapshotId'))`;
     guard(delta.n===0,'EXISTING_SALE_OFFERS_CHANGED');
     const [fresh]=await reconcileTx`SELECT count(*)::int n FROM assortment_items WHERE "snapshotId"=${snapshotId}`;
     guard(fresh.n>=pair.productCount&&fresh.n<=pair.productCount+codes.length,'ASSORTMENT_RECONCILIATION_ANOMALY');scopeMetrics={newSaleOffers:fresh.n-pair.productCount,existingSaleOffersChanged:delta.n};
    },beforePublish:async ctx=>{reconcileTx=ctx.db;}});
   guard(pricatResult.status==='SUCCEEDED'&&pricatResult.assortment&&scopeMetrics,'PRICAT_RECONCILIATION_UNCONFIRMED');
   const after=await activePair(db);guard(String(after.id)===String(pricatResult.assortment.id)&&after.hash1===pair.hash1&&after.hash2===pair.hash2,'POST_COMMIT_PRICAT_MISMATCH');
   cache.snapshotId=String(after.id);cache.lastPublication={at:new Date().toISOString(),status:'SUCCEEDED',cause:'PRODAT_NEW_PRODUCTS',runId:pricatResult.runId,snapshotId:String(after.id),count:after.productCount,zeroedStocks:pricatResult.zeroedStocks,zeroedPositiveStocks:pricatResult.zeroedPositiveStocks,updatedRecords:pricatResult.updatedRecords,matching:{matchedUniqueProducts:pricatResult.matchedUniqueProducts,unknownUniqueCodes:pricatResult.missingUniqueCodes}};
   await json(stateFile,cache);
  }else scopeMetrics={newSaleOffers:0,existingSaleOffersChanged:0};
  assertFrame(await protectedFrame(db,before),frame);
  const after=await activePair(db);
  const result={status:'SUCCEEDED',at:new Date().toISOString(),environment:config.environment,sourceHashes,prodat:prodatResult,pricat:pricatResult??null,beforeProducts:before.products.count,createdProducts:prodatResult.createdRecords,updatedProducts:prodatResult.updatedRecords,afterProducts:before.products.count+prodatResult.createdRecords,beforeSnapshotId:String(pair.id),afterSnapshotId:String(after.id),beforeSaleOffers:pair.productCount,afterSaleOffers:after.productCount,...scopeMetrics,protectedDataUnchanged:true};
  await json(resultFile,result);if(fs.existsSync(pricatMarker))await fsp.unlink(pricatMarker);await fsp.unlink(marker);event({status:'SUCCEEDED',createdProducts:result.createdProducts,updatedProducts:result.updatedProducts,newSaleOffers:result.newSaleOffers});return result;
 }catch(e){
  let rolledBack=false;if(started&&!committed&&e.runId){try{const [r]=await db`SELECT status FROM import_runs WHERE id=${e.runId}`;rolledBack=r?.status==='FAILED';if(rolledBack){assertFrame(await protectedFrame(db,before),frame);await fsp.unlink(marker);if(fs.existsSync(pricatMarker))await fsp.unlink(pricatMarker);}}catch{rolledBack=false;}}
  const result={status:started&&!rolledBack?'NEEDS_REVIEW':'FAILED',at:new Date().toISOString(),code:e instanceof GateError?e.code:'PRODAT_PUBLICATION_FAILED',causeCode:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:null,...(config.environment==='rehearsal'&&!/postgres(ql)?:\/\//i.test(e.message??'')?{rehearsalMessage:String(e.message).slice(0,250)}:{}),prodatCommitAcknowledged:committed,publicationRolledBack:rolledBack,runId:e.runId??prodatResult?.runId??null};
  await json(resultFile,result);event(result);const error=new GateError(result.code);error.result=result;throw error;
 }finally{await db.end({timeout:5});}
}
module.exports={publishVerified,protectedFrame,bounds,assertFrame,activePair};

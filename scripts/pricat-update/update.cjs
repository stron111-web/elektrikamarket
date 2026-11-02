'use strict';
// Operational gates only: normalization, quarantine and publication belong to importPricat.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),https=require('node:https');
const {createHash,randomUUID}=require('node:crypto'),{Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {crc32}=require('node:zlib'),postgres=require('postgres'),unzipper=require('unzipper');
const {readPricat}=require('../import/pricat.cjs');
const {importPricat,VERSION}=require('../import/pricat-import.cjs');
const {PROJECTION_VERSION}=require('../storefront/assortment.cjs');
class GateError extends Error {constructor(code){super(code);this.code=code;}}
const guard=(ok,code)=>{if(!ok)throw new GateError(code);};
const hash=async file=>{const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');};
async function privateJson(file){const s=await fsp.lstat(file);guard(s.isFile()&&(process.platform==='win32'||!(s.mode&0o077)),'PRIVATE_CONFIG_REQUIRED');return JSON.parse(await fsp.readFile(file,'utf8'));}
async function privateDirectory(dir){await fsp.mkdir(dir,{recursive:true,mode:0o700});const s=await fsp.lstat(dir);guard(s.isDirectory()&&(process.platform==='win32'||!(s.mode&0o077)),'PRIVATE_STATE_REQUIRED');}
async function json(file,value){const tmp=file+'.'+randomUUID()+'.tmp',h=await fsp.open(tmp,'wx',0o600);try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}await fsp.rename(tmp,file);if(process.platform!=='win32'){const d=await fsp.open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}}}
function policy(config){
 guard(path.isAbsolute(config.stateDirectory||'')&&path.isAbsolute(config.databaseUrlFile||'')&&typeof config.databaseName==='string'&&(!config.manifestFile||path.isAbsolute(config.manifestFile)),'EXPLICIT_PATHS_AND_DATABASE_REQUIRED');
 const p=config.policy;guard(p&&typeof p==='object','POLICY_REQUIRED');
 for(const k of ['maxAgeHours','maxPairSkewHours','maxManifestAgeHours','maxFutureMinutes','minSourceRecords','maxFileBytes','maxXmlBytes','minFreeBytes','downloadTimeoutMs'])guard(Number.isFinite(p[k])&&p[k]>0,'POLICY_'+k);
 for(const k of ['maxSourceDropFraction','maxIssueFraction','maxMissingFraction','maxRemovedFraction','maxChangedPriceFraction','maxStockCellLossFraction'])guard(Number.isFinite(p[k])&&p[k]>=0&&p[k]<1,'POLICY_'+k);
 guard(Number.isFinite(p.maxPriceChangeFactor)&&p.maxPriceChangeFactor>=1,'POLICY_maxPriceChangeFactor');
 guard(Number.isFinite(p.maxQuantityChangeFactor)&&p.maxQuantityChangeFactor>=1,'POLICY_maxQuantityChangeFactor');
 return p;
}
function manifestCheck(m,p,now){
 guard(typeof m.pairId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(m.pairId),'PAIR_ID_REQUIRED');
 const generated=Date.parse(m.generatedAt);guard(Number.isFinite(generated)&&generated<=now+p.maxFutureMinutes*60000&&generated>=now-p.maxManifestAgeHours*3600000,'MANIFEST_DATE');
 guard(Array.isArray(m.sources)&&m.sources.length===2&&new Set(m.sources.map(s=>s.source)).size===2,'COMPLETE_PAIR_REQUIRED');
 for(const s of m.sources){
  guard(['PRICAT1','PRICAT2'].includes(s.source)&&['xml','zip'].includes(s.format)&&/^[a-f0-9]{64}$/.test(s.sha256||'')&&Number.isSafeInteger(s.sizeBytes)&&s.sizeBytes>0&&s.sizeBytes<=p.maxFileBytes,'SOURCE_DESCRIPTOR');
  guard((!!s.path!==!!s.url)&&(!s.path||path.isAbsolute(s.path))&&/^\d{14}$/.test(s.documentDate||'')&&typeof s.documentNumber==='string'&&s.documentNumber.length>0,'SOURCE_IDENTITY_REQUIRED');
  guard(!Object.hasOwn(s,'authorizationFile')&&!Object.hasOwn(s,'caFile'),'MANIFEST_CANNOT_SELECT_CREDENTIALS');
  if(s.url){const u=new URL(s.url);guard(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash,'HTTPS_ONLY');}
 }
 guard(m.sources[0].sha256!==m.sources[1].sha256,'IDENTICAL_SOURCE_PAIR');
}
async function download(s,p){
 if(s.path){const st=await fsp.lstat(s.path);guard(st.isFile(),'REGULAR_SOURCE_REQUIRED');return fs.createReadStream(s.path);}
 let authorization,ca;
 if(s.authorizationFile){const st=await fsp.lstat(s.authorizationFile);guard(st.isFile()&&(process.platform==='win32'||!(st.mode&0o077)),'PRIVATE_AUTH_REQUIRED');authorization=(await fsp.readFile(s.authorizationFile,'utf8')).trim();guard(authorization.length>0&&authorization.length<8192&&!/[\r\n]/.test(authorization),'AUTH_FORMAT');}
 if(s.caFile)ca=await fsp.readFile(s.caFile);
 return new Promise((resolve,reject)=>{
  const req=https.get(s.url,{rejectUnauthorized:true,ca,maxHeaderSize:16384,headers:{'Accept-Encoding':'identity',...(authorization?{Authorization:authorization}:{})}},res=>{
   if(res.statusCode!==200||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){clearTimeout(timer);res.destroy();reject(new GateError('DOWNLOAD_STATUS_OR_ENCODING'));return;}
   if(res.headers['content-length']&&Number(res.headers['content-length'])!==s.sizeBytes){clearTimeout(timer);res.destroy();reject(new GateError('CONTENT_LENGTH'));return;}
   res.once('end',()=>clearTimeout(timer));res.once('close',()=>clearTimeout(timer));resolve(res);
  });
  const timer=setTimeout(()=>req.destroy(new GateError('DOWNLOAD_TIMEOUT')),p.downloadTimeoutMs);
  req.once('error',()=>{clearTimeout(timer);reject(new GateError('HTTPS_DOWNLOAD_FAILED'));});
 });
}
async function verifyZip(file,max){
 const entries=(await unzipper.Open.file(file)).files.filter(e=>e.type!=='Directory');
 guard(entries.length===1&&/\.xml$/i.test(entries[0].path),'ONE_XML_PER_ZIP');
 const e=entries[0];guard(e.uncompressedSize<=max,'ZIP_EXPANSION_LIMIT');let size=0,crc=0;
 for await(const b of e.stream()){size+=b.length;guard(size<=max,'ZIP_EXPANSION_LIMIT');crc=crc32(b,crc);}
 guard(size===e.uncompressedSize&&crc===e.crc32,'ZIP_CRC_OR_SIZE');
}
async function receive(s,p,dir,now,allowAcceptedOld=false){
 const file=path.join(dir,s.source+'.'+s.format),part=file+'.part';let bytes=0;
 const h=createHash('sha256');
 await pipeline(await download(s,p),new Transform({transform(b,_e,cb){bytes+=b.length;if(bytes>s.sizeBytes||bytes>p.maxFileBytes){cb(new GateError('DOWNLOAD_SIZE'));return;}h.update(b);cb(null,b);}}),fs.createWriteStream(part,{flags:'wx',mode:0o600}));
 guard(bytes===s.sizeBytes&&h.digest('hex')===s.sha256,'SOURCE_SHA256_OR_SIZE');
 if(s.format==='zip')await verifyZip(part,p.maxXmlBytes);else guard(bytes<=p.maxXmlBytes,'XML_SIZE');
 await fsp.rename(part,file);
 const docs=[];let rows=0;
 for await(const _row of readPricat(file,{onMetadata:m=>docs.push(m)}))rows++;
 guard(docs.length===1&&rows>=p.minSourceRecords,'SOURCE_EMPTY_OR_DOCUMENT_COUNT');
 const d=docs[0],date=Date.parse(d.documentDate);
 guard(d.DocumentDate===s.documentDate&&d.DocumentNumber===s.documentNumber,'SOURCE_IDENTITY_MISMATCH');
 guard(date<=now+p.maxFutureMinutes*60000&&(allowAcceptedOld||date>=now-p.maxAgeHours*3600000),'SOURCE_DATE');
 return {source:s.source,path:file,sha256:s.sha256,rows,date};
}
async function baseline(db){
 const [s]=await db`SELECT s.*,f1.sha256 hash1,f2.sha256 hash2,f1.metadata meta1,f2.metadata meta2,r1."importerVersion" version1,r2."importerVersion" version2,c."protectiveMarkupPercent" current_markup FROM assortment_snapshots s JOIN import_files f1 ON f1.id=s."pricat1FileId" JOIN import_files f2 ON f2.id=s."pricat2FileId" JOIN import_runs r1 ON r1.id=f1."runId" JOIN import_runs r2 ON r2.id=f2."runId" CROSS JOIN shop_settings c WHERE s.active AND c.id=1 AND f1.status='SUCCEEDED' AND f2.status='SUCCEEDED' AND r1.status='SUCCEEDED' AND r2.status='SUCCEEDED'`;
 guard(s&&s.productCount>0&&s.projectionVersion===PROJECTION_VERSION,'EXISTING_VALID_SNAPSHOT_REQUIRED');
 guard(String(s.current_markup)===String(s.protectiveMarkupPercent),'MANUAL_SETTINGS_CHANGE_REQUIRES_REVIEW');return s;
}
function dryGates(d,received,b,p){
 guard(d.status==='DRY_RUN'&&d.files.length===2,'DRY_RUN_RESULT');
 guard((d.invalidRecords+d.conflictingCodes)/Math.max(1,d.processedRecords)<=p.maxIssueFraction,'SOURCE_ISSUE_RATE');
 guard(d.missingUniqueCodes/Math.max(1,d.matchedUniqueProducts+d.missingUniqueCodes)<=p.maxMissingFraction,'UNKNOWN_PRODUCTS');
 for(const f of d.files){const r=received.find(x=>x.source===f.source);guard(r&&f.sha256===r.sha256&&f.rows===r.rows,'DRY_RUN_SOURCE_MISMATCH');const previous=f.source==='PRICAT1'?b.meta1:b.meta2;guard(Number.isFinite(previous?.rows)&&previous.rows>0&&Number.isFinite(previous?.uniqueCodes)&&previous.uniqueCodes>0,'BASELINE_SOURCE_STATS_REQUIRED');guard(f.rows>=previous.rows*(1-p.maxSourceDropFraction)&&f.uniqueCodes>=previous.uniqueCodes*(1-p.maxSourceDropFraction),'SOURCE_RECORD_DROP');}
}
async function publicationGates(tx,id,b,p){
 const old=await baseline(tx);guard(String(old.id)===String(b.id),'BASELINE_CHANGED');
 const [m]=await tx`WITH old AS MATERIALIZED (SELECT * FROM assortment_items WHERE "snapshotId"=${b.id}), fresh AS MATERIALIZED (SELECT * FROM assortment_items WHERE "snapshotId"=${id}) SELECT (SELECT count(*) FROM fresh)::int count,(SELECT count(*)::numeric FROM old o WHERE NOT EXISTS(SELECT 1 FROM fresh n WHERE n."productId"=o."productId"))/(SELECT count(*) FROM old) removed,(SELECT count(*) FILTER(WHERE n."retailPrice"<>o."retailPrice")::numeric/NULLIF(count(*),0) FROM old o JOIN fresh n USING("productId")) changed,(SELECT max(greatest(n."retailPrice"/o."retailPrice",o."retailPrice"/n."retailPrice")) FROM old o JOIN fresh n USING("productId")) factor`;
 guard(m.count>0&&Number(m.removed)<=p.maxRemovedFraction&&Number(m.changed||0)<=p.maxChangedPriceFraction&&Number(m.factor||1)<=p.maxPriceChangeFactor,'ASSORTMENT_OR_PRICE_CHANGE');
 const cells=await tx`WITH old AS (SELECT a."productId",s->>'warehouse' warehouse,s->>'uom' uom,(s->>'quantity')::numeric qty FROM assortment_items a CROSS JOIN jsonb_array_elements(a.stocks) s WHERE a."snapshotId"=${b.id}), fresh AS (SELECT a."productId",s->>'warehouse' warehouse,s->>'uom' uom,(s->>'quantity')::numeric qty FROM assortment_items a CROSS JOIN jsonb_array_elements(a.stocks) s WHERE a."snapshotId"=${id}) SELECT o.warehouse,count(*) FILTER(WHERE n."productId" IS NULL)::numeric/count(*) loss,max(greatest(n.qty/o.qty,o.qty/n.qty)) factor FROM old o LEFT JOIN fresh n USING("productId",warehouse,uom) GROUP BY o.warehouse`;
 guard(cells.every(x=>Number(x.loss)<=p.maxStockCellLossFraction),'WAREHOUSE_AVAILABILITY_DROP');
 guard(cells.every(x=>Number(x.factor||1)<=p.maxQuantityChangeFactor),'WAREHOUSE_QUANTITY_JUMP');
 return {count:m.count,removedFraction:String(m.removed),changedPriceFraction:String(m.changed||0),maximumPriceFactor:String(m.factor||1),warehouseLoss:cells.map(x=>({warehouse:x.warehouse,fraction:String(x.loss),maximumQuantityFactor:String(x.factor||1)}))};
}
async function update({config,mode='check',now=Date.now(),event=()=>{},beforePublication=async()=>{}}){
 guard(path.isAbsolute(config.manifestFile||''),'EXPLICIT_MANIFEST_REQUIRED');
 guard(['check','publish'].includes(mode),'EXPLICIT_MODE');const p=policy(config),state=config.stateDirectory;
 await privateDirectory(state);await privateDirectory(path.join(state,'tmp'));const lock=path.join(state,'run.lock');await fsp.mkdir(lock,{mode:0o700}).catch(e=>{throw new GateError(e.code==='EEXIST'?'UPDATE_ALREADY_LOCKED':'LOCK_FAILED');});
 let db,dir,pairId,started=false,committed=false,pgLocked=false;
 const marker=path.join(state,'needs-review.json');
 try{
  guard(!fs.existsSync(marker),'PREVIOUS_PUBLICATION_NEEDS_REVIEW');
  const m=await privateJson(config.manifestFile);manifestCheck(m,p,now);pairId=m.pairId;
  dir=path.join(state,'runs',new Date(now).toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());await privateDirectory(dir);
  const log=async(status,data={})=>{await json(path.join(dir,'result.json'),{status,at:new Date().toISOString(),pairId:m.pairId,...data});event({status,...data});};
  await log('RECEIVING');const space=await fsp.statfs(state);guard(space.bavail*space.bsize>=p.minFreeBytes+8*p.maxXmlBytes,'INSUFFICIENT_STAGING_SPACE');
  const files=[];
  for(const s of m.sources){
   const transport=config.transports?.[s.source];guard(transport&&typeof transport==='object','SOURCE_TRANSPORT_REQUIRED');
   if(s.url){guard(typeof transport.origin==='string'&&new URL(transport.origin).origin===transport.origin&&new URL(s.url).origin===transport.origin,'SOURCE_ORIGIN_NOT_ALLOWED');}
   else {guard(path.isAbsolute(transport.directory||''),'SOURCE_DIRECTORY_REQUIRED');const real=await fsp.realpath(s.path),base=await fsp.realpath(transport.directory);guard(real.startsWith(base+path.sep),'SOURCE_PATH_NOT_ALLOWED');}
   // Only owner configuration chooses credentials/CA; supplier manifests never do.
   files.push(await receive({...s,authorizationFile:transport.authorizationFile,caFile:transport.caFile},p,dir,now,config.reuseSuccessfulSources?.[s.source]===s.sha256));
  }
  if(!Object.keys(config.reuseSuccessfulSources||{}).length)guard(Math.abs(files[0].date-files[1].date)<=p.maxPairSkewHours*3600000,'PAIR_DATE_SKEW');
  await json(path.join(dir,'verified.json'),{pairId:m.pairId,files:files.map(({source,sha256,rows,date})=>({source,sha256,rows,date}))});
  const st=await fsp.lstat(config.databaseUrlFile);guard(st.isFile()&&(process.platform==='win32'||!(st.mode&0o077)),'PRIVATE_DATABASE_URL_REQUIRED');
  const databaseUrl=(await fsp.readFile(config.databaseUrlFile,'utf8')).trim(),u=new URL(databaseUrl);
  guard(['postgres:','postgresql:'].includes(u.protocol)&&decodeURIComponent(u.pathname.slice(1))===config.databaseName&&!decodeURIComponent(u.username).startsWith('storefront_'),'DATABASE_TARGET_OR_ROLE');
  db=postgres(databaseUrl,{max:1,onnotice:()=>{},connection:{statement_timeout:'60s',lock_timeout:'2s',application_name:'pricat-update-guard'}});
  const [l]=await db`SELECT pg_try_advisory_lock(1707312403) acquired`;guard(l.acquired,'UPDATE_ALREADY_RUNNING');pgLocked=true;
  const b=await db.begin('isolation level repeatable read read only',baseline);
  for(const f of files)if(config.reuseSuccessfulSources?.[f.source]===f.sha256)guard(f.sha256===(f.source==='PRICAT1'?b.hash1:b.hash2),'REUSED_SOURCE_NOT_CURRENTLY_ACCEPTED');
  if(files.every(f=>f.sha256===(f.source==='PRICAT1'?b.hash1:b.hash2))&&b.version1===VERSION&&b.version2===VERSION){await log('UNCHANGED',{snapshotId:String(b.id),count:b.productCount});return {status:'UNCHANGED',snapshotId:String(b.id),count:b.productCount};}
  const dryReport=path.join(dir,'dry-issues.ndjson');await fsp.writeFile(dryReport,'',{flag:'wx',mode:0o600});
  const dry=await importPricat({databaseUrl,files,mode:'dry-run',conflictPolicy:'quarantine',reportPath:dryReport});dryGates(dry,files,b,p);
  await log('CHECKED',{rows:files.map(f=>({source:f.source,rows:f.rows})),issueCount:dry.errorCount});
  if(mode==='check')return {status:'CHECKED'};
  for(const f of files)guard(await hash(f.path)===f.sha256,'FILE_CHANGED_AFTER_CHECK');
  await beforePublication();
  await json(marker,{runDirectory:dir,pairId:m.pairId,status:'PUBLICATION_PENDING_REVIEW_IF_INTERRUPTED'});started=true;
  let tx,metrics;
  const publishReport=path.join(dir,'publish-issues.ndjson');await fsp.writeFile(publishReport,'',{flag:'wx',mode:0o600});
  const result=await importPricat({databaseUrl,files,mode:'production',conflictPolicy:'quarantine',reportPath:publishReport,
   beforePublish:async ctx=>{tx=ctx.db;const current=await baseline(tx);guard(String(current.id)===String(b.id),'BASELINE_CHANGED');},
   beforeSnapshotActivate:async({snapshotId})=>{guard(tx,'PUBLICATION_TRANSACTION_REQUIRED');metrics=await publicationGates(tx,snapshotId,b,p);}});
  committed=true;guard(result.status==='SUCCEEDED'&&result.assortment&&metrics,'PUBLICATION_RESULT_REQUIRES_REVIEW');
  const after=await db.begin('isolation level repeatable read read only',async t=>{const s=await baseline(t);guard(String(s.id)===String(result.assortment.id)&&s.productCount===metrics.count,'POST_COMMIT_VERIFICATION');const [n]=await t`SELECT count(*)::int count FROM assortment_items WHERE "snapshotId"=${s.id}`;guard(n.count===s.productCount,'POST_COMMIT_COUNT');return s;});
  const quarantineDiagnostics=await db`SELECT code,count(*)::int count FROM import_issues WHERE "runId"=${result.runId}
    AND code IN ('CONFLICTING_DUPLICATE','INVALID_RECORD','QUARANTINED_STOCK','STOCK_UOM_CONFLICT','COMMERCIAL_UNIT_CONFLICT','LOCKED_QUARANTINE') GROUP BY code ORDER BY code`;
  const stockMetrics={zeroedStocks:result.zeroedStocks,zeroedPositiveStocks:result.zeroedPositiveStocks,stockZeroing:result.stockZeroing,normalizedQuantities:result.normalizedQuantities,updatedRecords:result.updatedRecords,quarantineDiagnostics};
  await log('SUCCEEDED',{runId:result.runId,snapshotId:String(after.id),count:after.productCount,metrics,...stockMetrics});await fsp.unlink(marker);
  return {status:'SUCCEEDED',runId:result.runId,snapshotId:String(after.id),count:after.productCount,...stockMetrics};
 }catch(e){
  const code=e instanceof GateError?e.code:'UPDATE_FAILED';
  let publicationRolledBack=false;
  if(started&&!committed&&db&&e.runId) {
   try { const [audit]=await db`SELECT status FROM import_runs WHERE id=${e.runId}`;publicationRolledBack=audit?.status==='FAILED';if(publicationRolledBack)await fsp.unlink(marker); } catch { publicationRolledBack=false; }
  }
  if(dir)await json(path.join(dir,'result.json'),{status:started&&!publicationRolledBack?'NEEDS_REVIEW':'FAILED',pairId,at:new Date().toISOString(),code,causeCode:/^[A-Z0-9_]{2,80}$/.test(e.code||'')?e.code:null,commitAcknowledged:committed,publicationRolledBack,runId:e.runId||null}).catch(()=>{});
  const error=new GateError(code);error.publicationRolledBack=publicationRolledBack;throw error;
 }finally{
  if(db){try{if(pgLocked)await db`SELECT pg_advisory_unlock(1707312403)`;}finally{await db.end({timeout:5});}}
  await fsp.rmdir(lock);
 }
}
async function main(){process.umask(0o077);const a=process.argv.slice(2);guard(a.length===4&&a[0]==='--config'&&a[2]==='--mode','USAGE_CONFIG_MODE');const result=await update({config:await privateJson(a[1]),mode:a[3],event:x=>console.log(JSON.stringify(x))});console.log(JSON.stringify(result));}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'STOPPED',code:e instanceof GateError?e.code:'UPDATE_FAILED'}));process.exitCode=1;});
module.exports={update,policy,manifestCheck,receive,publicationGates,GateError,privateJson,privateDirectory,json,hash};

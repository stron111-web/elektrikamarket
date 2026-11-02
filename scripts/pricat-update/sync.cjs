'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{randomUUID}=require('node:crypto');
const {update,policy,privateJson,privateDirectory,json,hash,GateError}=require('./update.cjs');
const {FtpsSource,SOURCES}=require('./ftps.cjs');
const guard=(ok,code)=>{if(!ok)throw new GateError(code);};
const same=(a,b)=>a?.name===b?.name&&a?.sizeBytes===b?.sizeBytes&&a?.modified===b?.modified;
function remoteDates(entries,p,now,reusedSources=[]){
 const dates=entries.map(f=>{const r=f.date;guard(/^\d{14}$/.test(r),'FTP_SOURCE_DATE');const t=Date.parse(`${r.slice(0,4)}-${r.slice(4,6)}-${r.slice(6,8)}T${r.slice(8,10)}:${r.slice(10,12)}:${r.slice(12,14)}Z`);guard(Number.isFinite(t)&&new Date(t).toISOString().replace(/\D/g,'').slice(0,14)===r&&(reusedSources.includes(f.source)||t>=now-p.maxAgeHours*3600000)&&t<=now+p.maxFutureMinutes*60000,'FTP_SOURCE_DATE');return t;});
 if(!reusedSources.length)guard(Math.max(...dates)-Math.min(...dates)<=p.maxPairSkewHours*3600000,'PAIR_DATE_SKEW');
}
async function loadState(file,root){
 if(!fs.existsSync(file))return {versions:{PRICAT1:[],PRICAT2:[]}};
 const s=await privateJson(file);guard(s.version===1&&s.versions,'FTP_STATE_FORMAT');
 for(const {source,format}of SOURCES){
  const v=s.versions[source];guard(Array.isArray(v)&&v.length>=1&&v.length<=2,'FTP_STATE_FORMAT');
  for(const f of v){guard(f.source===source&&f.format===format&&/^[a-f0-9]{64}$/.test(f.sha256)&&f.path===path.join(root,'versions',source,f.sha256+'.'+format),'FTP_STATE_PATH');guard(await hash(f.path)===f.sha256,'FTP_CACHE_CORRUPT');}
 }
 return s;
}
async function trim(root,state){
 // Called ONLY after acknowledged publication + durable state. No DB deletion.
 for(const {source}of SOURCES){const dir=path.join(root,'versions',source),keep=new Set(state.versions[source].map(f=>path.basename(f.path)));for(const name of await fsp.readdir(dir))if(/^[a-f0-9]{64}\.(zip|xml)$/.test(name)&&!keep.has(name))await fsp.unlink(path.join(dir,name));}
}
async function trimSuccessfulRunInputs(state){
 const root=path.join(state,'runs');if(!fs.existsSync(root))return;
 for(const entry of await fsp.readdir(root,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const dir=path.join(root,entry.name),record=path.join(dir,'result.json');if(!fs.existsSync(record))continue;
  const r=await privateJson(record);if(!['SUCCEEDED','UNCHANGED'].includes(r.status))continue;
  for(const f of ['PRICAT1.zip','PRICAT1.xml','PRICAT2.zip','PRICAT2.xml'])await fsp.unlink(path.join(dir,f)).catch(e=>{if(e.code!=='ENOENT')throw e;});
 }
}
async function sync({config,mode='check',now=Date.now(),event=()=>{},sourceFactory=(c,p)=>new FtpsSource(c,p)}){
 guard(['check','publish'].includes(mode),'EXPLICIT_MODE');const p=policy(config);
 await privateDirectory(config.stateDirectory);const root=path.join(config.stateDirectory,'ftp');await privateDirectory(root);
 const lock=path.join(root,'sync.lock');await fsp.mkdir(lock,{mode:0o700}).catch(e=>{throw new GateError(e.code==='EEXIST'?'FTP_SYNC_LOCKED':'FTP_LOCK_FAILED');});
 const marker=path.join(root,'needs-review.json'),stateFile=path.join(root,'state.json');let client,incoming,stage='preconditions';
 const log=async(status,data={})=>{const record={at:new Date().toISOString(),status,...data};const h=await fsp.open(path.join(root,'events.ndjson'),'a',0o600);try{await h.writeFile(JSON.stringify(record)+'\n');await h.sync();}finally{await h.close();}event(record);};
 try{
  guard(!fs.existsSync(marker)&&!fs.existsSync(path.join(config.stateDirectory,'needs-review.json')),'PREVIOUS_PUBLICATION_NEEDS_REVIEW');
  const previous=await loadState(stateFile,root);
  const space=await fsp.statfs(root);guard(space.bavail*space.bsize>=p.minFreeBytes+8*p.maxXmlBytes,'INSUFFICIENT_STAGING_SPACE');
  stage='ftps';client=sourceFactory(config.ftp,p);await client.connect();
  const entries=await client.latest(now);guard(entries.length===2&&new Set(entries.map(f=>f.source)).size===2,'COMPLETE_PAIR_REQUIRED');
  const changed=entries.filter(f=>!same(f,previous.versions[f.source]?.[0]?.remote));
  if(!changed.length){await log('NO_REMOTE_CHANGE');return {status:'NO_REMOTE_CHANGE'};}
  const reusedSources=entries.filter(f=>!changed.includes(f)).map(f=>f.source);
  remoteDates(entries,p,now,reusedSources);
  incoming=path.join(root,'incoming-'+randomUUID());await privateDirectory(incoming);
  const files=[];
  for(const entry of entries){
   const prior=previous.versions[entry.source]?.[0];
   if(prior&&same(entry,prior.remote)){files.push(prior);continue;}
   const fresh=await client.download(entry,incoming);
   if(prior)guard(fresh.documentDate>=prior.documentDate&&(fresh.documentDate!==prior.documentDate||fresh.sha256===prior.sha256),'FTP_NON_MONOTONIC_DOCUMENT');
   files.push(fresh);
  }
  // Re-list BOTH folders, including the reused source: no mid-download mixed pair.
  const again=await client.latest(now);guard(entries.every(f=>same(f,again.find(n=>n.source===f.source))),'FTP_PAIR_CHANGED_DURING_DOWNLOAD');
  client.close();client=null;
  const manifestFile=path.join(incoming,'pair.json');await json(manifestFile,{pairId:'ftp-'+randomUUID(),generatedAt:new Date(now).toISOString(),sources:files.map(({remote,...f})=>f)});
  const runConfig={...config,manifestFile,reuseSuccessfulSources:Object.fromEntries(files.filter(f=>reusedSources.includes(f.source)).map(f=>[f.source,f.sha256])),transports:Object.fromEntries(SOURCES.map(s=>[s.source,{directory:root}]))};
  const mark=()=>json(marker,{at:new Date().toISOString(),status:'PUBLICATION_PENDING',inputs:files.map(f=>({source:f.source,sha256:f.sha256}))});
  stage='import';
  let result;
  try { result=await update({config:runConfig,mode,now,event,beforePublication:mark}); }
  catch(e) { if(e.publicationRolledBack)await fsp.unlink(marker).catch(err=>{if(err.code!=='ENOENT')throw err;});throw e; }
  if(mode==='check'){await log('CHECKED',{changedSources:changed.map(f=>f.source)});return result;}
  guard(['SUCCEEDED','UNCHANGED'].includes(result.status),'FTP_PUBLICATION_UNCONFIRMED');
  // UNCHANGED skips production; protect its initial cache adoption as well.
  if(!fs.existsSync(marker))await mark();
  stage='retain';const next={version:1,snapshotId:result.snapshotId,lastPublication:result.status==='SUCCEEDED'?{at:new Date().toISOString(),...result}:previous.lastPublication??{at:new Date().toISOString(),...result},versions:{}};
  for(const f of files){
   const dir=path.join(root,'versions',f.source);await privateDirectory(dir);
   const parent=await fsp.open(path.dirname(dir),'r');try{await parent.sync();}finally{await parent.close();}
   const dest=path.join(dir,f.sha256+'.'+f.format);
   if(fs.existsSync(dest)){guard(await hash(dest)===f.sha256,'FTP_CACHE_CORRUPT');}
   else {await fsp.rename(f.path,dest);const h=await fsp.open(dir,'r');try{await h.sync();}finally{await h.close();}}
   const prior=previous.versions[f.source][0];
   const current={...f,path:dest,acceptedAt:prior?.sha256===f.sha256?prior.acceptedAt??new Date().toISOString():new Date().toISOString()};next.versions[f.source]=[current,...previous.versions[f.source].filter(old=>old.sha256!==f.sha256)].slice(0,2);
  }
  await json(stateFile,next);
  await trim(root,next);await trimSuccessfulRunInputs(config.stateDirectory);
  await log(result.status,{snapshotId:result.snapshotId,count:result.count,runId:result.runId,zeroedStocks:result.zeroedStocks,zeroedPositiveStocks:result.zeroedPositiveStocks,stockZeroing:result.stockZeroing,normalizedQuantities:result.normalizedQuantities,updatedRecords:result.updatedRecords,quarantineDiagnostics:result.quarantineDiagnostics,changedSources:changed.map(f=>f.source)});
  await fsp.unlink(marker);return result;
 }catch(e){
  const code=e instanceof GateError?e.code:'FTPS_OR_UPDATE_FAILED';
  const transportCode=Number.isInteger(e.code)?e.code:['ENOTFOUND','ECONNREFUSED','ETIMEDOUT','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID'].includes(e.code)?e.code:null;
  await log('STOPPED',{stage,code,transportCode}).catch(()=>{});throw new GateError(code);
 }finally{
  if(client)client.close();
  // Failed candidate only, never a successfully retained version. After uncertain
  // COMMIT keep it for operator reconciliation along with needs-review marker.
  if(incoming&&!fs.existsSync(marker))await fsp.rm(incoming,{recursive:true,force:true});
  await fsp.rmdir(lock);
 }
}
async function main(){process.umask(0o077);const a=process.argv.slice(2);guard(a.length===4&&a[0]==='--config'&&a[2]==='--mode','USAGE_CONFIG_MODE');console.log(JSON.stringify(await sync({config:await privateJson(a[1]),mode:a[3],event:x=>console.log(JSON.stringify(x))})));}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'STOPPED',code:e instanceof GateError?e.code:'FTPS_OR_UPDATE_FAILED'}));process.exitCode=1;});
module.exports={sync,loadState,remoteDates};

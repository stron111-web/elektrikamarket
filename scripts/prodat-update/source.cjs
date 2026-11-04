'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{randomUUID}=require('node:crypto'),{Client}=require('basic-ftp');
const {privateJson,privateDirectory,json,hash,GateError}=require('../pricat-update/update.cjs');
const {preflight}=require('./preflight.cjs');const {download,guard}=require('./files.cjs');
const SOURCE='/allstock/TVER/';
function validateConfig(c){
 guard(c?.version===2&&path.isAbsolute(c.stateDirectory||'')&&path.isAbsolute(c.credentialsFile||'')&&c.sourceDirectory===SOURCE,'EXPLICIT_TVER_CONFIG_REQUIRED');
 guard(c.host==='service.russvet.ru'&&c.port===21021&&c.allowPlaintextForRussvet===true,'PINNED_RUSSVET_FTP_REQUIRED');
 if(c.bootstrapDirectory||c.bootstrapVerificationFile)guard(path.isAbsolute(c.bootstrapDirectory||'')&&path.isAbsolute(c.bootstrapVerificationFile||''),'ABSOLUTE_BOOTSTRAP_PATHS_REQUIRED');
 const p=c.policy;guard(p,'SOURCE_POLICY_REQUIRED');
 for(const k of ['settleSeconds','maxModificationSkewSeconds','maxAgeHours','maxFileBytes','maxXmlBytes','minFreeBytes','downloadTimeoutMs','firstPartRecords','minSecondPartRecords','baselineUniqueCodes'])guard(Number.isFinite(p[k])&&p[k]>0,'POLICY_'+k);
 guard(Number.isFinite(p.maxSourceDropFraction)&&p.maxSourceDropFraction>=0&&p.maxSourceDropFraction<1,'POLICY_maxSourceDropFraction');
 guard(p.maxFileBytes<=128*1024**2&&p.maxXmlBytes<=2*1024**3&&p.firstPartRecords===100000,'SOURCE_SIZE_POLICY');
}
const same=(a,b)=>a.name===b.name&&a.sizeBytes===b.sizeBytes&&a.modified===b.modified;
async function discover(client,c,now){
 const list=await client.list(SOURCE);guard(list.length<=100,'SOURCE_LIST_LIMIT');
 const files=list.filter(f=>f.isFile&&/^PRODAT_369147_\d{1,20}\.zip$/i.test(f.name)).sort((a,b)=>BigInt(a.name.match(/_(\d+)\.zip$/i)[1])<BigInt(b.name.match(/_(\d+)\.zip$/i)[1])?-1:1);
 guard(files.length===2&&files[0].name!==files[1].name,'EXACT_TWO_PRODAT_PARTS_REQUIRED');
 const result=[];for(const f of files){
  const full=SOURCE+f.name,sizeBytes=await client.size(full),modified=(await client.lastMod(full)).toISOString(),age=now-Date.parse(modified);
  guard(Number.isSafeInteger(sizeBytes)&&sizeBytes>0&&sizeBytes<=c.policy.maxFileBytes,'SOURCE_SIZE');
  guard(age>=c.policy.settleSeconds*1000&&age<=c.policy.maxAgeHours*3600000,'SOURCE_UNSETTLED_OR_STALE');result.push({name:f.name,path:full,sizeBytes,modified});
 }
 guard(Math.abs(Date.parse(result[0].modified)-Date.parse(result[1].modified))<=c.policy.maxModificationSkewSeconds*1000,'SOURCE_MODIFICATION_SKEW');return result;
}
function contentGates(verification,c,previous,now){
 guard(verification.status==='VERIFIED'&&verification.conflicts===0&&verification.invalidRecords===0&&verification.categoryConflicts===0,'SOURCE_CONTENT_REJECTED');
 guard(verification.parts.length===2&&verification.parts[0].records===c.policy.firstPartRecords&&verification.parts[1].records>=c.policy.minSecondPartRecords,'PART_RECORD_COUNT');
 guard(verification.parts.every(p=>p.xmlBytes<=c.policy.maxXmlBytes),'XML_SIZE_LIMIT');
 const baseline=previous?.uniqueSenderPrdCode??c.policy.baselineUniqueCodes;
 guard(verification.uniqueSenderPrdCode>=baseline*(1-c.policy.maxSourceDropFraction),'SOURCE_CODE_DROP');
 const dates=verification.parts.map(p=>p.document.DocumentDate);guard(dates.every(d=>d===dates[0]),'MIXED_PRODAT_GENERATION');
 const date=Date.parse(verification.parts[0].document.documentDate);guard(Number.isFinite(date)&&date<=now+5*60000&&date>=now-c.policy.maxAgeHours*3600000,'DOCUMENT_STALE_OR_FUTURE');
 if(previous){
  guard(dates[0]>previous.parts[0].document.DocumentDate,'DOCUMENT_GENERATION_MUST_ADVANCE');
  guard(verification.parts.every((p,i)=>p.name!==previous.parts[i].name&&p.sha256!==previous.parts[i].sha256),'BOTH_PRODAT_PARTS_MUST_ADVANCE');
 }
}
async function sourceStatus(c){validateConfig(c);let state=null;try{state=await privateJson(path.join(c.stateDirectory,'source-state.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 let publication=null;try{publication=await privateJson(path.join(c.stateDirectory,'last-publication.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 return {publicationEnabled:c.publicationEnabled===true,sourceDirectory:SOURCE,lastCheck:state?.lastCheck??null,lastDownload:state?.lastDownload??null,lastVerification:state?.lastVerified?{date:state.lastVerified.parts[0].document.DocumentDate,uniqueCodes:state.lastVerified.uniqueSenderPrdCode,identicalDuplicates:state.lastVerified.identicalDuplicates,conflicts:state.lastVerified.conflicts}:null,lastImport:publication?{status:publication.status,at:publication.at,createdProducts:publication.createdProducts??0,updatedProducts:publication.updatedProducts??0,newSaleOffers:publication.newSaleOffers??0,code:publication.code??null}:null,needsReview:fs.existsSync(path.join(c.stateDirectory,'needs-review.json'))};}
async function checkSource({config:c,now=Date.now(),clientFactory=()=>new Client(30000),verifier=preflight,event=()=>{}}){
 validateConfig(c);await privateDirectory(c.stateDirectory);const lock=path.join(c.stateDirectory,'source.lock');
 try{await fsp.mkdir(lock,{mode:0o700});}catch(e){throw new GateError(e.code==='EEXIST'?'SOURCE_CHECK_LOCKED':'SOURCE_LOCK_FAILED');}
 let state={version:2},entries,client,stage='preconditions',downloadedFiles=0;
 try{try{state=await privateJson(path.join(c.stateDirectory,'source-state.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  guard(!fs.existsSync(path.join(c.stateDirectory,'needs-review.json')),'PUBLICATION_NEEDS_REVIEW');
  const auth=await privateJson(c.credentialsFile);guard(auth.username==='prodat'&&typeof auth.password==='string'&&auth.password.length>0&&!/[\x00-\x1f\x7f]/.test(auth.username+auth.password),'PRODAT_CREDENTIAL_FORMAT');
  const connect=async()=>{const next=clientFactory();next.ftp.verbose=false;try{await next.access({host:c.host,port:c.port,user:auth.username,password:auth.password,secure:false});return next;}catch(e){next.close();throw e;}};
  stage='ftp';client=await connect();entries=await discover(client,c,now);
  if(state.lastMetadata?.length===2&&entries.every((f,i)=>same(f,state.lastMetadata[i]))){
   client.close();client=null;
   if(state.lastVerified&&state.currentCandidate?.verified){const d=Date.parse(state.lastVerified.parts[0].document.documentDate);guard(d>=now-c.policy.maxAgeHours*3600000,'DOCUMENT_STALE_OR_FUTURE');}
   const result={at:new Date(now).toISOString(),status:state.currentCandidate?.verified?'UNCHANGED_VERIFIED':'UNCHANGED_REJECTED',downloadedFiles:0,sourceDirectory:SOURCE};state.lastCheck=result;await save();event(result);return {state,...result};
  }
  const space=await fsp.statfs(c.stateDirectory);guard(space.bavail*space.bsize>=c.policy.minFreeBytes+2*c.policy.maxXmlBytes,'INSUFFICIENT_STAGING_SPACE');
  const directory=path.join(c.stateDirectory,'candidates',new Date(now).toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());await privateDirectory(directory);
  let files=[],adopted=false;
  if(!state.lastVerified&&c.bootstrapDirectory&&c.bootstrapVerificationFile&&c.bootstrapApproved?.length===2&&entries.every((f,i)=>same(f,c.bootstrapApproved[i]))){
   const proof=await privateJson(c.bootstrapVerificationFile);guard(proof.status==='VERIFIED','BOOTSTRAP_VERIFICATION_REQUIRED');
   for(const f of entries){const approved=c.bootstrapApproved.find(p=>p.name===f.name),part=proof.parts.find(p=>p.name===f.name);const input=path.join(c.bootstrapDirectory,f.name);guard(part?.sha256===approved.sha256&&await hash(input)===approved.sha256,'BOOTSTRAP_SHA_MISMATCH');const dest=path.join(directory,f.name);await fsp.copyFile(input,dest,fs.constants.COPYFILE_EXCL);await fsp.chmod(dest,0o600);files.push({path:dest,name:f.name,sha256:approved.sha256});}
   adopted=true;
  }else for(const entry of entries){files.push(await download(client,entry,directory,c.policy));downloadedFiles++;}
  client.close();client=null;
  if(state.lastVerified&&files.every((f,i)=>f.sha256===state.lastVerified.parts[i].sha256)){
   state.lastMetadata=entries;const result={at:new Date(now).toISOString(),status:'UNCHANGED_BYTES',downloadedFiles,sourceDirectory:SOURCE};state.lastCheck=result;if(downloadedFiles)state.lastDownload={at:result.at,files:entries.map(f=>f.name)};await save();event(result);return {state,...result};
  }
  stage='content';let verification;
  if(adopted)verification=await privateJson(c.bootstrapVerificationFile);else verification=await verifier(files,{progress:event,maxXmlBytes:c.policy.maxXmlBytes});
  state.currentCandidate={files,verification,verified:false,directory};state.lastMetadata=entries;
  contentGates(verification,c,state.lastVerified,now);
  stage='recheck';client=await connect();const again=await discover(client,c,Date.now());guard(entries.every((f,i)=>same(f,again[i])),'SOURCE_CHANGED_DURING_VERIFICATION');client.close();client=null;
  for(const f of files)guard(await hash(f.path)===f.sha256,'CACHED_SOURCE_CORRUPT');
  state.currentCandidate.verified=true;state.lastVerified=verification;if(downloadedFiles)state.lastDownload={at:new Date(now).toISOString(),files:entries.map(f=>f.name)};
  const result={at:new Date(now).toISOString(),status:'VERIFIED',downloadedFiles,adoptedVerifiedBootstrap:adopted,sourceDirectory:SOURCE,uniqueCodes:verification.uniqueSenderPrdCode,identicalDuplicates:verification.identicalDuplicates,conflicts:verification.conflicts};state.lastCheck=result;await save();event(result);return {state,...result};
 }catch(e){const result={at:new Date(now).toISOString(),status:'STOPPED',stage,code:e instanceof GateError?e.code:'PRODAT_CHECK_FAILED',downloadedFiles};state.lastCheck=result;if(downloadedFiles)state.lastDownload={at:result.at,completedFiles:downloadedFiles,files:entries.slice(0,downloadedFiles).map(f=>f.name)};if(entries&&state.currentCandidate?.verified===false)state.lastMetadata=entries;await save();event(result);const error=new GateError(result.code);error.result=result;throw error;}
 finally{client?.close();await fsp.rmdir(lock);}
 async function save(){await json(path.join(c.stateDirectory,'source-state.json'),state);const h=await fsp.open(path.join(c.stateDirectory,'events.ndjson'),'a',0o600);try{await h.writeFile(JSON.stringify(state.lastCheck)+'\n');await h.sync();}finally{await h.close();}}
}
module.exports={validateConfig,discover,contentGates,checkSource,sourceStatus,SOURCE};

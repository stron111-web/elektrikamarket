'use strict';
// Discovery is deliberately read-only. A directory listing cannot prove that a
// multipart PRODAT generation is complete. Never infer its publication contract.
const fs=require('node:fs/promises'),path=require('node:path');
const {Client}=require('basic-ftp');
const {privateJson,privateDirectory,json,GateError}=require('../pricat-update/update.cjs');
const guard=(ok,code)=>{if(!ok)throw new GateError(code);};
const safeName=name=>typeof name==='string'&&name!=='.'&&name!=='..'&&!/[\\/\x00-\x1f\x7f]/.test(name)&&name.length<=255;
function validate(config){
 guard(config&&config.version===1&&config.mode==='discovery-only','DISCOVERY_ONLY_REQUIRED');
 guard(path.isAbsolute(config.stateDirectory||'')&&path.isAbsolute(config.credentialsFile||''),'ABSOLUTE_PATHS_REQUIRED');
 guard(config.host==='service.russvet.ru'&&config.port===21021&&config.allowPlaintextForRussvet===true,'PINNED_RUSSVET_ENDPOINT_REQUIRED');
 for(const [k,max] of [['maxDirectories',100],['maxDepth',10],['maxEntries',10000],['timeoutMs',60000],['totalTimeoutMs',300000]])guard(Number.isInteger(config[k])&&config[k]>0&&config[k]<=max,'DISCOVERY_LIMIT_'+k);
}
async function discover(client,config){
 const pending=[{directory:'/',depth:0}],directories=[],files=[];let entries=0,incomplete=false;
 while(pending.length){
  guard(directories.length<config.maxDirectories,'DIRECTORY_LIMIT');
  const {directory,depth}=pending.shift(),listing=await client.list(directory);
  entries+=listing.length;guard(entries<=config.maxEntries,'ENTRY_LIMIT');
  directories.push({path:directory,entries:listing.length});
  for(const item of listing){
   guard(safeName(item.name),'UNSAFE_REMOTE_NAME');
   if(item.isSymbolicLink) {incomplete=true;continue;}
   if(item.isDirectory){if(depth>=config.maxDepth)incomplete=true;else pending.push({directory:directory+item.name+'/',depth:depth+1});}
   else if(item.isFile){guard(Number.isSafeInteger(item.size)&&item.size>=0,'REMOTE_SIZE');files.push({directory,name:item.name,sizeBytes:item.size,modified:item.modifiedAt?.toISOString()??null});}
   else incomplete=true;
  }
 }
 const prodat=files.filter(f=>/^PRODAT.*\.(zip|xml)$/i.test(f.name));
 return {directories,filesSeen:files.length,prodat,completeTraversal:!incomplete,
  status:incomplete?'DISCOVERY_INCOMPLETE':prodat.length?'SOURCE_CONTRACT_REQUIRED':'SOURCE_UNAVAILABLE'};
}
async function readStatus(config){
 validate(config);
 try{return await privateJson(path.join(config.stateDirectory,'status.json'));}
 catch(e){if(e.code!=='ENOENT')throw e;return {mode:'discovery-only',status:'NEVER_CHECKED',publicationEnabled:false,lastDownload:null,lastImport:null,createdRecords:0,updatedRecords:0};}
}
async function check(config,{clientFactory=()=>new Client(config.timeoutMs),now=()=>new Date().toISOString()}={}){
 validate(config);await privateDirectory(config.stateDirectory);
 const lock=path.join(config.stateDirectory,'check.lock');
 try{await fs.mkdir(lock,{mode:0o700});}catch(e){throw new GateError(e.code==='EEXIST'?'CHECK_ALREADY_RUNNING':'CHECK_LOCK_FAILED');}
 let client,timer;const startedAt=now();
 let report={mode:'discovery-only',publicationEnabled:false,startedAt,lastDownload:null,lastImport:null,createdRecords:0,updatedRecords:0};
 try{
  const auth=await privateJson(config.credentialsFile);
  guard(typeof auth.username==='string'&&auth.username.length>0&&typeof auth.password==='string'&&auth.password.length>0&&!/[\x00-\x1f\x7f]/.test(auth.username+auth.password),'CREDENTIAL_FORMAT');
  client=clientFactory();client.ftp.verbose=false;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{client.close();reject(new GateError('DISCOVERY_TIMEOUT'));},config.totalTimeoutMs);});
  const work=async()=>{await client.access({host:config.host,port:config.port,user:auth.username,password:auth.password,secure:false});return discover(client,config);};
  report={...report,...await Promise.race([work(),timeout])};
 }catch(e){report={...report,status:'CHECK_FAILED',errorCode:e instanceof GateError?e.code:'FTP_DISCOVERY_FAILED'};}
 finally{clearTimeout(timer);client?.close();}
 try{
  report.lastCheck=now();
  await json(path.join(config.stateDirectory,'status.json'),report);
  const log=await fs.open(path.join(config.stateDirectory,'events.ndjson'),'a',0o600);
  try{await log.writeFile(JSON.stringify(report)+'\n');await log.sync();}finally{await log.close();}
  return report;
 }finally{await fs.rmdir(lock);}
}
async function main(){
 process.umask(0o077);const args=process.argv.slice(2);
 guard(args.length===4&&args[0]==='--config'&&args[2]==='--mode'&&['check','status'].includes(args[3]),'USAGE_CHECK_OR_STATUS');
 const config=await privateJson(args[1]);
 const result=args[3]==='status'?await readStatus(config):await check(config);
 console.log(JSON.stringify(result,null,2));if(result.status==='CHECK_FAILED')process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'STOPPED',errorCode:e instanceof GateError?e.code:'PRODAT_CHECK_FAILED'}));process.exitCode=1;});
module.exports={validate,safeName,discover,check,readStatus};

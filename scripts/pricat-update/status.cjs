'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {privateJson,GateError}=require('./update.cjs');
async function status(config){
 const root=path.join(config.stateDirectory,'ftp');
 const exists=async file=>{try{await fs.access(file);return true;}catch{return false;}};
 const state=await exists(path.join(root,'state.json'))?await privateJson(path.join(root,'state.json')):null;
 const logFile=path.join(root,'events.ndjson');
 let events=[];
 if(await exists(logFile)){
  const h=await fs.open(logFile,'r');try{const s=await h.stat(),length=Math.min(s.size,262144),buf=Buffer.alloc(length);await h.read(buf,0,length,s.size-length);let text=buf.toString('utf8');if(s.size>length)text=text.slice(text.indexOf('\n')+1);events=text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}finally{await h.close();}
 }
 const last=events.at(-1)??null;
 const lastPublication=state?.lastPublication??events.findLast(e=>e.status==='SUCCEEDED')??events.findLast(e=>e.status==='UNCHANGED')??null;
 return{databaseName:config.databaseName,execution:'VPS Docker one-shot; check installed cron separately',
  sources:Object.fromEntries(['PRICAT1','PRICAT2'].map(source=>{const f=state?.versions?.[source]?.[0];return[source,f?{documentDate:f.documentDate,acceptedAt:f.acceptedAt??null,fileName:f.remote?.name??null,sha256:f.sha256}:null];})),
  snapshotId:state?.snapshotId??null,lastCheck:last,lastPublication,
  needsReview:await exists(path.join(root,'needs-review.json'))||await exists(path.join(config.stateDirectory,'needs-review.json')),
  note:'quarantineDiagnostics counts diagnostics in the last publication, not unique remaining warehouse cells. No secret or database connection is read for this status.'};
}
if(require.main===module)(async()=>{if(process.argv.length!==4||process.argv[2]!=='--config')throw new GateError('USAGE_CONFIG');console.log(JSON.stringify(await status(await privateJson(process.argv[3])),null,2));})().catch(e=>{console.error(e instanceof GateError?e.code:'STATUS_FAILED');process.exitCode=1;});
module.exports={status};

'use strict';
const {performance}=require('node:perf_hooks');
const safeCode=e=>/^[A-Z_]{5,80}$/.test(e?.code||'')?e.code:'IMPORT_FAILED';
async function supervise(work,limits,{emit=v=>console.log(JSON.stringify(v)),tickMs=1000}={}) {
  for(const k of ['maxRunMs','stallMs','terminateGraceMs'])if(!Number.isSafeInteger(limits[k])||limits[k]<=0)throw Error('EXPLICIT_RUNTIME_LIMITS');
  const controller=new AbortController(),started=performance.now();
  let last=started,lastEmit=0,signature='',forceTimer;
  const stop=code=>{
    if(controller.signal.aborted)return;
    const error=Object.assign(new Error(code),{code});controller.abort(error);
    emit({status:'ABORTING',code,at:new Date().toISOString()});
    // An interrupted connection rolls back; pending-publication markers remain.
    forceTimer=setTimeout(()=>process.exit(code==='JOB_SIGTERM'?143:124),limits.terminateGraceMs);
    forceTimer.unref();
  };
  const term=()=>stop('JOB_SIGTERM');process.on('SIGTERM',term);process.on('SIGINT',term);
  const progress=p=>{
    controller.signal.throwIfAborted();
    const phase=String(p.phase||'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);
    const source=['PRICAT1','PRICAT2'].includes(p.source)?p.source:'PAIR';
    const counters=Object.fromEntries(['records','rows','bytes','updatedRecords'].filter(k=>Number.isSafeInteger(p[k])&&p[k]>=0).map(k=>[k,p[k]]));
    const next=JSON.stringify([phase,source,counters]);
    if(next!==signature){signature=next;last=performance.now();}
    if(last-lastEmit>=1000||phase==='snapshot'||phase==='snapshot-validated'){
      lastEmit=last;emit({status:'PROGRESS',phase,source,...counters,at:new Date().toISOString()});
    }
  };
  const timer=setInterval(()=>{
    const now=performance.now();
    if(now-started>limits.maxRunMs)stop('JOB_DEADLINE');
    else if(now-last>limits.stallMs)stop('NO_PROGRESS');
  },tickMs);
  emit({status:'STARTED',at:new Date().toISOString()});
  try {const result=await work({signal:controller.signal,onProgress:progress});controller.signal.throwIfAborted();return result;}
  finally {clearInterval(timer);clearTimeout(forceTimer);process.off('SIGTERM',term);process.off('SIGINT',term);}
}
async function main(){
  const {sync}=require('./sync.cjs'),{privateJson}=require('./update.cjs');
  process.umask(0o077);
  const a=process.argv.slice(2);
  if(![4,6].includes(a.length)||a[0]!=='--config'||a[2]!=='--mode'||!['check','publish'].includes(a[3])||a.length===6&&(a[4]!=='--reprocess'||a[5]!=='true'))throw Error('USAGE_CONFIG_MODE');
  const config=await privateJson(a[1]);
  const result=await supervise(options=>sync({config,mode:a[3],reprocess:a.length===6,...options,event:v=>{
    if(v.status!=='PROGRESS')console.log(JSON.stringify(v));
  }}),config.runtimeLimits);
  console.log(JSON.stringify({status:result.status,snapshotId:result.snapshotId,count:result.count}));
}
if(require.main===module)main().catch(e=>{const code=safeCode(e);console.error(JSON.stringify({status:'STOPPED',code}));process.exitCode=code==='JOB_SIGTERM'?143:1;});
module.exports={supervise,safeCode};

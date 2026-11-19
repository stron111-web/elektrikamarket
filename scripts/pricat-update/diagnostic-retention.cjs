'use strict';
// Filesystem maintenance only. Never opens a database or contacts the supplier.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path');
const {createHash,randomUUID}=require('node:crypto'),readline=require('node:readline');
const reports=['dry-issues.ndjson','publish-issues.ndjson'];
const temporaryInputs=['PRICAT1.zip','PRICAT1.xml','PRICAT2.zip','PRICAT2.xml'];
const runName=/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/;
const guard=ok=>{if(!ok)throw Object.assign(new Error('DIAGNOSTIC_RETENTION_REQUIRES_REVIEW'),{code:'DIAGNOSTIC_RETENTION_REQUIRES_REVIEW'});};
async function stat(p){return fsp.lstat(p).catch(e=>{if(e.code==='ENOENT')return null;throw e;});}
async function directory(p){const s=await fsp.lstat(p);guard(s.isDirectory()&&!s.isSymbolicLink()&&await fsp.realpath(p)===p);}
async function regular(p){const s=await fsp.lstat(p);guard(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);return s;}
async function read(p){await regular(p);return JSON.parse(await fsp.readFile(p,'utf8'));}
async function atomic(p,value){
 if(await stat(p))await regular(p);
 const tmp=p+'.'+randomUUID()+'.tmp';let h;
 try{h=await fsp.open(tmp,'wx',0o600);await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();await h.close();h=null;await fsp.rename(tmp,p);
  if(process.platform!=='win32'){const d=await fsp.open(path.dirname(p),'r');try{await d.sync();}finally{await d.close();}}
 }finally{if(h)await h.close();await fsp.unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function blocked(root){return !!(await stat(path.join(root,'needs-review.json'))||await stat(path.join(root,'ftp','needs-review.json')));}
async function completed(root,dir){
 guard(path.isAbsolute(root)&&path.isAbsolute(dir)&&path.dirname(dir)===path.join(root,'runs')&&runName.test(path.basename(dir)));
 await directory(root);await directory(path.join(root,'runs'));await directory(dir);
 const r=await read(path.join(dir,'result.json'));
 guard(['SUCCEEDED','UNCHANGED','CHECKED','FAILED'].includes(r.status)&&!(r.status==='FAILED'&&r.commitAcknowledged));
 return r;
}
async function summarize(file){
 const before=await regular(file),hash=createHash('sha256'),counts=new Map();let records=0;
 const input=fs.createReadStream(file);input.on('data',b=>hash.update(b));
 const lines=readline.createInterface({input,crlfDelay:Infinity});
 try{for await(const line of lines){
  if(!line.trim())continue;
  const r=JSON.parse(line);guard(['PRICAT1','PRICAT2'].includes(r.source)&&['WARNING','ERROR'].includes(r.severity)&&/^[A-Z][A-Z0-9_]{0,80}$/.test(r.code));
  const key=[r.source,r.severity,r.code].join(':');counts.set(key,(counts.get(key)||0)+1);records++;
 }}finally{lines.close();input.destroy();}
 const after=await regular(file);guard(before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs);
 return {name:path.basename(file),sha256:hash.digest('hex'),bytes:before.size,records,counts:[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([key,count])=>{const [source,severity,code]=key.split(':');return {source,severity,code,count};}),stat:before};
}
async function summarizeInput(file){
 const before=await regular(file),hash=createHash('sha256');
 for await(const bytes of fs.createReadStream(file))hash.update(bytes);
 const after=await regular(file);guard(before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs);
 return {name:path.basename(file),sha256:hash.digest('hex'),bytes:before.size,stat:before};
}
async function compactDiagnostics(root,dir){
 if(await blocked(root))return {blocked:true};
 const result=await completed(root,dir),file=path.join(dir,'diagnostics-summary.json');
 const previous=await stat(file)?await read(file):{version:1,reports:[]};guard(previous.version===1&&Array.isArray(previous.reports));
 const pending=[],inputs=[];
 // Validate and summarize BOTH files before the first unlink.
 for(const name of reports)if(await stat(path.join(dir,name)))pending.push(await summarize(path.join(dir,name)));
 for(const name of temporaryInputs)if(await stat(path.join(dir,name)))inputs.push(await summarizeInput(path.join(dir,name)));
 if(!pending.length&&!inputs.length)return {removed:0};
 const summaries=new Map(previous.reports.map(v=>[v.name,v]));
 for(const {stat:ignored,...v}of pending)summaries.set(v.name,v);
 guard(previous.inputs===undefined||Array.isArray(previous.inputs));
 const inputSummaries=new Map((previous.inputs||[]).map(v=>[v.name,v]));
 for(const {stat:ignored,...v}of inputs)inputSummaries.set(v.name,v);
 await atomic(file,{version:1,status:result.status,pairId:result.pairId??null,reports:[...summaries.values()],inputs:[...inputSummaries.values()]});
 for(const v of [...pending,...inputs]){const p=path.join(dir,v.name),s=await regular(p);guard(s.ino===v.stat.ino&&s.size===v.stat.size&&s.mtimeMs===v.stat.mtimeMs);await fsp.unlink(p);}
 return {removed:pending.length+inputs.length,bytes:[...pending,...inputs].reduce((n,v)=>n+v.bytes,0)};
}
async function drain(root,state,event){
 const file=path.join(root,'diagnostic-retention.json');
 for(const dir of [...state.pending]){
  const result=await compactDiagnostics(root,dir);if(result.blocked)return {blocked:true};
  state.pending=state.pending.filter(d=>d!==dir);await atomic(file,state);
  event({status:'DIAGNOSTICS_COMPACTED',directory:path.basename(dir),...result});
 }
 return {retainedRuns:state.keep.length,pending:0};
}
async function rotateDiagnostics(root,dir,event=()=>{}){
 if(await blocked(root))return {blocked:true};
 await completed(root,dir);
 const file=path.join(root,'diagnostic-retention.json'),state=await stat(file)?await read(file):{version:1,keep:[],pending:[]};
 guard(state.version===1&&Array.isArray(state.keep)&&state.keep.length<=2&&Array.isArray(state.pending));
 for(const p of [...state.keep,...state.pending])await completed(root,p);
 const all=[...state.keep.filter(p=>p!==dir),dir];state.keep=all.slice(-2);
 state.pending=[...new Set([...state.pending,...all.slice(0,-2)])].filter(p=>!state.keep.includes(p));
 // Durable pending list makes a crash between summary/unlink/index updates retryable.
 await atomic(file,state);return drain(root,state,event);
}
async function adoptDiagnostics(root,dirs,event=()=>{}){
 // Explicit one-time reviewed list only; never auto-discover historical directories.
 if(await blocked(root))return {blocked:true};
 guard(Array.isArray(dirs)&&new Set(dirs).size===dirs.length&&!(await stat(path.join(root,'diagnostic-retention.json'))));
 for(const dir of dirs)await completed(root,dir);
 const ordered=[...dirs].sort(),state={version:1,keep:ordered.slice(-2),pending:ordered.slice(0,-2)};
 await atomic(path.join(root,'diagnostic-retention.json'),state);return drain(root,state,event);
}
module.exports={rotateDiagnostics,adoptDiagnostics,compactDiagnostics};

'use strict';
// Only this release's explicit receipts confer cleanup ownership. Never sweep legacy inputs.
const fs=require('node:fs/promises'),path=require('node:path');
const {json,privateJson,GateError,hash}=require('../pricat-update/update.cjs');
const receipt='.prodat-owned.json',zip=/^PRODAT_369147_\d{1,20}\.zip$/i;
const candidate=/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/;
const guard=(ok)=>{if(!ok)throw new GateError('CLEANUP_SCOPE_REQUIRES_REVIEW');};
async function directory(p){const s=await fs.lstat(p);guard(s.isDirectory()&&!s.isSymbolicLink()&&await fs.realpath(p)===path.resolve(p));}
async function own(config,dir,names){
 guard(names.length===2&&new Set(names).size===2&&names.every(n=>zip.test(n)));
 guard(path.dirname(dir)===path.join(config.stateDirectory,'candidates')&&candidate.test(path.basename(dir)));
 await directory(config.stateDirectory);await directory(path.dirname(dir));await directory(dir);
 await json(path.join(dir,receipt),{version:1,token:path.basename(dir).slice(-36),names});
}
async function clean(config,event=()=>{}){
 await directory(config.stateDirectory);
 if(await fs.lstat(path.join(config.stateDirectory,'needs-review.json')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))return {removed:0,blocked:true};
 const stateFile=path.join(config.stateDirectory,'source-state.json');
 const state=await privateJson(stateFile).catch(e=>{if(e.code==='ENOENT')return {};throw e;});
 // Recover an acknowledged COMMIT whose subsequent retention bookkeeping crashed.
 const published=await privateJson(path.join(config.stateDirectory,'last-publication.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(published?.status==='SUCCEEDED'&&state.currentCandidate?.verified&&JSON.stringify(state.currentCandidate.files.map(f=>f.sha256))===JSON.stringify(published.sourceHashes)&&JSON.stringify(state.acceptedCandidates?.[0]?.sourceHashes)!==JSON.stringify(published.sourceHashes)){
  remember(state,published.sourceHashes);await json(stateFile,state);
 }
 const keep=new Set([state.currentCandidate?.directory,state.previousVerifiedCandidate?.directory,...(state.acceptedCandidates||[]).map(c=>c.directory)].filter(Boolean).map(p=>path.resolve(p)));
 const root=path.join(config.stateDirectory,'candidates');
 try{await directory(config.stateDirectory);await directory(root);}catch(e){if(e.code==='ENOENT')return {removed:0};throw e;}
 let removed=0,bytes=0;
 for(const name of await fs.readdir(root)){
  if(!candidate.test(name))continue;
  const dir=path.join(root,name);if(keep.has(path.resolve(dir)))continue;
  const info=await fs.lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())continue;
  const marker=path.join(dir,receipt);let r;
  try{r=await privateJson(marker);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  guard(r.version===1&&r.token===name.slice(-36)&&r.names?.length===2&&new Set(r.names).size===2&&r.names.every(n=>zip.test(n)));
  const allowed=new Set([receipt,...r.names,...r.names.map(n=>n+'.part')]);
  // Validate every child before the first unlink. Unknown files/symlinks stop cleanup.
  const children=await fs.readdir(dir),stats=[];
  for(const n of children){guard(allowed.has(n));const s=await fs.lstat(path.join(dir,n));guard(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);stats.push([n,s]);}
  for(const [n,s]of stats)if(n!==receipt){await fs.unlink(path.join(dir,n));bytes+=s.size;}
  await fs.unlink(marker);await fs.rmdir(dir);removed++;
 }
 if(removed)event({status:'TEMPORARY_INPUTS_CLEANED',directories:removed,bytes});
 return {removed,bytes};
}
async function acknowledged(config,result,event=()=>{}){
 guard(['SUCCEEDED','UNCHANGED'].includes(result.status));
 const file=path.join(config.stateDirectory,'source-state.json'),state=await privateJson(file),c=state.currentCandidate;
 guard(c?.verified===true&&JSON.stringify(c.files.map(f=>f.sha256))===JSON.stringify(result.sourceHashes));
 remember(state,result.sourceHashes);
 await json(file,state);return clean(config,event);
}
function remember(state,sourceHashes){const c=state.currentCandidate,accepted={directory:c.directory,files:c.files,sourceHashes};state.acceptedCandidates=[accepted,...(state.acceptedCandidates||[]).filter(v=>JSON.stringify(v.sourceHashes)!==JSON.stringify(sourceHashes))].slice(0,2);}
async function adoptAcceptedPairs(config,pairs){
 // Installer-only operation, under the existing locks and an explicit migration
 // marker. The caller must first match BOTH pairs to successful DB import_files.
 // Move a legacy bootstrap pair into candidates BEFORE calling this function;
 // leave this marker in place after any failure. No database or FTP access here.
 guard(pairs?.length===2&&new Set(pairs.map(p=>p.directory)).size===2);
 const marker=await privateJson(path.join(config.stateDirectory,'needs-review.json'));
 guard(marker.phase==='RETENTION_MIGRATION');
 const stateFile=path.join(config.stateDirectory,'source-state.json'),state=await privateJson(stateFile);
 const published=await privateJson(path.join(config.stateDirectory,'last-publication.json'));
 guard(published.status==='SUCCEEDED'&&published.prodat?.runId===pairs[0].acceptedRunId);
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 guard(same(state.currentCandidate?.files.map(f=>f.sha256),pairs[0].sourceHashes)&&same(published.sourceHashes,pairs[0].sourceHashes));
 guard(Number.isInteger(pairs[1].acceptedRunId)&&pairs[1].acceptedRunId>0&&pairs[1].acceptedRunId<pairs[0].acceptedRunId&&!same(pairs[0].sourceHashes,pairs[1].sourceHashes));
 // Validate every directory and every SHA before claiming ownership or updating state.
 for(const pair of pairs){
  guard(path.dirname(pair.directory)===path.join(config.stateDirectory,'candidates')&&candidate.test(path.basename(pair.directory)));
  await directory(config.stateDirectory);await directory(path.dirname(pair.directory));await directory(pair.directory);
  guard(pair.files?.length===2&&new Set(pair.files.map(f=>f.name)).size===2&&same(pair.sourceHashes,pair.files.map(f=>f.sha256)));
  const allowed=new Set([receipt,...pair.files.map(f=>f.name)]);
  for(const name of await fs.readdir(pair.directory))guard(allowed.has(name));
  for(const f of pair.files){
   guard(zip.test(f.name)&&f.path===path.join(pair.directory,f.name)&&/^[a-f0-9]{64}$/.test(f.sha256));
   const s=await fs.lstat(f.path);guard(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&await hash(f.path)===f.sha256);
  }
 }
 for(const pair of pairs)await own(config,pair.directory,pair.files.map(f=>f.name));
 state.acceptedCandidates=pairs.map(({directory,files,sourceHashes,acceptedRunId})=>({directory,files,sourceHashes,acceptedRunId}));
 await json(stateFile,state);return {adoptedPairs:2,markerRetained:true};
}
module.exports={own,clean,acknowledged,adoptAcceptedPairs};

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {own,clean,acknowledged}=require('./cleanup.cjs');
const names=['PRODAT_369147_1.zip','PRODAT_369147_2.zip'];
async function temporary(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'prodat-clean-'));const c={stateDirectory:root};try{await fs.mkdir(path.join(root,'candidates'),{mode:0o700});await fn(c);}finally{await fs.rm(root,{recursive:true,force:true});}}
async function save(c,s){await fs.writeFile(path.join(c.stateDirectory,'source-state.json'),JSON.stringify(s),{mode:0o600});}
async function create(c,n,owned=true){const dir=path.join(c.stateDirectory,'candidates','2026-11-18T20-00-00-000Z-'+randomUUID());await fs.mkdir(dir,{mode:0o700});if(owned)await own(c,dir,names);const files=[];for(const [i,name]of names.entries()){const p=path.join(dir,name);await fs.writeFile(p,'zip-'+n,{mode:0o600});files.push({name,path:p,sha256:(String(n)+String(i)).padEnd(64,'0')});}return {directory:dir,files,verified:true};}
const exists=p=>fs.stat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
test('cleanup removes only owned unreferenced inputs; retains legacy/current/accepted pairs',()=>temporary(async c=>{
 const legacy=await create(c,1,false),accepted=await create(c,2),current=await create(c,3),unused=await create(c,4);
 await save(c,{currentCandidate:current,acceptedCandidates:[accepted]});assert.equal((await clean(c)).removed,1);
 assert.equal(await exists(unused.directory),false);for(const v of [legacy,accepted,current])assert.equal(await exists(v.files[0].path),true);
 assert.equal((await clean(c)).removed,0);
}));
test('acknowledged publication retains two accepted pairs and a repeat does not duplicate retention',()=>temporary(async c=>{
 let state={};const sets=[];
 for(let n=1;n<=3;n++){const v=await create(c,n);sets.push(v);state.currentCandidate=v;await save(c,state);await acknowledged(c,{status:'SUCCEEDED',sourceHashes:v.files.map(f=>f.sha256)});state=JSON.parse(await fs.readFile(path.join(c.stateDirectory,'source-state.json')));}
 assert.equal(state.acceptedCandidates.length,2);assert.equal(await exists(sets[0].directory),false);for(const v of sets.slice(1))assert.equal(await exists(v.directory),true);
 await acknowledged(c,{status:'UNCHANGED',sourceHashes:sets[2].files.map(f=>f.sha256)});assert.equal(JSON.parse(await fs.readFile(path.join(c.stateDirectory,'source-state.json'))).acceptedCandidates.length,2);
}));
test('COMMIT followed by a bookkeeping crash is adopted before old candidate cleanup',()=>temporary(async c=>{
 const a=await create(c,1);await save(c,{currentCandidate:a});await fs.writeFile(path.join(c.stateDirectory,'last-publication.json'),JSON.stringify({status:'SUCCEEDED',sourceHashes:a.files.map(f=>f.sha256)}),{mode:0o600});await clean(c);
 const state=JSON.parse(await fs.readFile(path.join(c.stateDirectory,'source-state.json')));state.currentCandidate=await create(c,2);await save(c,state);await clean(c);assert.equal(await exists(a.directory),true);assert.equal(state.acceptedCandidates.length,1);
}));
test('publication uncertainty preserves all inputs; a failed acknowledgement cannot delete',()=>temporary(async c=>{
 const a=await create(c,1);await save(c,{currentCandidate:a});await assert.rejects(acknowledged(c,{status:'FAILED',sourceHashes:[]}));
 const b=await create(c,2);await fs.writeFile(path.join(c.stateDirectory,'needs-review.json'),'{}',{mode:0o600});assert.equal((await clean(c)).blocked,true);assert.equal(await exists(b.directory),true);
}));
test('unexpected children stop deletion before any input is removed',()=>temporary(async c=>{
 const a=await create(c,1);await fs.writeFile(path.join(a.directory,'keep.txt'),'x');await assert.rejects(clean(c),e=>e.code==='CLEANUP_SCOPE_REQUIRES_REVIEW');for(const f of a.files)assert.equal(await exists(f.path),true);
}));
test('partial downloads created by this release are cleaned after a failed transfer',()=>temporary(async c=>{
 const a=await create(c,1);await fs.writeFile(a.files[0].path+'.part','incomplete');assert.equal((await clean(c)).removed,1);assert.equal(await exists(a.directory),false);
}));
test('malformed receipt and path escape are rejected',()=>temporary(async c=>{
 await assert.rejects(own(c,c.stateDirectory,names));const a=await create(c,1);await fs.writeFile(path.join(a.directory,'.prodat-owned.json'),JSON.stringify({version:1,token:'wrong',names}),{mode:0o600});await assert.rejects(clean(c));assert.equal(await exists(a.files[0].path),true);
}));

test('symlink children cannot redirect cleanup outside its owned directory',{skip:process.platform==='win32'},()=>temporary(async c=>{
 const a=await create(c,1),outside=path.join(c.stateDirectory,'outside.zip');await fs.writeFile(outside,'keep');await fs.unlink(a.files[0].path);await fs.symlink(outside,a.files[0].path);
 await assert.rejects(clean(c));assert.equal(await fs.readFile(outside,'utf8'),'keep');assert.equal(await exists(a.files[1].path),true);
}));

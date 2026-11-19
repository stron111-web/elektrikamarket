'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {rotateDiagnostics,adoptDiagnostics,compactDiagnostics}=require('./diagnostic-retention.cjs');
const row={source:'PRICAT1',severity:'ERROR',code:'CONFLICTING_DUPLICATE',supplierCode:'fixture-only',details:{raw:'must not enter compact metadata'}};
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'pricat-retain-'));try{await fs.mkdir(path.join(root,'runs'));await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
async function put(p,v){await fs.writeFile(p,JSON.stringify(v),{mode:0o600});}
async function create(root,n,status='SUCCEEDED'){
 const dir=path.join(root,'runs',`2026-11-18T20-${String(n).padStart(2,'0')}-00-000Z-`+randomUUID());await fs.mkdir(dir);
 await put(path.join(dir,'result.json'),{status,commitAcknowledged:status==='SUCCEEDED',pairId:'pair-'+n});
 await put(path.join(dir,'verified.json'),{keep:'source hashes'});await put(path.join(dir,'dry-summary.json'),{errorCount:2});
 await fs.writeFile(path.join(dir,'dry-issues.ndjson'),JSON.stringify(row)+'\n'+JSON.stringify(row)+'\n');
 await fs.writeFile(path.join(dir,'publish-issues.ndjson'),JSON.stringify({...row,severity:'WARNING',code:'PROTECTIVE_PRICE'})+'\n');return dir;
}
const exists=p=>fs.stat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
test('bounds successful and failed raw diagnostics to two terminal runs; retains metadata and compact counts',()=>fixture(async root=>{
 const dirs=[];
 for(let n=1;n<=4;n++){const d=await create(root,n,n%2?'SUCCEEDED':'FAILED');dirs.push(d);await rotateDiagnostics(root,d);}
 for(const d of dirs.slice(0,2)){
  assert.equal(await exists(path.join(d,'dry-issues.ndjson')),false);
  const s=JSON.parse(await fs.readFile(path.join(d,'diagnostics-summary.json')));assert.equal(s.reports[0].records,2);assert.equal(s.reports[0].counts[0].count,2);assert.match(s.reports[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(s).includes('fixture-only'),false);assert.equal(await exists(path.join(d,'verified.json')),true);
 }
 for(const d of dirs.slice(-2))assert.equal(await exists(path.join(d,'dry-issues.ndjson')),true);
 const state=JSON.parse(await fs.readFile(path.join(root,'diagnostic-retention.json')));assert.deepEqual(state.keep,dirs.slice(-2));assert.deepEqual(state.pending,[]);
 await rotateDiagnostics(root,dirs[3]);assert.equal((await fs.readdir(path.join(root,'runs'))).length,4);
}));
test('retries durable pending cleanup after a crash without losing an already written summary',()=>fixture(async root=>{
 const a=await create(root,1),b=await create(root,2),c=await create(root,3);
 await put(path.join(root,'diagnostic-retention.json'),{version:1,keep:[b,c],pending:[a]});
 await compactDiagnostics(root,a);const summary=await fs.readFile(path.join(a,'diagnostics-summary.json'),'utf8');
 await rotateDiagnostics(root,c);assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'diagnostic-retention.json'))).pending,[]);assert.equal(await fs.readFile(path.join(a,'diagnostics-summary.json'),'utf8'),summary);
}));
test('either review marker blocks all retention writes and deletion',()=>fixture(async root=>{
 const a=await create(root,1);await fs.mkdir(path.join(root,'ftp'));
 for(const marker of [path.join(root,'needs-review.json'),path.join(root,'ftp','needs-review.json')]){
  await put(marker,{});assert.deepEqual(await rotateDiagnostics(root,a),{blocked:true});assert.equal(await exists(path.join(root,'diagnostic-retention.json')),false);await fs.unlink(marker);
 }
 assert.equal(await exists(path.join(a,'dry-issues.ndjson')),true);
}));
test('an uncertain COMMIT cannot be treated as a completed failure',()=>fixture(async root=>{
 const a=await create(root,1,'NEEDS_REVIEW');await assert.rejects(rotateDiagnostics(root,a));
 await put(path.join(a,'result.json'),{status:'FAILED',commitAcknowledged:true});await assert.rejects(compactDiagnostics(root,a));assert.equal(await exists(path.join(a,'dry-issues.ndjson')),true);
}));
test('malformed second report preserves both original reports and creates no summary',()=>fixture(async root=>{
 const a=await create(root,1);await fs.writeFile(path.join(a,'publish-issues.ndjson'),'broken-json\n');await assert.rejects(compactDiagnostics(root,a));
 assert.equal(await exists(path.join(a,'dry-issues.ndjson')),true);assert.equal(await exists(path.join(a,'publish-issues.ndjson')),true);assert.equal(await exists(path.join(a,'diagnostics-summary.json')),false);
}));
test('rejects path escapes and forged registry paths before touching files',()=>fixture(async root=>{
 const a=await create(root,1);await assert.rejects(rotateDiagnostics(root,path.dirname(root)));
 await put(path.join(root,'diagnostic-retention.json'),{version:1,keep:[path.dirname(root)],pending:[]});await assert.rejects(rotateDiagnostics(root,a));assert.equal(await exists(path.join(a,'dry-issues.ndjson')),true);
}));
test('explicit adoption compacts reviewed historical runs and leaves unknown legacy directories alone',()=>fixture(async root=>{
 const a=await create(root,1),b=await create(root,2),c=await create(root,3),unknown=await create(root,4);
 await adoptDiagnostics(root,[c,a,b]);assert.equal(await exists(path.join(a,'dry-issues.ndjson')),false);assert.equal(await exists(path.join(unknown,'dry-issues.ndjson')),true);
 await assert.rejects(adoptDiagnostics(root,[a,b,c]));
}));
test('hardlinked reports cannot cause deletion of shared evidence',()=>fixture(async root=>{
 const a=await create(root,1);await fs.link(path.join(a,'publish-issues.ndjson'),path.join(root,'keep.ndjson'));await assert.rejects(compactDiagnostics(root,a));
 assert.equal(await exists(path.join(a,'dry-issues.ndjson')),true);assert.equal(await exists(path.join(root,'keep.ndjson')),true);
}));
test('symbolic links cannot redirect cleanup',{skip:process.platform==='win32'},()=>fixture(async root=>{
 const a=await create(root,1);await fs.unlink(path.join(a,'publish-issues.ndjson'));await fs.writeFile(path.join(root,'keep.ndjson'),JSON.stringify(row));await fs.symlink(path.join(root,'keep.ndjson'),path.join(a,'publish-issues.ndjson'));
 await assert.rejects(compactDiagnostics(root,a));assert.equal(await exists(path.join(a,'dry-issues.ndjson')),true);assert.equal(await exists(path.join(root,'keep.ndjson')),true);
}));

test('bounds failed temporary inputs without touching accepted source cache or metadata',()=>fixture(async root=>{
 const a=await create(root,1,'FAILED'),b=await create(root,2),c=await create(root,3);
 await fs.writeFile(path.join(a,'PRICAT1.zip'),'rejected-source');
 await fs.mkdir(path.join(root,'ftp'));await fs.writeFile(path.join(root,'ftp','accepted.zip'),'accepted-source');
 await adoptDiagnostics(root,[a,b,c]);
 assert.equal(await exists(path.join(a,'PRICAT1.zip')),false);
 assert.equal(await fs.readFile(path.join(root,'ftp','accepted.zip'),'utf8'),'accepted-source');
 const summary=JSON.parse(await fs.readFile(path.join(a,'diagnostics-summary.json')));
 assert.equal(summary.inputs[0].bytes,15);assert.match(summary.inputs[0].sha256,/^[a-f0-9]{64}$/);
 assert.equal(await exists(path.join(a,'verified.json')),true);
}));

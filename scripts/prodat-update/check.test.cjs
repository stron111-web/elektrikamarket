'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {discover,validate,check,readStatus}=require('./check.cjs');
const base={version:1,mode:'discovery-only',stateDirectory:'/state',credentialsFile:'/run/ftp/credentials.json',host:'service.russvet.ru',port:21021,allowPlaintextForRussvet:true,maxDirectories:50,maxDepth:4,maxEntries:10000,timeoutMs:30000,totalTimeoutMs:180000};
const directory=name=>({name,isDirectory:true}),file=(name,size=100)=>({name,isFile:true,size});
test('plain FTP is pinned; publication, other endpoints and unbounded scans are rejected',()=>{
 for(const extra of [{mode:'publish'},{host:'other.example'},{port:21},{allowPlaintextForRussvet:false},{maxDirectories:101},{maxDepth:0},{totalTimeoutMs:0},{credentialsFile:'relative'}])assert.throws(()=>validate({...base,...extra}));
 assert.doesNotThrow(()=>validate(base));
});
test('discovers real directory tree without guessing PRODAT paths; PRICAT is not a PRODAT source',async()=>{
 const calls=[],tree={'/':[directory('pricat')],'/pricat/':[directory('TVER'),file('PRICAT_891661.zip')],'/pricat/TVER/':[file('PRICAT_891661.xml')]};
 const r=await discover({list:async p=>{calls.push(p);assert.ok(tree[p]);return tree[p];}},base);
 assert.equal(r.status,'SOURCE_UNAVAILABLE');assert.equal(r.filesSeen,2);assert.deepEqual(calls,Object.keys(tree));assert.deepEqual(r.prodat,[]);
});
test('files appearing in an unexpected actual directory require a completeness contract, never auto-import',async()=>{
 const tree={'/':[directory('catalogue')],'/catalogue/':[file('PRODAT_123_456.zip'),file('PRODAT_123_457.zip')]};
 const r=await discover({list:async p=>tree[p]},base);assert.equal(r.status,'SOURCE_CONTRACT_REQUIRED');assert.equal(r.prodat.length,2);assert.ok(r.prodat.every(f=>f.directory==='/catalogue/'));
});
test('partial traversal and symbolic links cannot falsely prove absence or completeness',async()=>{
 const linked=await discover({list:async()=>[{name:'linked',isSymbolicLink:true}]},base);assert.equal(linked.status,'DISCOVERY_INCOMPLETE');
 const deep=await discover({list:async()=>[directory('more')]},{...base,maxDepth:1});assert.equal(deep.status,'DISCOVERY_INCOMPLETE');
 await assert.rejects(discover({list:async()=>[directory('more')]},{...base,maxDirectories:1}),e=>e.code==='DIRECTORY_LIMIT');
 await assert.rejects(discover({list:async()=>[file('a'),file('b')]},{...base,maxEntries:1}),e=>e.code==='ENTRY_LIMIT');
 for(const name of ['..','bad/name','bad\\name','bad\nname'])await assert.rejects(discover({list:async()=>[file(name)]},base),e=>e.code==='UNSAFE_REMOTE_NAME');
});
test('daily checks persist safe status, never download or import, and redact transport errors',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prodat-check-'));
 try{
  const config={...base,stateDirectory:dir,credentialsFile:path.join(dir,'auth.json')};await fs.writeFile(config.credentialsFile,JSON.stringify({username:'fixture-login',password:'fixture-secret'}),{mode:0o600});
  assert.equal((await readStatus(config)).status,'NEVER_CHECKED');
  let closes=0,downloads=0;const fake=()=>({ftp:{},access:async opts=>{assert.equal(opts.secure,false);assert.equal(opts.host,base.host);},list:async()=>[],downloadTo:()=>{downloads++;throw new Error('must never download');},close:()=>closes++});
  for(let i=0;i<2;i++){const r=await check(config,{clientFactory:fake});assert.equal(r.publicationEnabled,false);assert.equal(r.status,'SOURCE_UNAVAILABLE');assert.equal(r.lastImport,null);assert.equal(r.lastDownload,null);}
  assert.equal(downloads,0);assert.equal(closes,2);
  const failed=await check(config,{clientFactory:()=>({ftp:{},access:async()=>{throw new Error('fixture-secret postgres://password');},close:()=>{}})});
  assert.equal(failed.errorCode,'FTP_DISCOVERY_FAILED');
  for(const file of ['events.ndjson','status.json']){const text=await fs.readFile(path.join(dir,file),'utf8');assert.ok(!text.includes('fixture-secret'));assert.ok(!text.includes('postgres://'));}
  assert.equal((await readStatus(config)).status,'CHECK_FAILED');
  await fs.mkdir(path.join(dir,'check.lock'));
  await assert.rejects(check(config,{clientFactory:fake}),e=>e.code==='CHECK_ALREADY_RUNNING');await fs.rmdir(path.join(dir,'check.lock'));
  await fs.writeFile(config.credentialsFile,JSON.stringify({username:'bad\nuser',password:'x'}),{mode:0o600});assert.equal((await check(config,{clientFactory:fake})).errorCode,'CREDENTIAL_FORMAT');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

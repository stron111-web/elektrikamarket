'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{randomBytes,createHash}=require('node:crypto'),postgres=require('postgres'),AdmZip=require('adm-zip');
const {FtpsSource,choose,SOURCES,configuration}=require('./ftps.cjs'),{sync,remoteDates}=require('./sync.cjs'),{fixture}=require('./ftps-fixture.cjs');
const {importPricat}=require('../import/pricat-import.cjs');
const now=Date.now(),stamp=ms=>new Date(ms).toISOString().replace(/\D/g,'').slice(0,14),date=n=>stamp(now-4*3600000+n*600000),modified=stamp(now-600000);
const limits={maxAgeHours:72,maxPairSkewHours:24,maxManifestAgeHours:2,maxFutureMinutes:5,minSourceRecords:10,maxFileBytes:1000000,maxXmlBytes:1000000,minFreeBytes:1000000,downloadTimeoutMs:3000,maxSourceDropFraction:.2,maxIssueFraction:.2,maxMissingFraction:0,maxRemovedFraction:.2,maxChangedPriceFraction:.3,maxStockCellLossFraction:.2,maxPriceChangeFactor:2,maxQuantityChangeFactor:2};
const sha=b=>createHash('sha256').update(b).digest('hex');
const put=(f,b)=>fs.writeFile(f,b,{mode:0o600});
function payload(s,n,{qty='5',price='150'}={}){
 const number='891661_'+s.code+'_'+date(n),name='PRICAT_'+number+'.'+s.format;
 const body=Buffer.from('<Document><DocType>PRICAT</DocType><Currency>RUB</Currency><DocumentNumber>'+number+'</DocumentNumber><DocumentDate>'+date(n)+'</DocumentDate>'+Array.from({length:10},(_,i)=>'<DocDetail><SenderPrdCode>p'+i+'</SenderPrdCode><UOM>'+(i===1?'NMP':'PCE')+'</UOM><ItemsPerUnit>'+(i===1?'20':'1')+'</ItemsPerUnit><Multiplicity>1</Multiplicity><QTY>'+qty+'</QTY><RetailPrice>'+price+'</RetailPrice><RetailCurrency>RUB</RetailCurrency><Price2>100</Price2><SupOnhandDetail><PartnerQTY>'+qty+'</PartnerQTY><PartnerUOM>'+(i===1?'NMP':'PCE')+'</PartnerUOM></SupOnhandDetail></DocDetail>').join('')+'</Document>');
 if(s.format==='xml')return {name,body,modified,number,date:date(n)};
 const z=new AdmZip();z.addFile(name.replace(/\.zip$/,'.xml'),body);return {name,body:z.toBuffer(),modified,number,date:date(n)};
}
async function setup(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pricat-ftps-')),key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');
 const r=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',key,'-out',cert,'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});assert.equal(r.status,0);
 const credentials=path.join(dir,'ftp.json');await put(credentials,JSON.stringify({username:'fixture-user',password:'fixture-only-not-a-real-credential'}));
 const options={key:await fs.readFile(key),cert:await fs.readFile(cert)};
 return {dir,options,config:port=>({host:'localhost',port,secure:true,credentialsFile:credentials,customerCode:'891661',settleSeconds:0,caFile:cert})};
}
test('source discovery pins customer/code/format; ambiguous newest and plaintext are refused',()=>{
 const entries=[{name:'PRICAT_891661_2610_'+date(0)+'.zip',isFile:true},{name:'PRICAT_891661_2610_'+date(1)+'.zip',isFile:true},{name:'PRICAT_000000_2610_'+date(2)+'.zip',isFile:true}];
 assert.equal(choose(entries,SOURCES[0],'891661').date,date(1));
 assert.throws(()=>choose([...entries,entries[1]],SOURCES[0],'891661'),e=>e.code==='FTP_AMBIGUOUS_NEWEST');
 assert.throws(()=>new FtpsSource({host:'localhost',port:21,credentialsFile:'/fixture/credentials',customerCode:'891661',settleSeconds:0,secure:false},limits),e=>e.code==='FTP_PLAINTEXT_NOT_ALLOWED');
});
test('plaintext requires explicit consent AND exact Russvet hostname/port; other hosts default to TLS',()=>{
 const c={host:'service.russvet.ru',port:21021,credentialsFile:'/fixture/credentials',customerCode:'891661',settleSeconds:0};
 assert.equal(configuration(c),true);
 assert.equal(configuration({...c,secure:true,allowPlaintextForRussvet:true}),true);
 assert.equal(configuration({...c,secure:false,allowPlaintextForRussvet:true}),false);
 for(const patch of [{},{allowPlaintextForRussvet:false},{allowPlaintextForRussvet:true,host:'other.example'},{allowPlaintextForRussvet:true,host:'127.0.0.1'},{allowPlaintextForRussvet:true,port:21}])
  assert.throws(()=>configuration({...c,secure:false,...patch}),e=>e.code==='FTP_PLAINTEXT_NOT_ALLOWED');
 assert.throws(()=>configuration({...c,secure:'false',allowPlaintextForRussvet:true}),e=>e.code==='FTPS_REQUIRED');
});
test('timestamp freshness/skew checks apply even when remote metadata is unchanged',()=>{
 assert.doesNotThrow(()=>remoteDates([{date:date(0)},{date:date(1)}],limits,now));
 for(const date of ['20200101000000','20260231000000',stamp(now+3600000)])assert.throws(()=>remoteDates([{date},{date:stamp(now)}],limits,now),e=>e.code==='FTP_SOURCE_DATE');
 assert.throws(()=>remoteDates([{date:stamp(now-48*3600000)},{date:stamp(now)}],limits,now),e=>e.code==='PAIR_DATE_SKEW');
});
test('owner-approved ordinary FTP uses passive data on pinned endpoint; login errors propagate',async()=>{
 const s=await setup(),dns=require('node:dns'),lookup=dns.lookup;let server,client;
 try{
  // Test-only DNS hook. No request leaves this isolated test container.
  dns.lookup=function(host,options,callback){if(host!=='service.russvet.ru')return lookup.apply(this,arguments);if(typeof options==='function'){callback=options;options={};}queueMicrotask(()=>options?.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4));};
  const p=payload(SOURCES[0],0),q=payload(SOURCES[1],0),files=new Map([['/pricat/'+p.name,p],['/pricat/TVER/'+q.name,q]]);
  server=await fixture({...s.options,files,plain:true,allowPlainLogin:true,port:21021});
  const cfg={...s.config(21021),host:'service.russvet.ru',secure:false,allowPlaintextForRussvet:true};client=new FtpsSource(cfg,limits);await client.connect();
  const entries=await client.latest(now),dir=path.join(s.dir,'ordinary-ftp');await fs.mkdir(dir);
  for(const entry of entries){const f=await client.download(entry,dir);assert.equal(f.sha256,sha(files.get(entry.directory+entry.name).body));}
  assert.equal(server.stats.downloads.length,2);assert(server.stats.plainTransfers>=4);assert(server.stats.commands.includes('EPSV'));assert(!server.stats.commands.includes('AUTH'));assert.equal(server.stats.protectedTransfers,0);
  client.close();server.server.rejectLogin=true;client=new FtpsSource(cfg,limits);await assert.rejects(client.connect(),e=>e.code===530);
 }finally{dns.lookup=lookup;if(client)client.close();if(server)await server.close();await fs.rm(s.dir,{recursive:true,force:true});}
});
test('FTPS fixture: certificate validated, control/data encrypted, no USER before TLS',async()=>{
 const s=await setup();let server,client;
 try{
  const p=payload(SOURCES[0],0),q=payload(SOURCES[1],0),files=new Map([['/pricat/'+p.name,p],['/pricat/TVER/'+q.name,q]]);
  server=await fixture({...s.options,files});client=new FtpsSource(s.config(server.port),limits);await client.connect();
  const entries=await client.latest(now);assert.equal(entries.length,2);const dest=path.join(s.dir,'download');await fs.mkdir(dest);
  const received=await client.download(entries[0],dest);assert.equal(received.sha256,sha(p.body));assert.equal(received.documentNumber,p.number);
  assert(server.stats.protectedTransfers>=3);client.close();await server.close();server=null;
  server=await fixture({...s.options,plain:true});client=new FtpsSource(s.config(server.port),limits);
  await assert.rejects(client.connect());assert(!server.stats.commands.includes('USER'));assert(!server.stats.commands.includes('PASS'));client.close();await server.close();server=null;
  server=await fixture(s.options);client=new FtpsSource({...s.config(server.port),caFile:undefined},limits);
  await assert.rejects(client.connect());assert(!server.stats.commands.includes('USER'));assert(!server.stats.commands.includes('PASS'));
  client.close();await server.close();server=null;
  server=await fixture(s.options);server.server.rejectProtection=true;client=new FtpsSource(s.config(server.port),limits);
  await assert.rejects(client.connect());assert.equal(server.stats.protectedTransfers,0);
  client.close();await server.close();server=null;
  server=await fixture(s.options);server.server.rejectLogin=true;client=new FtpsSource(s.config(server.port),limits);
  await assert.rejects(client.connect(),e=>e.code===530);assert.equal(server.stats.protectedTransfers,0);
  client.close();await server.close();server=null;
  server=await fixture({...s.options,files});client=new FtpsSource(s.config(server.port),limits);await client.connect();
  const chosen=(await client.latest(now))[0];server.server.onRetrieve=(_path,f)=>{f.modified=stamp(now-200000);};
  const changing=path.join(s.dir,'changing');await fs.mkdir(changing);
  await assert.rejects(client.download(chosen,changing),e=>e.code==='FTP_SOURCE_CHANGED_DURING_DOWNLOAD');
  assert((await fs.readdir(changing)).every(n=>n.endsWith('.part')));
 }finally{if(client)client.close();if(server)await server.close();await fs.rm(s.dir,{recursive:true,force:true});}
});
test('isolated database: FTPS paired updates, reuse, two-version retention and rollback',{skip:!process.env.PRICAT_UPDATE_TEST_ADMIN_URL,timeout:180000},async t=>{
 const s=await setup(),admin=postgres(process.env.PRICAT_UPDATE_TEST_ADMIN_URL,{max:1,onnotice:()=>{}}),name='pricat_ftp_'+randomBytes(8).toString('hex');
 const u=new URL(process.env.PRICAT_UPDATE_TEST_ADMIN_URL);u.pathname='/'+name;let db,server,created=false;
 try{
  await admin.unsafe('CREATE DATABASE "'+name+'"');created=true;db=postgres(u.toString(),{max:2,onnotice:()=>{}});
  const migrations=path.resolve(__dirname,'../../prisma/migrations');for(const d of (await fs.readdir(migrations)).sort())if(/^\d/.test(d))await db.unsafe(await fs.readFile(path.join(migrations,d,'migration.sql'),'utf8'));
  await db`INSERT INTO shop_settings(id,"protectiveMarkupPercent","updatedAt") VALUES(1,30,NOW())`;
  for(const [i,code]of ['stock1','stock2','stock3'].entries())await db`INSERT INTO warehouses(code,name,"sortOrder") VALUES(${code},${code},${i})`;
  for(let i=0;i<10;i++)await db`INSERT INTO products("supplierCode",name,slug,"updatedAt") VALUES(${'p'+i},${'Synthetic '+i},${'p'+i},NOW())`;
  const files=new Map(),base=[];
  const add=(source,n,options)=>{const f=payload(source,n,options);files.set(source.directory+f.name,f);return f;};
  for(const source of SOURCES){const f=add(source,0),file=path.join(s.dir,f.name);await put(file,f.body);base.push({source:source.source,path:file});}
  await importPricat({databaseUrl:u.toString(),files:base,mode:'production'});
  server=await fixture({...s.options,files});
  const cfg={stateDirectory:path.join(s.dir,'state'),databaseUrlFile:path.join(s.dir,'url'),databaseName:name,policy:limits,ftp:s.config(server.port)};await put(cfg.databaseUrlFile,u.toString());
  const statePath=path.join(cfg.stateDirectory,'ftp','state.json'),state=async()=>JSON.parse(await fs.readFile(statePath));
  const run=mode=>sync({config:cfg,mode:mode||'publish',now});
  const content=async()=>JSON.stringify(await db`SELECT * FROM assortment_snapshots WHERE active`)+JSON.stringify(await db`SELECT * FROM product_prices ORDER BY id`)+JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`);
  await t.test('first adoption checks against existing snapshot; repeat downloads nothing',async()=>{
   assert.equal((await run()).status,'UNCHANGED');const before=server.stats.downloads.length,n=(await db`SELECT count(*)::int n FROM import_runs`)[0].n;
   assert.equal((await run()).status,'NO_REMOTE_CHANGE');assert.equal(server.stats.downloads.length,before);assert.equal((await db`SELECT count(*)::int n FROM import_runs`)[0].n,n);
  });
  await t.test('one changed source reuses last successfully published counterpart',async()=>{
   const old=await state(),before=server.stats.downloads.length;add(SOURCES[0],1,{qty:'6'});
   assert.equal((await run()).status,'SUCCEEDED');assert.equal(server.stats.downloads.length,before+1);
   const next=await state();assert.equal(next.versions.PRICAT2[0].sha256,old.versions.PRICAT2[0].sha256);assert.equal(next.versions.PRICAT1.length,2);
  });
  await t.test('both changed publish together; third successful version is removed afterwards',async()=>{
   const old=await state(),removed=old.versions.PRICAT1[1].path;add(SOURCES[0],2,{qty:'7'});add(SOURCES[1],1,{qty:'6'});
   assert.equal((await run()).status,'SUCCEEDED');const next=await state();assert.equal(next.versions.PRICAT1.length,2);assert.equal(next.versions.PRICAT2.length,2);await assert.rejects(fs.stat(removed),{code:'ENOENT'});
   for(const source of SOURCES){const names=await fs.readdir(path.dirname(next.versions[source.source][0].path));assert.equal(names.length,2);}
  });
  await t.test('changed metadata with identical bytes does not duplicate a version',async()=>{
   const prior=await state(),f=files.get('/pricat/'+prior.versions.PRICAT1[0].remote.name);f.modified=stamp(now-300000);
   assert.equal((await run()).status,'UNCHANGED');const next=await state();assert.equal(next.versions.PRICAT1.length,2);assert.equal(next.versions.PRICAT1[0].sha256,prior.versions.PRICAT1[0].sha256);
  });
  await t.test('missing or corrupt cached source and stale sync lock stop before network/import',async()=>{
   const saved=await state(),cache=saved.versions.PRICAT2[0].path,bytes=await fs.readFile(cache);await put(cache,Buffer.from('corrupt fixture'));
   const before=server.stats.downloads.length;await assert.rejects(run(),e=>e.code==='FTP_CACHE_CORRUPT');assert.equal(server.stats.downloads.length,before);await put(cache,bytes);
   const lock=path.join(cfg.stateDirectory,'ftp','sync.lock');await fs.mkdir(lock,{mode:0o700});await assert.rejects(run(),e=>e.code==='FTP_SYNC_LOCKED');assert((await fs.stat(lock)).isDirectory());await fs.rmdir(lock);
  });
  await t.test('FTP folder error preserves database and retained versions',async()=>{
   const before=await content(),prior=await fs.readFile(statePath,'utf8');server.server.failListing=true;
   await assert.rejects(run(),e=>e.code==='FTPS_OR_UPDATE_FAILED');server.server.failListing=false;
   assert.equal(await content(),before);assert.equal(await fs.readFile(statePath,'utf8'),prior);
  });
  await t.test('newer counterpart appearing during download prevents mixed publication',async()=>{
   const p=add(SOURCES[0],3),before=await content(),prior=await fs.readFile(statePath,'utf8');let changed;
   server.server.onRetrieve=()=>{server.server.onRetrieve=null;changed=add(SOURCES[1],2);};
   await assert.rejects(run(),e=>e.code==='FTP_PAIR_CHANGED_DURING_DOWNLOAD');
   files.delete('/pricat/'+p.name);files.delete('/pricat/TVER/'+changed.name);assert.equal(await content(),before);assert.equal(await fs.readFile(statePath,'utf8'),prior);
  });
  await t.test('corrupt ZIP cannot change database/history or block a later valid candidate',async()=>{
   const p=add(SOURCES[0],3),central=p.body.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));p.body.writeUInt32LE((p.body.readUInt32LE(central+16)^0xffffffff)>>>0,central+16);
   const before=await content(),prior=await fs.readFile(statePath,'utf8');await assert.rejects(run('check'),e=>e.code==='ZIP_CRC_OR_SIZE');await assert.rejects(run(),e=>e.code==='ZIP_CRC_OR_SIZE');files.delete('/pricat/'+p.name);
   assert.equal(await content(),before);assert.equal(await fs.readFile(statePath,'utf8'),prior);
   await assert.rejects(fs.stat(path.join(cfg.stateDirectory,'ftp','needs-review.json')),{code:'ENOENT'});assert.equal((await run()).status,'NO_REMOTE_CHANGE');
  });
  await t.test('publication rejection rolls back source rows and snapshot, preserving both cached pairs',async()=>{
   add(SOURCES[1],3,{price:'9000'});const before=await content(),prior=await fs.readFile(statePath,'utf8');
   await assert.rejects(run(),e=>e.code==='ASSORTMENT_OR_PRICE_CHANGE');assert.equal(await content(),before);assert.equal(await fs.readFile(statePath,'utf8'),prior);
   for(const versions of Object.values(JSON.parse(prior).versions))for(const f of versions)assert.equal(sha(await fs.readFile(f.path)),f.sha256);
   await assert.rejects(run(),e=>e.code==='PREVIOUS_PUBLICATION_NEEDS_REVIEW');
  });
 }finally{if(server)await server.close();if(db)await db.end({timeout:5});if(created)await admin.unsafe('DROP DATABASE "'+name+'"');await admin.end({timeout:5});await fs.rm(s.dir,{recursive:true,force:true});}
});

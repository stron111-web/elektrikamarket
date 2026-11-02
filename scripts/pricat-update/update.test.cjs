'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomBytes,createHash}=require('node:crypto'),{spawnSync}=require('node:child_process'),https=require('node:https');
const postgres=require('postgres'),AdmZip=require('adm-zip');
const {update,manifestCheck,receive}=require('./update.cjs');
const {importPricat}=require('../import/pricat-import.cjs');
const now=Date.parse('2026-10-31T02:00:00Z');
const limits={maxAgeHours:72,maxPairSkewHours:24,maxManifestAgeHours:2,maxFutureMinutes:5,minSourceRecords:10,maxFileBytes:1000000,maxXmlBytes:1000000,minFreeBytes:1000000,downloadTimeoutMs:2000,maxSourceDropFraction:.2,maxIssueFraction:.2,maxMissingFraction:0,maxRemovedFraction:.2,maxChangedPriceFraction:.3,maxStockCellLossFraction:.2,maxPriceChangeFactor:2,maxQuantityChangeFactor:2};
const put=(f,s)=>fs.writeFile(f,s,{mode:0o600});
const sha=b=>createHash('sha256').update(b).digest('hex');
const xml=(number='base',date='20261030010000',{qty='5',price='150',warehouseOnly=false}={})=>'<Document><DocType>PRICAT</DocType><Currency>RUB</Currency><DocumentNumber>'+number+'</DocumentNumber><DocumentDate>'+date+'</DocumentDate>'+Array.from({length:10},(_,i)=>'<DocDetail><SenderPrdCode>p'+i+'</SenderPrdCode><UOM>'+(i===1?'NMP':'PCE')+'</UOM><ItemsPerUnit>'+(i===1?'20':'1')+'</ItemsPerUnit><Multiplicity>1</Multiplicity><QTY>'+qty+'</QTY><RetailPrice>'+price+'</RetailPrice><RetailCurrency>RUB</RetailCurrency><Price2>100</Price2><SupOnhandDetail><PartnerQTY>'+qty+'</PartnerQTY><PartnerUOM>'+(i===1?'NMP':'PCE')+'</PartnerUOM></SupOnhandDetail></DocDetail>').join('')+'</Document>';
async function descriptor(file,source,body,number='base',date='20261030010000'){await put(file,body);return {source,format:'xml',path:file,sizeBytes:Buffer.byteLength(body),sha256:sha(body),documentNumber:number,documentDate:date};}
test('pair validation refuses incomplete, duplicate, stale and insecure descriptors',()=>{
 const m={pairId:'fixture',generatedAt:new Date(now).toISOString(),sources:[{source:'PRICAT1',format:'xml',path:'/fixture/one.xml',sha256:'a'.repeat(64),sizeBytes:100,documentDate:'20261030010000',documentNumber:'one'},{source:'PRICAT2',format:'xml',path:'/fixture/two.xml',sha256:'b'.repeat(64),sizeBytes:100,documentDate:'20261030010000',documentNumber:'two'}]};
 assert.doesNotThrow(()=>manifestCheck(m,limits,now));
 for(const f of [x=>x.sources.pop(),x=>x.sources[1].source='PRICAT1',x=>x.sources[1].sha256=x.sources[0].sha256,x=>x.generatedAt='2020-01-01',x=>{delete x.sources[0].path;x.sources[0].url='http://example.invalid/pricat';}]){const x=structuredClone(m);f(x);assert.throws(()=>manifestCheck(x,limits,now));}
});
test('receipt checks SHA, size, XML completeness, document identity/date and ZIP CRC',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pricat-receive-'));
 try{
  const body=xml(),s=await descriptor(path.join(dir,'input.xml'),'PRICAT1',body);
  for(const [label,change,code]of [['sha',x=>x.sha256='0'.repeat(64),'SOURCE_SHA256_OR_SIZE'],['size',x=>x.sizeBytes++,'SOURCE_SHA256_OR_SIZE'],['identity',x=>x.documentNumber='other','SOURCE_IDENTITY_MISMATCH'],['date',x=>x.documentDate='20200101000000','SOURCE_IDENTITY_MISMATCH']]){
   const dest=path.join(dir,label);await fs.mkdir(dest);const x=structuredClone(s);change(x);await assert.rejects(receive(x,limits,dest,now),e=>e.code===code);
  }
  const zip=new AdmZip();zip.addFile('pricat.xml',Buffer.from(body));const b=zip.toBuffer(),z=path.join(dir,'input.zip');await put(z,b);const zd={...s,path:z,format:'zip',sizeBytes:b.length,sha256:sha(b)};
  const ok=path.join(dir,'zip-ok');await fs.mkdir(ok);assert.equal((await receive(zd,limits,ok,now)).rows,10);
  const corrupt=Buffer.from(b),central=corrupt.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));corrupt.writeUInt32LE((corrupt.readUInt32LE(central+16)^0xffffffff)>>>0,central+16);const badZip=path.join(dir,'bad.zip');await put(badZip,corrupt);const bd=path.join(dir,'bad-zip');await fs.mkdir(bd);await assert.rejects(receive({...zd,path:badZip,sha256:sha(corrupt)},limits,bd,now),e=>e.code==='ZIP_CRC_OR_SIZE');
  const short=body.slice(0,-20),x=await descriptor(path.join(dir,'short.xml'),'PRICAT1',short),d=path.join(dir,'short');await fs.mkdir(d);await assert.rejects(receive(x,limits,d,now));
  const stale=await descriptor(path.join(dir,'stale.xml'),'PRICAT1',xml('base','20200101000000'),'base','20200101000000'),sd=path.join(dir,'stale');await fs.mkdir(sd);await assert.rejects(receive(stale,limits,sd,now),e=>e.code==='SOURCE_DATE');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('HTTPS verifies certificate, Authorization, length and SHA; redirects never followed',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pricat-https-'));let server;
 try{
  const key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');
  const p=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',key,'-out',cert,'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});assert.equal(p.status,0);
  const body=xml(),auth=path.join(dir,'authorization');await put(auth,'Bearer fixture-only');
  server=https.createServer({key:await fs.readFile(key),cert:await fs.readFile(cert)},(req,res)=>{
   if(req.url==='/redirect'){res.writeHead(302,{Location:'/file'});res.end();return;}
   if(req.headers.authorization!=='Bearer fixture-only'){res.writeHead(401);res.end();return;}
   res.writeHead(200,{'Content-Length':Buffer.byteLength(body)});res.end(body);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const s={source:'PRICAT1',format:'xml',url:'https://localhost:'+server.address().port+'/file',authorizationFile:auth,caFile:cert,sizeBytes:Buffer.byteLength(body),sha256:sha(body),documentDate:'20261030010000',documentNumber:'base'};
  const ok=path.join(dir,'ok');await fs.mkdir(ok);assert.equal((await receive(s,limits,ok,now)).rows,10);
  const redirect=path.join(dir,'redirect');await fs.mkdir(redirect);await assert.rejects(receive({...s,url:s.url.replace('/file','/redirect')},limits,redirect,now),e=>e.code==='DOWNLOAD_STATUS_OR_ENCODING');
  const untrusted=path.join(dir,'untrusted');await fs.mkdir(untrusted);await assert.rejects(receive({...s,caFile:undefined},limits,untrusted,now),e=>e.code==='HTTPS_DOWNLOAD_FAILED');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
test('isolated database: unchanged/check/publish, atomic mass-change rejection, MANUAL and locks', {skip:!process.env.PRICAT_UPDATE_TEST_ADMIN_URL,timeout:180000},async t=>{
 const admin=postgres(process.env.PRICAT_UPDATE_TEST_ADMIN_URL,{max:1,onnotice:()=>{}}),name='pricat_auto_'+randomBytes(8).toString('hex');
 const url=new URL(process.env.PRICAT_UPDATE_TEST_ADMIN_URL);url.pathname='/'+name;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pricat-auto-'));let db,created=false;
 try{
  await admin.unsafe('CREATE DATABASE "'+name+'"');created=true;db=postgres(url.toString(),{max:2,onnotice:()=>{}});
  const migrations=path.resolve(__dirname,'../../prisma/migrations');for(const d of (await fs.readdir(migrations)).sort())if(d.match(/^\d/))await db.unsafe(await fs.readFile(path.join(migrations,d,'migration.sql'),'utf8'));
  await db`INSERT INTO shop_settings(id,"protectiveMarkupPercent","updatedAt") VALUES(1,30,NOW())`;
  for(const [i,code]of ['stock1','stock2','stock3'].entries())await db`INSERT INTO warehouses(code,name,"sortOrder") VALUES(${code},${code},${i})`;
  for(let i=0;i<10;i++)await db`INSERT INTO products("supplierCode",name,slug,"updatedAt") VALUES(${'p'+i},${'Product '+i},${'p'+i},NOW())`;
  const [c]=await db`INSERT INTO product_commercial_data("productId",source,uom,"itemsPerUnit","updatedAt") SELECT id,'MANUAL','PCE',1,NOW() FROM products WHERE "supplierCode"='p9' RETURNING id`;
  await db`INSERT INTO product_prices("commercialDataId","retailPrice",price2,currency,"retailCurrency","isLocked","updatedAt") VALUES(${c.id},300,200,'RUB','RUB',true,NOW())`;
  const initial=[];for(const source of ['PRICAT1','PRICAT2'])initial.push(await descriptor(path.join(dir,source+'-base.xml'),source,xml('base-'+source),'base-'+source));
  await importPricat({databaseUrl:url.toString(),files:initial,mode:'production'});
  const cfg={stateDirectory:path.join(dir,'state'),manifestFile:path.join(dir,'pair.json'),databaseUrlFile:path.join(dir,'database_url'),databaseName:name,policy:limits,transports:{PRICAT1:{directory:dir},PRICAT2:{directory:dir}}};await put(cfg.databaseUrlFile,url.toString());
  const prepare=async(number='base',options={},secondOptions=options)=>{const sources=[];for(const [i,source]of ['PRICAT1','PRICAT2'].entries())sources.push(await descriptor(path.join(dir,source+'-'+number+'.xml'),source,xml(number+'-'+source,number==='base'?'20261030010000':'20261031010000',i?secondOptions:options),number+'-'+source,number==='base'?'20261030010000':'20261031010000'));await put(cfg.manifestFile,JSON.stringify({pairId:number,generatedAt:new Date(now).toISOString(),sources}));};
  const snapshot=async()=>JSON.stringify(await db`SELECT p."supplierCode",c.source,c.uom,c."itemsPerUnit",c."isLocked",pp."retailPrice",pp.price2,pp."isLocked" price_locked FROM products p JOIN product_commercial_data c ON c."productId"=p.id JOIN product_prices pp ON pp."commercialDataId"=c.id ORDER BY p.id,c.source`)+JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`)+JSON.stringify(await db`SELECT * FROM assortment_snapshots WHERE active`);
  await t.test('identical pair does not re-import or create audit',async()=>{await prepare();const n=(await db`SELECT count(*)::int n FROM import_runs`)[0].n;assert.equal((await update({config:cfg,mode:'publish',now})).status,'UNCHANGED');assert.equal((await db`SELECT count(*)::int n FROM import_runs`)[0].n,n);});
  await t.test('source transport cannot escape owner directory',async()=>{await prepare();const directory=cfg.transports.PRICAT1.directory;cfg.transports.PRICAT1.directory=cfg.stateDirectory;await assert.rejects(update({config:cfg,mode:'check',now}),e=>e.code==='SOURCE_PATH_NOT_ALLOWED');cfg.transports.PRICAT1.directory=directory;});
  await t.test('padding a truncated source with duplicate rows is rejected',async()=>{await prepare('padded');const m=JSON.parse(await fs.readFile(cfg.manifestFile));for(const s of m.sources){const b=(await fs.readFile(s.path,'utf8')).replace(/<SenderPrdCode>p\d+<\/SenderPrdCode>/g,'<SenderPrdCode>p0</SenderPrdCode>');await put(s.path,b);s.sizeBytes=Buffer.byteLength(b);s.sha256=sha(b);}await put(cfg.manifestFile,JSON.stringify(m));await assert.rejects(update({config:cfg,mode:'check',now}),e=>e.code==='SOURCE_RECORD_DROP');});
  await t.test('check never writes; valid pair publishes and keeps MANUAL/locked',async()=>{await prepare('next',{qty:'6'});const before=await snapshot();assert.equal((await update({config:cfg,mode:'check',now})).status,'CHECKED');assert.equal(await snapshot(),before);assert.equal((await update({config:cfg,mode:'publish',now})).count,10);const [x]=await db`SELECT "retailPrice","isLocked" FROM product_prices WHERE "commercialDataId"=${c.id}`;assert.equal(Number(x.retailPrice),300);assert(x.isLocked);});
  for(const [label,one,two,code]of [['price',{price:'9000'},{price:'9000'},'ASSORTMENT_OR_PRICE_CHANGE'],['warehouse',{qty:'0'},{qty:'6'},'WAREHOUSE_AVAILABILITY_DROP'],['quantity',{qty:'60000'},{qty:'60000'},'WAREHOUSE_QUANTITY_JUMP']])await t.test(label+' rejection rolls back source data and snapshot',async()=>{
   cfg.stateDirectory=path.join(dir,'state-'+label);await prepare(label,one,two);const before=await snapshot();await assert.rejects(update({config:cfg,mode:'publish',now}),e=>e.code===code&&e.publicationRolledBack===true);assert.equal(await snapshot(),before);await assert.rejects(fs.stat(path.join(cfg.stateDirectory,'needs-review.json')),{code:'ENOENT'});await assert.rejects(update({config:cfg,mode:'publish',now}),e=>e.code===code);assert.equal(await snapshot(),before);
  });
  await t.test('parallel/stale lock is never removed by another invocation',async()=>{cfg.stateDirectory=path.join(dir,'locked');await fs.mkdir(path.join(cfg.stateDirectory,'run.lock'),{recursive:true,mode:0o700});await assert.rejects(update({config:cfg,mode:'check',now}),e=>e.code==='UPDATE_ALREADY_LOCKED');assert((await fs.stat(path.join(cfg.stateDirectory,'run.lock'))).isDirectory());});
 }finally{if(db)await db.end({timeout:5});if(created)await admin.unsafe('DROP DATABASE "'+name+'"');await admin.end({timeout:5});await fs.rm(dir,{recursive:true,force:true});}
});

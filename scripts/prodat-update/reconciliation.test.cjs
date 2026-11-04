'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomBytes}=require('node:crypto'),postgres=require('postgres'),AdmZip=require('adm-zip');
const {importProdat}=require('../import/prodat-import.cjs');
const {importPricat,LOCK}=require('../import/pricat-import.cjs');
const {readAvailableStocks}=require('../import/pricat-store.cjs');
// Never infer an administrator URL from a production .env.
test('accepted unchanged PRICAT reprocess populates only new PRODAT products and rolls back a failed activation', {skip:process.env.PRICAT_TEST_ISOLATED!=='1'||!process.env.PRICAT_TEST_ADMIN_URL,timeout:180000},async t=>{
 const adminUrl=new URL(process.env.PRICAT_TEST_ADMIN_URL);assert.equal(adminUrl.hostname,'127.0.0.1');
 const admin=postgres(adminUrl.toString(),{max:1,onnotice:()=>{}}),name='prodat_test_'+process.pid+'_'+randomBytes(8).toString('hex');
 const url=new URL(adminUrl);url.pathname='/'+name;let db,created=false;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reconcile-prodat-'));
 try{
  await admin.unsafe('CREATE DATABASE "'+name+'"');created=true;db=postgres(url.toString(),{max:1,onnotice:()=>{}});
  for(const m of(await fs.readdir(path.resolve(__dirname,'../../prisma/migrations'))).sort())if(/^\d/.test(m))await db.unsafe(await fs.readFile(path.resolve(__dirname,'../../prisma/migrations',m,'migration.sql'),'utf8'));
  await db`INSERT INTO shop_settings(id,"protectiveMarkupPercent","updatedAt") VALUES(1,30,NOW())`;
  for(const code of ['stock1','stock2','stock3'])await db`INSERT INTO warehouses(code,name,"sortOrder") VALUES(${code},${code},1)`;
  await db`INSERT INTO products("supplierCode",name,slug,"updatedAt") VALUES('old','Old','old',NOW())`;
  const detail=(code,qty=5)=>`<DocDetail><SenderPrdCode>${code}</SenderPrdCode><UOM>PCE</UOM><ItemsPerUnit>1</ItemsPerUnit><ItemsPerUOM>шт</ItemsPerUOM><RetailPrice>150</RetailPrice><RetailCurrency>RUB</RetailCurrency><Price2>100</Price2><QTY>${qty}</QTY><SupOnhandDetail><PartnerQTY>7</PartnerQTY><PartnerUOM>PCE</PartnerUOM></SupOnhandDetail></DocDetail>`;
  const files=[];for(const source of ['PRICAT1','PRICAT2']){const file=path.join(dir,source+'.xml');await fs.writeFile(file,`<Document><DocType>PRICAT</DocType><Currency>RUB</Currency><DocumentDate>20261101010000</DocumentDate><DocumentNumber>fixture</DocumentNumber>${detail('old')}${detail('new')}${detail('bad',2)}${detail('bad',3)}</Document>`);files.push({source,path:file});}
  const run=options=>importPricat({databaseUrl:url.toString(),mode:'production',files,...options});
  await run();const [baseline]=await db`SELECT id FROM assortment_snapshots WHERE active`;
  const [max]=await db`SELECT max(id)::int id FROM products`;
  const beforeOld=async()=>JSON.stringify({commercial:await db`SELECT c.* FROM product_commercial_data c JOIN products p ON p.id=c."productId" WHERE p."supplierCode"='old' ORDER BY c.id`,prices:await db`SELECT pr.* FROM product_prices pr JOIN product_commercial_data c ON c.id=pr."commercialDataId" JOIN products p ON p.id=c."productId" WHERE p."supplierCode"='old' ORDER BY pr.id`,stocks:await db`SELECT s.* FROM product_stocks s JOIN products p ON p.id=s."productId" WHERE p."supplierCode"='old' ORDER BY s.id`});
  // Model a protected owner correction; the scoped pass must not revisit it.
  await db`UPDATE product_stocks SET "isLocked"=true WHERE "productId"=${max.id}`;
  const saved=await beforeOld();
  const zip=new AdmZip();zip.addFile('catalog.xml',Buffer.from('<Document><DocType>PRODAT</DocType><DocDetail><SenderPrdCode>new</SenderPrdCode><ProductName>New</ProductName></DocDetail><DocDetail><SenderPrdCode>bad</SenderPrdCode><ProductName>Bad</ProductName></DocDetail></Document>'));
  const prodat=path.join(dir,'new.zip');await fs.writeFile(prodat,zip.toBuffer());
  await t.test('PRODAT refuses a concurrent PRICAT advisory lock',async()=>{
   await db`SELECT pg_advisory_lock(${LOCK})`;try{await assert.rejects(importProdat({databaseUrl:url.toString(),files:[prodat]}),/PRICAT|publication|running/i);}finally{await db`SELECT pg_advisory_unlock(${LOCK})`;}
  });
  await t.test('PRODAT publication hook failure rolls back catalog changes',async()=>{
   await assert.rejects(importProdat({databaseUrl:url.toString(),files:[prodat],beforeCommit:()=>{throw Error('fixture prodat rollback');}}),/fixture prodat rollback/);
   assert.equal((await db`SELECT count(*)::int n FROM products`)[0].n,1);
  });
  const inserted=await importProdat({databaseUrl:url.toString(),files:[prodat]});assert.equal(inserted.createdRecords,2);
  await t.test('ordinary SHA skip does not populate new products',async()=>{assert.equal((await run()).status,'SKIPPED');assert.equal((await readAvailableStocks(db,['new'])).length,0);});
  const scope={prodatRunId:inserted.runId,afterProductId:max.id,acceptedSnapshotId:String(baseline.id),codes:['new','bad']};
  await t.test('failed activation leaves previous snapshot and new prices absent',async()=>{
   await assert.rejects(run({reprocess:true,reconcileNewProducts:scope,beforeSnapshotActivate:()=>{throw Error('fixture activation rollback');}}),/fixture activation rollback/);
   assert.equal(String((await db`SELECT id FROM assortment_snapshots WHERE active`)[0].id),String(baseline.id));assert.equal((await readAvailableStocks(db,['new'])).length,0);assert.equal(await beforeOld(),saved);
  });
  await t.test('unchanged accepted pair with reprocess publishes eligible goods, preserves quarantine and old data',async()=>{
   const result=await run({reprocess:true,reconcileNewProducts:scope});assert.equal(result.status,'SUCCEEDED');assert.equal(result.zeroedStocks,0);assert.equal(result.zeroedPositiveStocks,0);assert.equal(result.reconciliation.codes,2);assert.equal(await beforeOld(),saved);
   const offers=await readAvailableStocks(db,['new']);assert.equal(offers.length,3);assert.ok(offers.every(o=>o.priceSource==='PRICAT2'&&Number(o.retailPrice)===150&&Number(o.quantity)>0));assert.equal((await readAvailableStocks(db,['bad'])).length,0);
   assert.equal((await db`SELECT "productCount" FROM assortment_snapshots WHERE active`)[0].productCount,2);
  });
  await t.test('repeated or broadened scope is rejected without altering the active snapshot',async()=>{
   const snapshot=JSON.stringify(await db`SELECT * FROM assortment_snapshots WHERE active`);await assert.rejects(run({reprocess:true,reconcileNewProducts:scope}),/untouched newly created/);assert.equal(JSON.stringify(await db`SELECT * FROM assortment_snapshots WHERE active`),snapshot);
   await assert.rejects(run({reprocess:true,reconcileNewProducts:{...scope,codes:['old']}}),/untouched newly created/);assert.equal(await beforeOld(),saved);
  });
 }finally{if(db)await db.end({timeout:5});if(created&&/^prodat_test_\d+_[a-f0-9]{16}$/.test(name))await admin.unsafe('DROP DATABASE "'+name+'" WITH (FORCE)');await admin.end({timeout:5});await fs.rm(dir,{recursive:true,force:true});}
});

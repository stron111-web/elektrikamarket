'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const postgres=require('postgres'),AdmZip=require('adm-zip');
const {importProdat}=require('./prodat-import.cjs');
const {normalizeFeatures}=require('./prodat-features.cjs');
const {protectedFrame,bounds,assertFrame}=require('../prodat-update/publish.cjs');
test('ETIM layer: legacy SHA backfill, no other writes, manual/locked protection, idempotency and rollback',{timeout:180000},async()=>{
 const adminUrl=process.env.PRODAT_TEST_ADMIN_URL;
 assert(adminUrl&&new URL(adminUrl).hostname==='127.0.0.1','Explicit isolated admin required');
 const admin=postgres(adminUrl,{max:1,onnotice:()=>{}}),name='prodat_test_etim_'+process.pid+'_'+Date.now(),u=new URL(adminUrl);u.pathname='/'+name;
 let db;const dir=await fs.mkdtemp(path.join(os.tmpdir(),'etim-test-'));
 try{
  await admin.unsafe('CREATE DATABASE "'+name+'"');db=postgres(u.toString(),{max:1,onnotice:()=>{}});
  const migrations=path.resolve(__dirname,'../../prisma/migrations');for(const entry of (await fs.readdir(migrations,{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.unsafe(await fs.readFile(path.join(migrations,entry.name,'migration.sql'),'utf8'));
  const make=async(value,filename)=>{const z=new AdmZip();let records='';for(const code of ['1','2','3'])records+=`<DocDetail><SenderPrdCode>${code}</SenderPrdCode><ProductName>Name ${value}</ProductName><FeatureETIMDetails><FeatureETIM><FeatureCode>EF1</FeatureCode><FeatureName>Name</FeatureName><FeatureValue>${value}</FeatureValue><FeatureUom>mm</FeatureUom></FeatureETIM></FeatureETIMDetails></DocDetail>`;z.addFile('x.xml',Buffer.from('<Document><DocType>PRODAT</DocType><DocumentNumber>1</DocumentNumber><DocumentDate>20261101</DocumentDate>'+records+'</Document>'));const p=path.join(dir,filename);await fs.writeFile(p,z.toBuffer());return p;};
  const first=await make('1','first.zip');const run=(files,options={})=>importProdat({databaseUrl:u.toString(),files,batchSize:1,...options});
  await run([first]);assert.equal((await db`SELECT count(*)::int n FROM product_features`)[0].n,3);
  // Emulate the proven old importer: accepted catalog, no ETIM layer marker.
  await db`DELETE FROM product_features`;await db`UPDATE import_files SET metadata=jsonb_set(metadata,'{layers}',(metadata->'layers')-'features')`;
  const before=JSON.stringify(await db`SELECT * FROM products ORDER BY id`);
  const protectedBounds=await bounds(db),protectedBaseline=await protectedFrame(db,protectedBounds);
  const back=await run([first],{featuresOnly:true});assert.equal(back.createdRecords,0);assert.equal(back.updatedRecords,0);assert.equal(back.references.features.created,3);assert.equal(JSON.stringify(await db`SELECT * FROM products ORDER BY id`),before);
  assertFrame(await protectedFrame(db,protectedBounds),protectedBaseline);
  const again=await run([first],{featuresOnly:true});assert.equal(again.status,'SKIPPED');assert.equal((await db`SELECT count(*)::int n FROM product_features`)[0].n,3);
  const second=await make('2','second.zip');
  await db`UPDATE product_features SET origin='MANUAL',"identityKey"=repeat('a',64),"featureValue"='manual' WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='1')`;
  await db`UPDATE product_features SET "isLocked"=true,"featureValue"='locked' WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='2')`;
  await db`UPDATE products SET "lockedFields"=ARRAY['features'] WHERE "supplierCode"='3'`;
  await run([second]);assert.deepEqual((await db`SELECT f."featureValue" FROM product_features f JOIN products p ON p.id=f."productId" ORDER BY p."supplierCode"`).map(x=>x.featureValue),['manual','locked','1']);
  await db`UPDATE products SET "lockedFields"='{}' WHERE "supplierCode"='3'`;
  const frame=JSON.stringify(await db`SELECT * FROM product_features ORDER BY id`),third=await make('3','third.zip');
  await assert.rejects(run([third],{beforeCommit:async()=>{throw Error('injected');}}),/injected/);assert.equal(JSON.stringify(await db`SELECT * FROM product_features ORDER BY id`),frame);
  await run([third]);assert.equal((await db`SELECT "featureValue" FROM product_features WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='3')`)[0].featureValue,'3');
  const unseen=await make('4','unaccepted.zip');await assert.rejects(run([unseen],{featuresOnly:true}),/already successfully imported/);
  const identity=normalizeFeatures({FeatureETIMDetails:{FeatureETIM:{FeatureCode:'EF1',FeatureName:'Name',FeatureValue:'3',FeatureUom:'mm'}}}).rows[0].identityKey;
  assert.equal((await db`SELECT count(*)::int n FROM product_features WHERE "identityKey"=${identity}`)[0].n,2);
 }finally{if(db)await db.end({timeout:5});await admin.unsafe('DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)');await admin.end({timeout:5});await fs.rm(dir,{recursive:true,force:true});}
});

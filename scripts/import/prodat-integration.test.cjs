'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const postgres = require('postgres');
const AdmZip = require('adm-zip');
const { importProdat, connectionUrl, VERSION } = require('./prodat-import.cjs');
require('dotenv').config({ path:path.resolve(__dirname,'../../.env'),quiet:true });

// DATABASE_URL is used only to create/drop a randomly named test DB. Importer never receives it.
async function temporaryDatabase(work) {
  const adminUrl = connectionUrl(process.env.PRODAT_TEST_ADMIN_URL || process.env.DATABASE_URL);
  const admin = postgres(adminUrl, {max:1,onnotice:()=>{}});
  const name = `prodat_test_${process.pid}_${randomBytes(8).toString('hex')}`;
  const url = new URL(adminUrl); url.pathname = '/' + name;
  let db, created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`); created=true;
    db = postgres(url.toString(),{max:1,onnotice:()=>{}});
    const migrations = path.resolve(__dirname,'../../prisma/migrations');
    for (const entry of (await fs.readdir(migrations,{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
      await db.unsafe(await fs.readFile(path.join(migrations,entry.name,'migration.sql'),'utf8'));
    }
    await work({db,databaseUrl:url.toString(),name});
  } finally {
    if (db) await db.end({timeout:5});
    if (created && /^prodat_test_\d+_[a-f0-9]{16}$/.test(name) && new URL(adminUrl).pathname !== '/' + name) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end({timeout:5});
  }
}
const rec = (code,name='Товар',extra='') => `<DocDetail><SenderPrdCode>${code}</SenderPrdCode><ProductName>${name}</ProductName><Brand> Brand A </Brand><Country><Value> Китай </Value><Value>Китай</Value><Value>Россия</Value></Country><Weight><Value>9999999999.1234567891</Value><WeightUnit>KGM</WeightUnit></Weight><LabelledItemCHZ>check</LabelledItemCHZ>${extra}</DocDetail>`;
const cat = (leaf='Leaf') => `<RsCatalog><Level4ID>1</Level4ID><Level4Name>Root</Level4Name><Level3ID>2</Level3ID><Level3Name>Middle</Level3Name><Level2ID>3</Level2ID><Level2Name>${leaf}</Level2Name></RsCatalog>`;
async function archive(dir,name,records,header='<DocType>PRODAT</DocType><SenderGln>001</SenderGln><ReceiverGln>002</ReceiverGln><Currency>RUB</Currency><DocumentNumber>0001</DocumentNumber><DocumentDate>20261007</DocumentDate>') {
  const zip = new AdmZip(); zip.addFile('catalog.xml',Buffer.from(`<Document>${header}${records}</Document>`));
  const file = path.join(dir,name); await fs.writeFile(file,zip.toBuffer()); return file;
}
async function catalogSnapshot(db) {
  return JSON.stringify({ products:await db`SELECT * FROM products ORDER BY id`,brands:await db`SELECT * FROM brands ORDER BY id`,categories:await db`SELECT * FROM categories ORDER BY id` });
}
async function assertNoDuplicates(db) {
  for (const [table,key] of [['products','supplierCode'],['brands','name'],['categories','sourceKey']]) {
    assert.equal((await db.unsafe(`SELECT "${key}" FROM ${table} GROUP BY "${key}" HAVING count(*)>1`)).length,0);
  }
}
async function assertExcludedEmpty(db) {
  for (const table of ['product_features','product_barcodes','product_images','product_documents','product_relations','product_stocks','product_prices','product_commercial_data','import_issues']) {
    assert.equal((await db.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0].n,0,table);
  }
}

test('production importer on an isolated temporary PostgreSQL database', {timeout:180000}, async t => {
  await temporaryDatabase(async ({db,databaseUrl,name}) => {
    t.diagnostic(`Temporary database: ${name}`);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(),'prodat-fixtures-'));
    try {
      const common=rec('001','Товар',cat());
      const a=await archive(dir,'a.zip',common+rec('002'));
      const b=await archive(dir,'b.zip',common+rec('003'));
      const run = files => importProdat({databaseUrl,files,batchSize:1});
      await t.test('two parts, exact duplicates, metadata, decimals and all audit counters',async()=>{
        const result=await run([a,b]);
        assert.equal(result.status,'SUCCEEDED'); assert.equal(result.processedRecords,4); assert.equal(result.createdRecords,3); assert.equal(result.skippedRecords,1);
        const [product]=await db`SELECT * FROM products WHERE "supplierCode"='001'`;
        assert.equal(product.weight,'9999999999.1234567891'); assert.equal(product.labelledItemChz,'check'); assert.deepEqual(product.countries,['Китай','Россия']);
        assert.equal((await db`SELECT * FROM brands`).length,1); assert.equal((await db`SELECT * FROM categories`).length,3);
        const chain=await db`SELECT c."sourceKey",p."sourceKey" AS parent FROM categories c LEFT JOIN categories p ON p.id=c."parentId" ORDER BY c."sourceKey"`;
        assert.deepEqual(chain.map(v=>[v.sourceKey,v.parent]),[['rsv:catalog:L2:3','rsv:catalog:L3:2'],['rsv:catalog:L3:2','rsv:catalog:L4:1'],['rsv:catalog:L4:1',null]]);
        const audits=await db`SELECT * FROM import_files WHERE "runId"=${result.runId} ORDER BY id`;
        assert.ok(audits.every(v=>v.status==='SUCCEEDED' && v.finishedAt && v.documentNumber==='0001' && v.metadata.documents[0].SenderGln==='001'));
        assert.equal(audits.reduce((n,v)=>n+v.metadata.counters.createdRecords,0),3);
        await assertNoDuplicates(db); await assertExcludedEmpty(db);
      });
      await t.test('same SHA repeat, reversed order and renamed file do not republish',async()=>{
        const before=await catalogSnapshot(db);
        const renamed=path.join(dir,'renamed.zip'); await fs.copyFile(a,renamed);
        const result=await run([b,renamed]);
        assert.equal(result.status,'SKIPPED'); assert.equal(result.skippedRecords,4); assert.equal(result.createdRecords,0);
        assert.equal(await catalogSnapshot(db),before);
        assert.ok((await db`SELECT status FROM import_files WHERE "runId"=${result.runId}`).every(v=>v.status==='SKIPPED'));
      });
      await t.test('new SHA updates permitted fields while preserving slugs, locks and missing products',async()=>{
        const [before]=await db`SELECT * FROM products WHERE "supplierCode"='001'`;
        await db`UPDATE products SET name='Manual',"lockedFields"=ARRAY['name','weight','brandId','countries'],"isArchived"=true WHERE id=${before.id}`;
        await db`UPDATE categories SET name='Manual leaf',"lockedFields"=ARRAY['name','parentId'] WHERE "sourceKey"='rsv:catalog:L2:3'`;
        const file=await archive(dir,'update.zip',rec('001','Changed',cat('Renamed')+'<Series>New series</Series>'));
        const result=await run([file]); assert.equal(result.updatedRecords,1);
        const [after]=await db`SELECT * FROM products WHERE id=${before.id}`;
        assert.equal(after.name,'Manual'); assert.equal(after.series,'New series'); assert.equal(after.slug,before.slug); assert.equal(after.weight,before.weight); assert.equal(after.isArchived,true);
        assert.equal((await db`SELECT count(*)::int AS n FROM products`)[0].n,3);
        assert.equal((await db`SELECT name FROM categories WHERE "sourceKey"='rsv:catalog:L2:3'`)[0].name,'Manual leaf');
        const snapshot=await catalogSnapshot(db);
        const same=await archive(dir,'same-data-new-sha.zip',rec('001','Changed',cat('Renamed')+'<Series>New series</Series>'),'<!-- new envelope --><DocType>PRODAT</DocType>');
        const repeated=await run([same]); assert.equal(repeated.updatedRecords,0); assert.equal(repeated.skippedRecords,1); assert.equal(await catalogSnapshot(db),snapshot);
      });
      await t.test('changed locked values, relations, category moves and stable category slugs',async()=>{
        const [before]=await db`SELECT * FROM products WHERE "supplierCode"='001'`;
        const [leaf]=await db`SELECT * FROM categories WHERE "sourceKey"='rsv:catalog:L2:3'`;
        await db`UPDATE products SET "lockedFields"=ARRAY['name','weight','brandId','categoryId','countries','physicalRaw','lastProdatFileId','lastProdatAt'] WHERE id=${before.id}`;
        const changed=rec('001','Supplier name',cat('New leaf').replace('<Level4ID>1</Level4ID>','<Level4ID>4</Level4ID>')+'<Series>Another series</Series>')
          .replace(' Brand A ','Brand B').replace('9999999999.1234567891','1.25').replace(' Китай ','Индия').replace('<Value>Китай</Value>','');
        await run([await archive(dir,'locked-values.zip',changed)]);
        const [after]=await db`SELECT * FROM products WHERE id=${before.id}`;
        for(const key of ['name','weight','brandId','categoryId','countries','physicalRaw','lastProdatFileId','lastProdatAt']) assert.deepEqual(after[key],before[key],key);
        assert.equal(after.series,'Another series');
        const [newLeaf]=await db`SELECT * FROM categories WHERE id=${leaf.id}`;
        assert.equal(newLeaf.slug,leaf.slug); assert.equal(newLeaf.name,leaf.name); assert.equal(newLeaf.parentId,leaf.parentId);
        const [middle]=await db`SELECT c.*,p."sourceKey" AS parent FROM categories c JOIN categories p ON p.id=c."parentId" WHERE c."sourceKey"='rsv:catalog:L3:2'`;
        assert.equal(middle.parent,'rsv:catalog:L4:4');
        await db`UPDATE categories SET "lockedFields"='{}' WHERE id=${leaf.id}`;
        await run([await archive(dir,'unlocked-category.zip',changed.replace('New leaf','Renamed leaf').replace('Another series','Latest series'))]);
        const [renamed]=await db`SELECT * FROM categories WHERE id=${leaf.id}`;
        assert.equal(renamed.name,'Renamed leaf'); assert.equal(renamed.slug,leaf.slug);
      });
      await t.test('locked manual parent cycle is rejected atomically',async()=>{
        const [root]=await db`SELECT * FROM categories WHERE "sourceKey"='rsv:catalog:L4:4'`;
        const [leaf]=await db`SELECT * FROM categories WHERE "sourceKey"='rsv:catalog:L2:3'`;
        await db`UPDATE categories SET "parentId"=${leaf.id},"lockedFields"=ARRAY['parentId'] WHERE id=${root.id}`;
        const before=await catalogSnapshot(db);
        const file=await archive(dir,'cycle.zip',rec('cycle','Cycle',cat().replace('<Level4ID>1</Level4ID>','<Level4ID>4</Level4ID>')));
        await assert.rejects(run([file]),/Category parent cycle/); assert.equal(await catalogSnapshot(db),before);
        await db`UPDATE categories SET "parentId"=null,"lockedFields"='{}' WHERE id=${root.id}`;
      });
      await t.test('conflicting records roll back in either file order, including differences in images',async()=>{
        const x=await archive(dir,'conflict-a.zip',rec('999','A','<Image><Value>a</Value></Image>'));
        const y=await archive(dir,'conflict-b.zip',rec('999','A','<Image><Value>b</Value></Image>'));
        const snapshot=await catalogSnapshot(db);
        for (const files of [[x,y],[y,x]]) {
          await assert.rejects(run(files),/Conflicting SenderPrdCode/);
          assert.equal(await catalogSnapshot(db),snapshot);
          const [audit]=await db`SELECT * FROM import_runs ORDER BY id DESC LIMIT 1`;
          assert.equal(audit.status,'FAILED'); assert.equal(audit.createdRecords,0); assert.equal(audit.errorCount,1); assert.ok(audit.diagnostics.error.firstRecord); assert.ok(audit.diagnostics.error.currentRecord);
          assert.ok((await db`SELECT status FROM import_files WHERE "runId"=${audit.id}`).every(v=>v.status==='FAILED'));
        }
      });
      await t.test('previously successful SHA still participates in cross-file conflict checks',async()=>{
        const conflict=await archive(dir,'mixed.zip',rec('001','Conflict'));
        const before=await catalogSnapshot(db);
        await assert.rejects(run([a,conflict]),/Conflicting SenderPrdCode/); assert.equal(await catalogSnapshot(db),before);
      });
      await t.test('category conflicts and malformed XML cannot partially publish',async()=>{
        const conflicting=await archive(dir,'cat-conflict.zip',rec('new1','A',cat('One'))+rec('new2','B',cat('Two')));
        const malformed=await archive(dir,'malformed.zip',rec('new3')+'<DocDetail>');
        const invalid=await archive(dir,'invalid.zip',rec('new4').replace('check','invalid'));
        const before=await catalogSnapshot(db);
        for (const file of [conflicting,malformed,invalid]) await assert.rejects(run([file]));
        assert.equal(await catalogSnapshot(db),before);
      });
      await t.test('publication failure rolls back catalog; same SHA can be retried',async()=>{
        const file=await archive(dir,'retry.zip',rec('retry'));
        const before=await catalogSnapshot(db);
        await assert.rejects(importProdat({databaseUrl,files:[file],onProgress:p=>{if(p.phase==='publish') throw new Error('Injected publication failure');}}),/Injected/);
        assert.equal(await catalogSnapshot(db),before);
        const [audit]=await db`SELECT * FROM import_runs ORDER BY id DESC LIMIT 1`; assert.equal(audit.createdRecords,0); assert.equal(audit.status,'FAILED');
        const result=await run([file]); assert.equal(result.createdRecords,1); assert.equal(result.status,'SUCCEEDED');
      });
      await t.test('orphaned RUNNING audits recover after session lock; concurrent importer is rejected',async()=>{
        const [orphan]=await db`INSERT INTO import_runs(type,status,"importerVersion") VALUES('PRODAT','RUNNING',${VERSION}) RETURNING id`;
        await run([a]); assert.equal((await db`SELECT status FROM import_runs WHERE id=${orphan.id}`)[0].status,'FAILED');
        await db`SELECT pg_advisory_lock(1707312401)`;
        try { await assert.rejects(run([a]),/Another PRODAT/); }
        finally { await db`SELECT pg_advisory_unlock(1707312401)`; }
        await assertNoDuplicates(db); await assertExcludedEmpty(db);
        assert.equal((await db`SELECT * FROM import_runs WHERE status='RUNNING'`).length,0);
      });
    } finally {
      // Only this test's mkdtemp directory, never an input path or workspace directory.
      assert.equal(path.dirname(dir),os.tmpdir()); assert.ok(path.basename(dir).startsWith('prodat-fixtures-'));
      await fs.rm(dir,{recursive:true,force:true});
    }
  });
});

test('full two-file catalog: performance, repeat, idempotency, duplicates and audits', {skip:process.env.PRODAT_FULL_TEST!=='1',timeout:900000}, async t=>{
  await temporaryDatabase(async({db,databaseUrl,name})=>{
    t.diagnostic(`Full-catalog temporary database: ${name}`);
    const files=['PRODAT_369147_1312233182.zip','PRODAT_369147_1312247470.zip'].map(f=>path.resolve(__dirname,'../..',f));
    const run=()=>importProdat({databaseUrl,files,onProgress:p=>{if(p.phase!=='validate'||p.processedRecords%25000===0) console.log('FULL',JSON.stringify(p));}});
    const first=await run(); t.diagnostic(`First import: ${JSON.stringify(first)}`);
    assert.equal(first.processedRecords,148882); assert.equal(first.createdRecords,148872); assert.equal(first.skippedRecords,10); assert.equal(first.status,'SUCCEEDED');
    assert.equal((await db`SELECT count(*)::int AS n FROM brands`)[0].n,382);
    assert.equal((await db`SELECT count(*)::int AS n FROM categories`)[0].n,244);
    for(const [kind,table] of [['product','products'],['category','categories'],['brand','brands']]) {
      const rows=await db.unsafe('SELECT slug FROM '+table);
      assert.equal(new Set(rows.map(r=>r.slug)).size,rows.length);
      assert.equal(rows.filter(r=>new RegExp('^'+kind+'-[a-f0-9]{64}$').test(r.slug)).length,0);
      assert.ok(rows.every(r=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.slug)));
    }
    const [before]=await db`SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) AS hash FROM products p`;
    const second=await run(); t.diagnostic(`Repeat import: ${JSON.stringify(second)}`);
    assert.equal(second.status,'SKIPPED'); assert.equal(second.skippedRecords,148882); assert.equal(second.createdRecords,0); assert.equal(second.updatedRecords,0);
    const [after]=await db`SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) AS hash FROM products p`; assert.equal(after.hash,before.hash);
    await assertNoDuplicates(db); await assertExcludedEmpty(db);
    const runs=await db`SELECT status FROM import_runs ORDER BY id`; assert.deepEqual(runs.map(v=>v.status),['SUCCEEDED','SKIPPED']);
    const audits=await db`SELECT status,metadata FROM import_files ORDER BY id`; assert.deepEqual(audits.map(v=>v.status),['SUCCEEDED','SUCCEEDED','SKIPPED','SKIPPED']);
    assert.equal(audits.slice(0,2).reduce((n,v)=>n+v.metadata.counters.createdRecords,0),148872);
  });
});

test('readable slug collisions and one-time legacy repair in a temporary DB', {timeout:180000},async t=>{
  const {repairSlugs,INITIAL_FILES}=require('./prodat-repair-slugs.cjs');
  const {technicalSlug}=require('./prodat-slug.cjs');
  await temporaryDatabase(async({db,databaseUrl})=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prodat-fixtures-'));
    try {
      const c=cat('Group').replace('Root','Group').replace('Middle','Group');
      const a=await archive(dir,INITIAL_FILES[0].fileName,rec('s1','Same',c)+rec('s2','Same',c)+rec('manual','Manual',c)+rec('locked','Locked',c)+rec('fake','Fake',c));
      const b=await archive(dir,INITIAL_FILES[1].fileName,rec('s3','Different',c).replace(' Brand A ','Brand-A'));
      await importProdat({databaseUrl,files:[a,b]});
      await t.test('new products, categories and brands have unique readable collision slugs',async()=>{
        const p=await db`SELECT slug FROM products WHERE "supplierCode" IN ('s1','s2') ORDER BY "supplierCode"`;
        assert.deepEqual(p.map(r=>r.slug),['same-s1','same-s2']);
        const categories=await db`SELECT slug FROM categories ORDER BY "sourceKey"`;
        assert.deepEqual(categories.map(r=>r.slug),['group-rsv-catalog-l2-3','group-rsv-catalog-l3-2','group-rsv-catalog-l4-1']);
        const brands=await db`SELECT slug FROM brands`;assert.equal(brands.length,2);assert.ok(brands.every(b=>/^brand-a-[a-f0-9]{12}$/.test(b.slug)));
      });
      // Reproduce a legacy initial-run fixture only inside the temporary database.
      await db`UPDATE import_runs SET "importerVersion"='prodat-v1.0.0' WHERE id=1`;
      for(const file of INITIAL_FILES) await db`UPDATE import_files SET sha256=${file.sha256} WHERE "fileName"=${file.fileName}`;
      for(const [kind,table,key] of [['product','products','supplierCode'],['category','categories','sourceKey'],['brand','brands','name']]) {
        for(const r of await db.unsafe(`SELECT id,"${key}" AS identity FROM ${table}`)) await db`UPDATE ${db(table)} SET slug=${technicalSlug(kind,r.identity)} WHERE id=${r.id}`;
      }
      await db`UPDATE products SET slug='manual-slug' WHERE "supplierCode"='manual'`;
      await db`UPDATE products SET "lockedFields"=ARRAY['slug'] WHERE "supplierCode"='locked'`;
      await db`UPDATE products SET slug=${'product-'+'a'.repeat(64)} WHERE "supplierCode"='fake'`;
      await db`INSERT INTO products ("supplierCode",name,slug,"updatedAt") VALUES ('outside','Outside',${technicalSlug('product','outside')},CURRENT_TIMESTAMP)`;
      await db`INSERT INTO categories (name,slug,"sourceKey") VALUES ('Other',${technicalSlug('category','manual:outside')},'manual:outside')`;
      await db`INSERT INTO brands (name,slug,"updatedAt") VALUES ('Other',${technicalSlug('brand','Other')},CURRENT_TIMESTAMP)`;
      const before=await catalogSnapshot(db);
      let dry;
      await t.test('dry-run does not write and selects only proven initial technical slugs',async()=>{
        dry=await repairSlugs({databaseUrl}); assert.equal(dry.mode,'DRY_RUN');
        assert.deepEqual(dry.changed,{product:0,category:0,brand:0});
        assert.equal(dry.summary.product.candidates,3);assert.equal(dry.summary.category.candidates,3);assert.equal(dry.summary.brand.candidates,2);
        assert.equal(await catalogSnapshot(db),before);
      });
      await t.test('stale reviewed plan is refused before any write',async()=>{
        await assert.rejects(repairSlugs({databaseUrl,dryRun:false,expectedPlan:'0'.repeat(64)}),/plan changed/);
        assert.equal(await catalogSnapshot(db),before);
      });
      await t.test('late SQL failure rolls back earlier product slug updates',async()=>{
        await db.unsafe(`CREATE FUNCTION reject_slug() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test repair rollback'; END $$`);
        await db.unsafe(`CREATE TRIGGER reject_slug BEFORE UPDATE OF slug ON categories FOR EACH ROW EXECUTE FUNCTION reject_slug()`);
        try { await assert.rejects(repairSlugs({databaseUrl,dryRun:false,expectedPlan:dry.planHash}),/test repair rollback/); }
        finally { await db.unsafe('DROP TRIGGER reject_slug ON categories'); await db.unsafe('DROP FUNCTION reject_slug()'); }
        assert.equal(await catalogSnapshot(db),before);
      });
      await t.test('apply changes only slug, preserves manual/locked/unrelated rows and is idempotent',async()=>{
        const applied=await repairSlugs({databaseUrl,dryRun:false,expectedPlan:dry.planHash});
        assert.deepEqual(applied.changed,{product:3,category:3,brand:2});
        const after=JSON.parse(await catalogSnapshot(db)), original=JSON.parse(before);
        for(const table of ['products','brands','categories']) {
          assert.deepEqual(after[table].map(({slug,...r})=>r),original[table].map(({slug,...r})=>r));
        }
        for(const code of ['manual','locked','fake','outside']) assert.equal(after.products.find(p=>p.supplierCode===code).slug,original.products.find(p=>p.supplierCode===code).slug);
        const second=await repairSlugs({databaseUrl});assert.equal(second.summary.product.candidates,0);assert.equal(second.summary.category.candidates,0);assert.equal(second.summary.brand.candidates,0);
        const result=await repairSlugs({databaseUrl,dryRun:false,expectedPlan:second.planHash});assert.deepEqual(result.changed,{product:0,category:0,brand:0});
        await assertNoDuplicates(db);
      });
      await t.test('future import preserves repaired slugs when names change',async()=>{
        const snapshot=JSON.parse(await catalogSnapshot(db));
        const updated=await archive(dir,'renamed.zip',rec('s1','Renamed',c.replaceAll('Group','Renamed group')));
        await importProdat({databaseUrl,files:[updated]});
        const [p]=await db`SELECT * FROM products WHERE "supplierCode"='s1'`;assert.equal(p.name,'Renamed');assert.equal(p.slug,snapshot.products.find(p=>p.supplierCode==='s1').slug);
        assert.deepEqual((await db`SELECT id,slug FROM categories ORDER BY id`).map(r=>({...r})),snapshot.categories.map(r=>({id:r.id,slug:r.slug})));
      });
    }finally{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('prodat-fixtures-'));await fs.rm(dir,{recursive:true,force:true});}
  });
});

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
  for (const table of ['product_features','product_images','product_documents','product_relations','product_stocks','product_prices','product_commercial_data']) {
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


// Load the reviewed base-only importer from Git without writing or changing the checkout.
function legacyImporter(ref='1d35206') {
  const {execFileSync}=require('node:child_process');
  const Module=require('node:module');const filename=path.join(__dirname,'prodat-legacy-test.cjs');
  const legacy=new Module(filename,module);legacy.filename=filename;legacy.paths=module.paths;
  legacy._compile(execFileSync('git',['show',ref+':scripts/import/prodat-import.cjs'],{encoding:'utf8'}),filename);
  return legacy.exports.importProdat;
}
async function tableHash(db,table) {
  return (await db.unsafe("SELECT md5(coalesce(string_agg(to_jsonb(p)::text,'' ORDER BY id),'')) AS hash FROM "+table+" p"))[0].hash;
}
test('full base -> EAN -> references -> identical repeat', {skip:process.env.PRODAT_FULL_TEST!=='1',timeout:900000},async t=>{
  await temporaryDatabase(async({db,databaseUrl,name})=>{
    t.diagnostic('Full references temporary database: '+name);
    const files=['PRODAT_369147_1312233182.zip','PRODAT_369147_1312247470.zip'].map(f=>path.resolve(__dirname,'../..',f));
    const onProgress=p=>{if(p.phase!=='validate'||p.processedRecords%25000===0)console.log('FULL',JSON.stringify(p));};
    const base=await legacyImporter()({databaseUrl,files,onProgress});t.diagnostic('Base: '+JSON.stringify(base));
    const ean=await legacyImporter('a5d73f9')({databaseUrl,files,onProgress});t.diagnostic('EAN: '+JSON.stringify(ean));
    assert.equal(base.createdRecords,148872);assert.equal(ean.barcodes.created,130972);assert.equal(ean.warningCount,302);
    const expected={products:148872,brands:382,categories:244,product_barcodes:130972};
    const hashes={};for(const table of Object.keys(expected)){assert.equal((await db.unsafe('SELECT count(*)::int AS n FROM '+table))[0].n,expected[table]);hashes[table]=await tableHash(db,table);}
    const first=await importProdat({databaseUrl,files,onProgress});t.diagnostic('References: '+JSON.stringify(first));
    assert.equal(first.status,'SUCCEEDED');assert.equal(first.createdRecords,0);assert.equal(first.updatedRecords,0);assert.equal(first.barcodes.created,0);assert.equal(first.barcodes.updated,0);
    Object.assign(expected,{product_images:391505,product_documents:321197,product_relations:519990});
    for(const [table,count] of Object.entries(expected))assert.equal((await db.unsafe('SELECT count(*)::int AS n FROM '+table))[0].n,count,table);
    for(const [layer,count] of Object.entries({images:391505,documents:321197,relations:519990}))assert.equal(first.references[layer].created,count);
    const resolved=await db`SELECT count(*) FILTER(WHERE "relatedId" IS NOT NULL)::int AS resolved,count(*) FILTER(WHERE "relatedId" IS NULL)::int AS unresolved FROM product_relations`;
    assert.deepEqual({...resolved[0]},{resolved:328445,unresolved:191545});
    assert.equal((await db`SELECT count(*)::int AS n FROM product_relations r LEFT JOIN products p ON p."supplierCode"=r."targetSupplierCode" WHERE (p.id IS NULL) IS DISTINCT FROM (r."relatedId" IS NULL) OR (p.id IS NOT NULL AND p.id IS DISTINCT FROM r."relatedId")`)[0].n,0);
    for(const table of Object.keys(hashes))assert.equal(await tableHash(db,table),hashes[table],table+' changed');
    for(const [table,keys] of [['product_images','"productId","urlKey"'],['product_documents','"productId","identityKey"'],['product_relations','"productId","relationType","targetSupplierCode"']])assert.equal((await db.unsafe('SELECT 1 FROM '+table+' GROUP BY '+keys+' HAVING count(*)>1')).length,0);
    const issues=await db`SELECT severity,code,count(*)::int AS count FROM import_issues GROUP BY severity,code ORDER BY code`;
    assert.ok(issues.every(r=>r.severity==='WARNING'));assert.equal(issues.find(r=>r.code==='RELATION_UNRESOLVED').count,191545);
    assert.equal(issues.reduce((n,r)=>n+r.count,0),302+first.warningCount);
    const suspicious=await db`SELECT i."supplierCode",i.code,i.details,d.url FROM import_issues i JOIN products p ON p."supplierCode"=i."supplierCode" JOIN product_documents d ON d."productId"=p.id AND d.url=i.details->>'value' WHERE i.code='REFERENCE_URL' ORDER BY i.id LIMIT 5`;
    assert.ok(suspicious.some(r=>r.url==='пырвпа'));
    const samples={
      images:await db`SELECT p."supplierCode",p.name,i.url,i."sortOrder",i.alt FROM product_images i JOIN products p ON p.id=i."productId" ORDER BY i.id LIMIT 10`,
      documents:await db`SELECT p."supplierCode",d.type,d."certificateType",d.url,d.name,d."sortOrder" FROM product_documents d JOIN products p ON p.id=d."productId" ORDER BY d.id LIMIT 10`,
      relations:await db`(SELECT p."supplierCode",p.name,r."relationType",r."targetSupplierCode",r."relatedId",target.name AS "targetName" FROM product_relations r JOIN products p ON p.id=r."productId" LEFT JOIN products target ON target.id=r."relatedId" WHERE r."relatedId" IS NULL ORDER BY r.id LIMIT 10) UNION ALL (SELECT p."supplierCode",p.name,r."relationType",r."targetSupplierCode",r."relatedId",target.name AS "targetName" FROM product_relations r JOIN products p ON p.id=r."productId" JOIN products target ON target.id=r."relatedId" ORDER BY r.id LIMIT 10)`
    };
    t.diagnostic('Counts: '+JSON.stringify(expected));t.diagnostic('Resolved: '+JSON.stringify(resolved));t.diagnostic('Issues: '+JSON.stringify(issues));t.diagnostic('Suspicious: '+JSON.stringify(suspicious));
    for(const table of ['product_images','product_documents','product_relations','import_issues'])hashes[table]=await tableHash(db,table);
    const second=await importProdat({databaseUrl,files:files.toReversed(),onProgress});t.diagnostic('Repeat: '+JSON.stringify(second));assert.equal(second.status,'SKIPPED');assert.equal(second.warningCount,0);
    for(const layer of Object.keys(second.references)){assert.equal(second.references[layer].created,0);assert.equal(second.references[layer].updated,0);}
    for(const table of Object.keys(hashes))assert.equal(await tableHash(db,table),hashes[table],table+' changed after repeat');
    const runs=await db`SELECT id,status,"processedRecords","createdRecords","updatedRecords","skippedRecords","failedRecords","errorCount","warningCount" FROM import_runs ORDER BY id`;
    assert.deepEqual(runs.map(r=>r.status),['SUCCEEDED','SUCCEEDED','SUCCEEDED','SKIPPED']);
    const audits=await db`SELECT status,metadata FROM import_files ORDER BY id`;
    assert.deepEqual(audits.map(r=>r.status),['SUCCEEDED','SUCCEEDED','SUCCEEDED','SUCCEEDED','SUCCEEDED','SUCCEEDED','SKIPPED','SKIPPED']);
    for(const [layer,count] of Object.entries({images:391505,documents:321197,relations:519990}))assert.equal(audits.slice(4,6).reduce((n,r)=>n+r.metadata.references[layer].created,0),count);
    for(const table of ['product_features','product_stocks','product_prices','product_commercial_data'])assert.equal((await db.unsafe('SELECT count(*)::int AS n FROM '+table))[0].n,0);
    await assertNoDuplicates(db);
    if(process.env.PRODAT_REFERENCE_REPORT)await fs.writeFile(process.env.PRODAT_REFERENCE_REPORT,JSON.stringify({database:name,base,ean,first,second,counts:expected,resolved:resolved[0],issues,suspicious,samples,runs,hashes},null,2));
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

const eanXml = values => '<EAN>'+values.map(([v,d='EAN'])=>`<Value>${v}</Value><Description>${d}</Description>`).join('')+'</EAN>';
test('EAN publication, protection, rollback and file order in temporary databases',{timeout:180000},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prodat-fixtures-'));
  try {
    const a=await archive(dir,'ean-a.zip',rec('none','None',cat())+rec('one','One',eanXml([['04600572029629']])));
    const b=await archive(dir,'ean-b.zip',rec('many','Many',eanXml([['04600572029629'],['03245060104115'],['03245060104115']])));
    let expected;
    for(const files of [[a,b],[b,a]]) await temporaryDatabase(async({db,databaseUrl})=>{
      const run=fs=>importProdat({databaseUrl,files:fs,batchSize:1});
      const result=await run(files);assert.equal(result.barcodes.created,3);assert.equal(result.barcodes.duplicateEntries,1);
      const semantic=async()=>JSON.stringify(await db`SELECT p."supplierCode",b.barcode,b.type,b."sortOrder",b.origin,b."isLocked" FROM product_barcodes b JOIN products p ON p.id=b."productId" ORDER BY p."supplierCode",b.barcode`);
      const rows=await semantic();if(expected)assert.equal(rows,expected);else expected=rows;
      assert.equal((await db`SELECT count(*)::int AS n FROM product_barcodes b JOIN products p ON p.id=b."productId" WHERE p."supplierCode"='none'`)[0].n,0);
      assert.equal((await db`SELECT count(*)::int AS n FROM import_issues WHERE code='BARCODE_SHARED_ACROSS_PRODUCTS'`)[0].n,2);
      assert.equal((await db`SELECT count(*)::int AS n FROM import_issues WHERE code='BARCODE_DUPLICATE'`)[0].n,1);
      const catalog=await catalogSnapshot(db),barcodeHash=await tableHash(db,'product_barcodes');
      assert.equal((await run(files.toReversed())).status,'SKIPPED');assert.equal(await catalogSnapshot(db),catalog);assert.equal(await tableHash(db,'product_barcodes'),barcodeHash);
      const fresh=await archive(dir,'fresh.zip',rec('one','One',eanXml([['04600572029629'],['04607004491955']])));
      await assert.rejects(importProdat({databaseUrl,files:[fresh],onProgress:p=>{if(p.phase==='publish')throw new Error('EAN late rollback');}}),/EAN late rollback/);
      assert.equal(await catalogSnapshot(db),catalog);assert.equal(await tableHash(db,'product_barcodes'),barcodeHash);
      assert.equal((await db`SELECT status FROM import_runs ORDER BY id DESC LIMIT 1`)[0].status,'FAILED');
      const updated=await run([fresh]);assert.equal(updated.barcodes.created,1);assert.equal(await catalogSnapshot(db),catalog);
      await db`UPDATE product_barcodes SET origin='MANUAL',type='Manual' WHERE barcode='04600572029629'`;
      await db`UPDATE product_barcodes SET "isLocked"=true WHERE barcode='03245060104115'`;
      await db`UPDATE products SET "lockedFields"=ARRAY['barcodes'] WHERE "supplierCode"='one'`;
      const protectedCatalog=await catalogSnapshot(db),protectedBarcodes=await tableHash(db,'product_barcodes');
      const locked=await archive(dir,'locked.zip',rec('one','One',eanXml([['04600572029629','Changed'],['4006381333931']]))+rec('many','Many',eanXml([['03245060104115','Changed']])));
      const pr=await run([locked]);assert.equal(pr.barcodes.protected,3);assert.equal(pr.barcodes.created,0);
      assert.equal(await catalogSnapshot(db),protectedCatalog);assert.equal(await tableHash(db,'product_barcodes'),protectedBarcodes);
      const bad=await archive(dir,'bad-ean.zip',rec('one','One',eanXml([['123','First'],['123','Other']])));
      await assert.rejects(run([bad]),/description/i);assert.equal(await catalogSnapshot(db),protectedCatalog);assert.equal(await tableHash(db,'product_barcodes'),protectedBarcodes);
      assert.equal((await db`SELECT count(*)::int AS n FROM import_issues WHERE severity='ERROR' AND code='BARCODE_DESCRIPTION_CONFLICT'`)[0].n,1);
      await assertExcludedEmpty(db);
      // A previously successful SHA must not silently claim enrichment for a deleted product.
      const legacyFile=await archive(dir,'legacy-missing.zip',rec('missing','Missing',eanXml([['4006381333931']])));
      await legacyImporter()({databaseUrl,files:[legacyFile]});
      await db`DELETE FROM products WHERE "supplierCode"='missing'`;
      await assert.rejects(run([legacyFile]),/missing catalog product/);
      const [missingIssue]=await db`SELECT "supplierCode",code FROM import_issues WHERE code='BARCODE_PRODUCT_MISSING'`;
      assert.equal(missingIssue.supplierCode,'missing');
    });
    t.diagnostic('Both ZIP orders, empty/single/multiple, shared/duplicate, repeat, late rollback and manual/product locks passed');
  } finally {assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('prodat-fixtures-'));await fs.rm(dir,{recursive:true,force:true});}
});

const refXml = '<Image><Value>https://example.test/a.jpg</Value><Value>https://example.test/a.jpg</Value><Value>https://example.test/b.jpg</Value></Image>'+
  '<CertificateInfo><Certificate><CertificateType>A</CertificateType><CertificateURL>https://example.test/a.pdf</CertificateURL></Certificate><Certificate><CertificateType>B</CertificateType><CertificateURL>https://example.test/a.pdf</CertificateURL></Certificate></CertificateInfo>'+
  '<Passport><Value>https://example.test/a.pdf</Value><Value>https://example.test/a.pdf</Value><Value>пырвпа</Value></Passport>'+
  '<Analog><ItemCode>002</ItemCode><ItemCode>002</ItemCode><ItemCode>003</ItemCode><ItemCode>001</ItemCode></Analog><RelatedProd><ItemCode>002</ItemCode></RelatedProd>';
async function referenceSnapshot(db){const result={};for(const table of ['product_images','product_documents','product_relations'])result[table]=await tableHash(db,table);return JSON.stringify(result);}
test('reference enrichment: legacy SHA, file order, locked/manual, late rollback and target resolution',{timeout:180000},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prodat-fixtures-'));
  try{
    const a=await archive(dir,'ref-a.zip',rec('001','Source',cat()+eanXml([['04600572029629']])+refXml)+rec('004','Empty'));
    const b=await archive(dir,'ref-b.zip',rec('002','Target','<Image><Value>https://example.test/a.jpg</Value></Image>'));
    let expected;
    for(const files of [[a,b],[b,a]])await temporaryDatabase(async({db,databaseUrl})=>{
      await legacyImporter()({databaseUrl,files});await legacyImporter('a5d73f9')({databaseUrl,files});
      const catalog=await catalogSnapshot(db),barcodes=await tableHash(db,'product_barcodes');
      const run=files=>importProdat({databaseUrl,files,batchSize:2});
      // The failure happens after all three layers have written, before COMMIT.
      await assert.rejects(importProdat({databaseUrl,files,onProgress:p=>{if(p.phase==='publish')throw Error('reference rollback');}}),/reference rollback/);
      for(const table of ['product_images','product_documents','product_relations'])assert.equal((await db.unsafe('SELECT count(*)::int AS n FROM '+table))[0].n,0);
      assert.equal((await db`SELECT count(*)::int AS n FROM import_issues`)[0].n,0);
      assert.equal(await catalogSnapshot(db),catalog);assert.equal(await tableHash(db,'product_barcodes'),barcodes);
      const first=await run(files);assert.equal(first.references.images.created,3);assert.equal(first.references.documents.created,4);assert.equal(first.references.relations.created,4);
      assert.equal(first.references.images.duplicateEntries,1);assert.equal(first.references.documents.duplicateEntries,1);assert.equal(first.references.relations.duplicateEntries,1);
      const semantic={};for(const table of ['product_images','product_documents','product_relations'])semantic[table]=await db.unsafe(`SELECT p."supplierCode",to_jsonb(r)-'id'-'productId'-'relatedId' AS data FROM ${table} r JOIN products p ON p.id=r."productId" ORDER BY p."supplierCode",(to_jsonb(r)-'id'-'productId'-'relatedId')::text`);
      if(expected)assert.equal(JSON.stringify(semantic),expected);else expected=JSON.stringify(semantic);
      const rows=await db`SELECT r.*,target."supplierCode" AS resolved FROM product_relations r LEFT JOIN products target ON target.id=r."relatedId" ORDER BY r."relationType",r."sortOrder"`;
      assert.deepEqual(rows.map(r=>[r.targetSupplierCode,r.resolved]),[['002','002'],['003',null],['001','001'],['002','002']]);
      assert.equal((await db`SELECT count(*)::int AS n FROM products`)[0].n,3); // no fake 003
      assert.equal((await db`SELECT url FROM product_documents WHERE url='пырвпа'`).length,1);
      assert.equal((await db`SELECT count(*)::int AS n FROM import_issues WHERE code='RELATION_UNRESOLVED'`)[0].n,1);
      const before=await referenceSnapshot(db),issues=await tableHash(db,'import_issues');
      assert.equal((await run(files.toReversed())).status,'SKIPPED');assert.equal(await referenceSnapshot(db),before);assert.equal(await tableHash(db,'import_issues'),issues);
      assert.equal(await catalogSnapshot(db),catalog);assert.equal(await tableHash(db,'product_barcodes'),barcodes);
      const same=await archive(dir,'ref-new-sha.zip',rec('001','Source',cat()+eanXml([['04600572029629']])+refXml),'<!-- new SHA --><DocType>PRODAT</DocType>');
      const unchanged=await run([same]);for(const layer of Object.values(unchanged.references)){assert.equal(layer.created,0);assert.equal(layer.updated,0);}
      assert.equal(await catalogSnapshot(db),catalog);assert.equal(await tableHash(db,'product_barcodes'),barcodes);assert.equal(await referenceSnapshot(db),before);
      // No removals, and manual/locked metadata survives a changed ordering.
      await db`UPDATE product_images SET origin='MANUAL',alt='Manual alt' WHERE "sortOrder"=0`;
      await db`UPDATE product_documents SET "isLocked"=true,name='Locked name'`;
      await db`UPDATE product_relations SET origin='MANUAL' WHERE "targetSupplierCode"='002'`;
      const protectedBefore=await referenceSnapshot(db);
      const reordered=await archive(dir,'reordered.zip',rec('001','Source',cat()+eanXml([['04600572029629']])+refXml.replace('<Value>https://example.test/a.jpg</Value><Value>https://example.test/a.jpg</Value>','').replace('<ItemCode>002</ItemCode><ItemCode>002</ItemCode><ItemCode>003</ItemCode>','<ItemCode>003</ItemCode><ItemCode>002</ItemCode>')));
      const protectedResult=await run([reordered]);assert.ok(protectedResult.references.documents.protected>0);assert.ok(protectedResult.references.relations.protected>0);
      assert.equal((await db`SELECT count(*)::int AS n FROM product_images WHERE alt='Manual alt'`)[0].n,2);
      assert.ok((await db`SELECT name FROM product_documents`).every(r=>r.name==='Locked name'));
      await db`UPDATE products SET "lockedFields"=ARRAY['images','documents','relations'] WHERE "supplierCode"='001'`;
      const locked=await referenceSnapshot(db),lockedCatalog=await catalogSnapshot(db);
      const lockedFile=await archive(dir,'product-lock.zip',rec('001','Source',cat()+eanXml([['04600572029629']])+refXml.replaceAll('https://example.test','https://different.test')));
      const lockedResult=await run([lockedFile]);assert.ok(lockedResult.references.images.protected>0);assert.equal(await referenceSnapshot(db),locked);assert.equal(await catalogSnapshot(db),lockedCatalog);
      await db`UPDATE products SET "lockedFields"='{}' WHERE "supplierCode"='001'`;
      const target=await archive(dir,'target.zip',rec('003','Appeared'));
      const resolved=await run([target]);assert.equal(resolved.resolvedExistingRelations,1);assert.equal((await db`SELECT count(*)::int AS n FROM product_relations WHERE "targetSupplierCode"='003' AND "relatedId" IS NOT NULL`)[0].n,1);
      const malformed=await archive(dir,'unknown-field.zip',rec('001','Source','<Image><Value>https://example.test/a.jpg</Value><Unmapped>data</Unmapped></Image>'));
      const last=await referenceSnapshot(db);await assert.rejects(run([malformed]),/Unexpected reference structure/);assert.equal(await referenceSnapshot(db),last);
      assert.equal((await db`SELECT count(*)::int AS n FROM import_issues WHERE severity='ERROR' AND code='REFERENCE_STRUCTURE'`)[0].n,1);
    });
    t.diagnostic('Both file orders and all reference scenarios passed');
  }finally{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('prodat-fixtures-'));await fs.rm(dir,{recursive:true,force:true});}
});

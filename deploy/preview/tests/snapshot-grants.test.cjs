'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const postgres=require('postgres');
const adminUrl=process.env.ASSORTMENT_TEST_ADMIN_URL;

// Only the disposable local cluster supplied explicitly by the integration runner.
// The fixed database/role names exercise the exact production guard, not rewritten SQL.
test('preview snapshot grants expose public offers, never costs or writes',
 {skip:!adminUrl,timeout:60000},async()=>{
 const admin=postgres(adminUrl,{max:1,onnotice:()=>{}});
 const name='elektrikamarket_test_20261029t010219z_2761a73c';
 const target=new URL(adminUrl);target.pathname='/'+name;
 const root=path.resolve(__dirname,'../../..');
 let created=false,role=false,db;
 try{
  await admin.unsafe('CREATE DATABASE "'+name+'"');created=true;
  db=postgres(target.toString(),{max:1,onnotice:()=>{}});
  const migrations=path.join(root,'prisma/migrations');
  for(const d of (await fs.readdir(migrations,{withFileTypes:true})).filter(d=>d.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))
   await db.unsafe(await fs.readFile(path.join(migrations,d.name,'migration.sql'),'utf8'));
  await admin`CREATE ROLE storefront_preview_ro NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`;role=true;
  const script=await fs.readFile(path.join(root,'deploy/preview/snapshot-grants.sql'),'utf8');
  // psql's ON_ERROR_STOP directive is exercised by the release runner; postgres.js runs SQL only.
  await db.unsafe(script.replace(/^\\set.*\r?\n/m,''));
  const [rights]=await db`SELECT
   has_column_privilege('storefront_preview_ro','assortment_items','retailPrice','SELECT') retail,
   has_column_privilege('storefront_preview_ro','assortment_items','stocks','SELECT') stocks,
   has_column_privilege('storefront_preview_ro','assortment_items','purchasePrice','SELECT') purchase,
   has_table_privilege('storefront_preview_ro','assortment_items','INSERT,UPDATE,DELETE,TRUNCATE') writable,
   has_sequence_privilege('storefront_preview_ro','assortment_snapshots_id_seq','USAGE') sequence`;
  assert.deepEqual(rights,{retail:true,stocks:true,purchase:false,writable:false,sequence:false});
  await db.begin('read only',async tx=>{
   await tx`SET LOCAL ROLE storefront_preview_ro`;
   await tx`SELECT "productId","priceSource","retailPrice",currency,uom,"itemsPerUnit","itemsPerUom",multiplicity,"multiplicityRaw",stocks FROM assortment_items LIMIT 1`;
   await tx`SELECT id,"productCount","projectionVersion","createdAt" FROM assortment_snapshots LIMIT 1`;
  });
  await assert.rejects(db.begin('read only',async tx=>{
   await tx`SET LOCAL ROLE storefront_preview_ro`;await tx`SELECT "purchasePrice" FROM assortment_items LIMIT 1`;
  }),e=>e.code==='42501');
 }finally{
  if(db)await db.end({timeout:5});
  if(created)await admin.unsafe('DROP DATABASE "'+name+'"');
  if(role)await admin`DROP ROLE storefront_preview_ro`;
  await admin.end({timeout:5});
 }
});

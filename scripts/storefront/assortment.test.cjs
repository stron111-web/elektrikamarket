'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const path=require('node:path'),os=require('node:os'),{randomBytes}=require('node:crypto'),postgres=require('postgres');
const {importPricat}=require('../import/pricat-import.cjs');
const {readAvailableStocks}=require('../import/pricat-store.cjs');
const {buildAssortmentSnapshot,activeAssortment}=require('./assortment.cjs');
const {readCatalog}=require('./catalog.cjs');
const adminUrl=process.env.ASSORTMENT_TEST_ADMIN_URL;
const filters=v=>({q:'',category:'',brand:0,page:1,availability:'stock',...v});
const norm=v=>v==null?null:String(v).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('isolated snapshot publication and equivalence',{skip:!adminUrl,timeout:180000},async t=>{
 const admin=postgres(adminUrl,{max:1,onnotice:()=>{}});
 const name='assortment_test_'+process.pid+'_'+randomBytes(8).toString('hex');
 const target=new URL(adminUrl);target.pathname='/'+name;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'assortment-fixture-'));
 let created=false,db,role,sequence=0;const queries=[];
 try{
  await admin.unsafe('CREATE DATABASE "'+name+'"');created=true;
  db=postgres(target.toString(),{max:3,onnotice:()=>{},debug:(_id,s)=>queries.push(s)});
  const q=(s,p=[])=>db.unsafe(s,p);
  const migrations=path.resolve(__dirname,'../../prisma/migrations');
  for(const d of (await fs.readdir(migrations,{withFileTypes:true})).filter(d=>d.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))
   await q(await fs.readFile(path.join(migrations,d.name,'migration.sql'),'utf8'));
  await q('INSERT INTO shop_settings(id,"protectiveMarkupPercent","updatedAt") VALUES (1,30,NOW())');
  for(const [i,code]of ['stock1','stock2','stock3'].entries())await q('INSERT INTO warehouses(code,name,"sortOrder") VALUES ($1,$1,$2)',[code,i]);
  const [brand]=await q("INSERT INTO brands(name,slug,\"updatedAt\") VALUES ('Fixture','fixture',NOW()) RETURNING id");
  const [root]=await q("INSERT INTO categories(name,slug,\"sourceKey\") VALUES ('Root','root','root') RETURNING id");
  const [leaf]=await q("INSERT INTO categories(name,slug,\"sourceKey\",\"parentId\") VALUES ('Leaf','leaf','leaf',$1) RETURNING id",[root.id]);
  const codes=['offer','package','missing-price','no-stock','partner-uom','quarantine','manual','literal%_',...Array.from({length:60},(_,i)=>'item-'+i)];
  for(const code of codes)await q('INSERT INTO products("supplierCode",slug,name,"brandId","categoryId","updatedAt") VALUES ($1,$1,$2,$3,$4,NOW())',[code,'Товар '+code,brand.id,leaf.id]);
  const [mp]=await q("SELECT id FROM products WHERE \"supplierCode\"='manual'");
  const [mc]=await q("INSERT INTO product_commercial_data(\"productId\",source,uom,\"itemsPerUnit\",\"updatedAt\") VALUES ($1,'MANUAL','PCE',1,NOW()) RETURNING id",[mp.id]);
  await q("INSERT INTO product_prices(\"commercialDataId\",\"retailPrice\",\"price2\",currency,\"retailCurrency\",\"isLocked\",\"updatedAt\") VALUES ($1,300,200,'RUB','RUB',true,NOW())",[mc.id]);
  const manualBefore=JSON.stringify(await q('SELECT * FROM product_prices WHERE "commercialDataId"=$1',[mc.id]));
  async function pair({qty='5',unit='20',conflict=false}={}){
   const files=[];
   for(const source of ['PRICAT1','PRICAT2']){
    let rows='';
    for(const code of codes){
     const uom=code==='package'?'NMP':'PCE',retail=code==='missing-price'?'':source==='PRICAT2'&&code==='offer'?'120.00':'150.00';
     const cost=source==='PRICAT2'&&code==='offer'?'200.00':'100.00';
     const quantity=code==='no-stock'||source==='PRICAT2'&&code==='offer'?'0':qty;
     const partner=code==='no-stock'?'0':'3',puom=code==='partner-uom'?'MTR':uom;
     const record=amount=>'<DocDetail><SenderPrdCode>'+code+'</SenderPrdCode><UOM>'+uom+'</UOM><ItemsPerUnit>'+(code==='package'?unit:'1')+'</ItemsPerUnit><ItemsPerUOM>шт</ItemsPerUOM><Multiplicity>1</Multiplicity><QTY>'+amount+'</QTY><RetailPrice>'+retail+'</RetailPrice><RetailCurrency>RUB</RetailCurrency><Price2>'+cost+'</Price2><SupOnhandDetail><PartnerQTY>'+partner+'</PartnerQTY><PartnerUOM>'+puom+'</PartnerUOM></SupOnhandDetail></DocDetail>';
     rows+=record(quantity);if(conflict&&code==='quarantine')rows+=record('99');
    }
    const filename=path.join(dir,source+'-'+(++sequence)+'.xml');
    await fs.writeFile(filename,'<Document><DocType>PRICAT</DocType><Currency>RUB</Currency><DocumentDate>20261030010000</DocumentDate><DocumentNumber>fixture</DocumentNumber>'+rows+'</Document>');
    files.push({source,path:filename});
   }return files;
  }
  const run=(files,extra={})=>importPricat({databaseUrl:target.toString(),files,mode:'production',...extra});
  const reader=(v={},options={})=>db.begin('isolation level repeatable read read only',tx=>readCatalog(tx,filters(v),options));
  const active=async()=>(await q('SELECT id FROM assortment_snapshots WHERE active'))[0].id;
  async function equivalent(){
   await db.begin('isolation level repeatable read read only',async tx=>{
    const snap=await activeAssortment(tx),old=await readAvailableStocks(tx,codes);
    const stored=await tx.unsafe('SELECT p."supplierCode",a.* FROM assortment_items a JOIN products p ON p.id=a."productId" WHERE a."snapshotId"=$1',[snap.id]);
    const sort=rs=>rs.sort((a,b)=>(a.supplierCode+':'+a.warehouse).localeCompare(b.supplierCode+':'+b.warehouse));
    const flat=stored.flatMap(a=>a.stocks.map(s=>({supplierCode:a.supplierCode,warehouse:s.warehouse,quantity:norm(s.quantity),uom:s.uom,source:s.source,priceSource:a.priceSource,retailPrice:norm(a.retailPrice),currency:a.currency})));
    assert.deepEqual(sort(flat),sort(old.map(s=>({...s,quantity:norm(s.quantity),retailPrice:norm(s.retailPrice)}))));
    assert.equal(stored.length,snap.productCount);
    for(const a of stored){
     const [c]=await tx.unsafe('SELECT c."itemsPerUnit",c."itemsPerUom",c.multiplicity,c."multiplicityRaw",p."price2" FROM product_commercial_data c JOIN product_prices p ON p."commercialDataId"=c.id WHERE c."productId"=$1 AND c.source=$2',[a.productId,a.priceSource]);
     for(const k of ['itemsPerUnit','multiplicity'])assert.equal(norm(a[k]),norm(c[k]));
     for(const k of ['itemsPerUom','multiplicityRaw'])assert.equal(a[k],c[k]);
     assert.equal(norm(a.purchasePrice),norm(c.price2));
    }
   });
  }
  let files=await pair();
  await t.test('bootstrap fails closed; one source alone does not publish',async()=>{
   await assert.rejects(reader(),/snapshot is not ready/);
   await assert.rejects(db.begin(tx=>buildAssortmentSnapshot(tx)),/Both successfully/);
   await run([files[0]]);assert.equal((await q('SELECT count(*)::int n FROM assortment_snapshots'))[0].n,0);
  });
  await t.test('paired canonical prices/stocks/packaging/costs and MANUAL preservation',async()=>{
   await run(files);await equivalent();
   const offer=(await reader({q:'offer'})).items[0];assert.equal(offer.price.retailPrice,'260.00');
   assert.deepEqual(offer.stocks.map(s=>s.warehouse),['stock1','stock3']);
   assert.equal((await reader({q:'package'})).items[0].price.uom,'NMP');
   assert.equal((await reader({q:'package'})).items[0].stocks[0].quantity,'5.00000000');
   assert.equal((await reader({q:'missing-price'})).total,0);assert.equal((await reader({q:'no-stock'})).total,0);
   assert.deepEqual((await reader({q:'partner-uom'})).items[0].stocks.map(s=>s.warehouse),['stock1','stock2']);
   assert.equal((await reader({q:'manual'})).items[0].price.priceSource,'MANUAL');
   assert.equal(JSON.stringify(await q('SELECT * FROM product_prices WHERE "commercialDataId"=$1',[mc.id])),manualBefore);
  });
  await t.test('SHA skip, category descendants, filters, literal search, exact count and page clamp',async()=>{
   const before=await active();assert.equal((await run(files)).status,'SKIPPED');assert.equal(await active(),before);
   const allowed=new Set((await readAvailableStocks(db,codes)).map(s=>s.supplierCode));
   const expected=(await q('SELECT id,"supplierCode" FROM products ORDER BY id')).filter(p=>allowed.has(p.supplierCode));
   for(const page of [1,2,3,999]){
    const data=await reader({page}),actualPage=Math.min(page,Math.ceil(expected.length/24));
    assert.equal(data.total,expected.length);assert.deepEqual(data.items.map(p=>p.id),expected.slice((actualPage-1)*24,actualPage*24).map(p=>p.id));
   }
   assert.equal((await reader({category:'root'})).total,expected.length);
   assert.equal((await reader({category:'leaf',brand:brand.id})).total,expected.length);
   assert.equal((await reader({category:'unknown'})).total,0);assert.equal((await reader({q:'%_'})).total,1);
   assert.equal((await reader({q:'missing-price',availability:'all'})).total,0);
   assert.equal((await reader({q:'missing-price',availability:'all'},{diagnostics:true})).total,1);
   queries.length=0;assert(!JSON.stringify(await reader()).includes('purchasePrice'));
   assert(!queries.some(s=>/\b(product_prices|product_stocks|product_commercial_data|import_issues)\b/.test(s)));
  });
  await t.test('immutable until explicit rebuild; protective setting changes correctly applied',async()=>{
   const before=(await reader({q:'offer'})).items[0];
   await q('UPDATE shop_settings SET "protectiveMarkupPercent"=40');
   assert.deepEqual((await reader({q:'offer'})).items[0],before);
   await db.begin(tx=>buildAssortmentSnapshot(tx));assert.equal((await reader({q:'offer'})).items[0].price.retailPrice,'280.00');
   await q('UPDATE shop_settings SET "protectiveMarkupPercent"=30');await db.begin(tx=>buildAssortmentSnapshot(tx));
  });
  await t.test('activation failure rolls back source PRICAT and preserves complete previous snapshot',async()=>{
   const beforeId=await active(),before=JSON.stringify(await q('SELECT * FROM product_stocks ORDER BY id'));
   await assert.rejects(run(await pair({qty:'77'}),{beforeSnapshotActivate:()=>{throw Error('fixture interruption');}}),/fixture interruption/);
   assert.equal(await active(),beforeId);assert.equal(JSON.stringify(await q('SELECT * FROM product_stocks ORDER BY id')),before);await equivalent();
  });
  await t.test('atomic switch keeps uncommitted generation invisible and old RR readers consistent',async()=>{
   const ready=deferred(),release=deferred();let publishing;const next=await pair({qty:'11'});
   try{
    await db.begin('isolation level repeatable read read only',async tx=>{
     const old=await activeAssortment(tx);
     publishing=run(next,{beforeSnapshotActivate:async()=>{ready.resolve();await release.promise;}});
     await Promise.race([ready.promise,publishing.then(()=>{throw Error('hook not reached');})]);
     assert.equal((await activeAssortment(tx)).id,old.id);assert.equal(await active(),old.id);
     release.resolve();await publishing;
     assert.equal((await activeAssortment(tx)).id,old.id);assert.notEqual(await active(),old.id);
    });
   }finally{release.resolve();if(publishing)await publishing;}
   await equivalent();files=next;assert.equal((await q('SELECT count(*)::int n FROM assortment_snapshots'))[0].n,2);
  });
  await t.test('duplicate quarantine and locked NMP unit conflict preserved; compatible recovery',async()=>{
   await q("UPDATE product_prices SET \"isLocked\"=true WHERE \"commercialDataId\" IN (SELECT c.id FROM product_commercial_data c JOIN products p ON p.id=c.\"productId\" WHERE p.\"supplierCode\"='package')");
   const before=JSON.stringify(await q("SELECT s.* FROM product_stocks s JOIN products p ON p.id=s.\"productId\" WHERE p.\"supplierCode\"='package' ORDER BY s.id"));
   await run(await pair({conflict:true,unit:'10'}));await equivalent();
   assert.equal((await reader({q:'quarantine'})).total,0);assert.equal((await reader({q:'package'})).total,0);
   assert.equal(JSON.stringify(await q("SELECT s.* FROM product_stocks s JOIN products p ON p.id=s.\"productId\" WHERE p.\"supplierCode\"='package' ORDER BY s.id")),before);
   await run(await pair(),{reprocess:true});await equivalent();
   assert.equal((await reader({q:'package'})).total,1);assert.equal((await reader({q:'quarantine'})).total,1);
  });
  await t.test('valid empty snapshot has zero items without fictitious availability',async()=>{
   await q('UPDATE product_stocks SET quantity=0');await db.begin(tx=>buildAssortmentSnapshot(tx));
   const data=await reader();assert.equal(data.total,0);assert.deepEqual(data.items,[]);await equivalent();
  });
  await t.test('read-only role sees public columns, not purchase price or writes',async()=>{
   role='assortment_ro_'+randomBytes(8).toString('hex');
   await q('CREATE ROLE '+role+' NOLOGIN');await q('GRANT USAGE ON SCHEMA public TO '+role);
   await q('GRANT SELECT ON products,brands,categories,product_images,assortment_snapshots TO '+role);
   await q('GRANT SELECT ("snapshotId","productId","priceSource","retailPrice",currency,uom,"itemsPerUnit","itemsPerUom",multiplicity,"multiplicityRaw",stocks) ON assortment_items TO '+role);
   await db.begin('read only',async tx=>{await tx.unsafe('SET LOCAL ROLE '+role);await readCatalog(tx,filters());});
   await assert.rejects(db.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE '+role);await tx.unsafe('SELECT "purchasePrice" FROM assortment_items');}),e=>e.code==='42501');
   await assert.rejects(db.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE '+role);await tx.unsafe('DELETE FROM assortment_snapshots');}),e=>e.code==='42501');
  });
 }finally{
  if(db)await db.end({timeout:5});
  if(created&&/^assortment_test_\d+_[a-f0-9]{16}$/.test(name)&&new URL(adminUrl).pathname!=='/'+name)await admin.unsafe('DROP DATABASE "'+name+'" WITH (FORCE)');
  if(role&&/^assortment_ro_[a-f0-9]{16}$/.test(role))await admin.unsafe('DROP ROLE '+role);
  await admin.end({timeout:5});
  assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('assortment-fixture-'));
  await fs.rm(dir,{recursive:true,force:true});
 }
});

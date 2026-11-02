'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomBytes}=require('node:crypto'),postgres=require('postgres');
const {quantity,normalizePricat}=require('./pricat-normalize.cjs');
const {importPricat}=require('./pricat-import.cjs');
const {readAvailableStocks}=require('./pricat-store.cjs');

test('quantity noise normalization is exact, bounded and preserves genuine precision',()=>{
 for(const [raw,expected]of [['5.049999999999999','5.05'],['0.8500000000000001','0.85'],['3.4999999999999996','3.5'],['13.700000000000001','13.7'],['34.04999999999999','34.05'],['17.300000000000015','17.3'],['0.12345678','0.12345678'],['100','100']])assert.equal(quantity(raw,'PartnerQTY').value,expected);
 for(const raw of ['17.300000000000020','1.234567891','1.23456789012345','-0.1','Infinity','1e-8','9999999999999.00000000000001','999999999999.1234567890123'])assert.throws(()=>quantity(raw,'PartnerQTY'));
 assert.equal(quantity('','QTY').value,null);assert.equal(quantity(undefined,'QTY').value,null);
 const r={SenderPrdCode:'test',UOM:'NMP',ItemsPerUnit:'100',RetailPrice:'200',RetailCurrency:'RUB',Price2:'100',SupOnhandDetail:{PartnerQTY:'5.049999999999999',PartnerUOM:'PCE'}};
 const n=normalizePricat(r,'PRICAT1',30,'RUB');assert.equal(n.stocks[0].quantity,'5.05');assert.equal(n.stocks[0].quantityRaw,'5.049999999999999');assert.equal(n.stocks[0].uom,'PCE');assert.equal(n.commercial.itemsPerUnit,'100');
});

test('full source replaces only its warehouses; quarantine/locks/rollback/source reuse remain safe',
 {skip:process.env.PRICAT_TEST_ISOLATED!=='1'||!process.env.PRICAT_TEST_ADMIN_URL,timeout:180000},async()=>{
 const admin=postgres(process.env.PRICAT_TEST_ADMIN_URL,{max:1,onnotice:()=>{}}),name='full_pricat_'+randomBytes(8).toString('hex');
 const url=new URL(process.env.PRICAT_TEST_ADMIN_URL);url.pathname='/'+name;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'full-pricat-'));let db,created=false;
 try{
  await admin.unsafe('CREATE DATABASE "'+name+'"');created=true;db=postgres(url.toString(),{max:1,onnotice:()=>{}});
  for(const entry of(await fs.readdir(path.resolve(__dirname,'../../prisma/migrations'))).sort())if(/^\d/.test(entry))await db.unsafe(await fs.readFile(path.resolve(__dirname,'../../prisma/migrations',entry,'migration.sql'),'utf8'));
  await db`INSERT INTO shop_settings(id,"protectiveMarkupPercent","updatedAt") VALUES(1,30,NOW())`;
  for(const code of ['stock1','stock2','stock3'])await db`INSERT INTO warehouses(code,name,"sortOrder") VALUES(${code},${code},1)`;
  for(const code of ['a','b','c','locked'])await db`INSERT INTO products("supplierCode",name,slug,"updatedAt") VALUES(${code},${code},${code},NOW())`;
  const detail=(code,qty='5',partner='7',uom='PCE')=>`<DocDetail><SenderPrdCode>${code}</SenderPrdCode><UOM>PCE</UOM><ItemsPerUnit>1</ItemsPerUnit><ItemsPerUOM>шт</ItemsPerUOM><RetailPrice>150</RetailPrice><RetailCurrency>RUB</RetailCurrency><Price2>100</Price2><QTY>${qty}</QTY><SupOnhandDetail><PartnerQTY>${partner}</PartnerQTY><PartnerUOM>${uom}</PartnerUOM></SupOnhandDetail></DocDetail>`;
  let number=0;
  const file=async(source,body)=>{const target=path.join(dir,source+'-'+(++number)+'.xml');await fs.writeFile(target,`<Document><DocType>PRICAT</DocType><Currency>RUB</Currency><DocumentDate>20261101010000</DocumentDate><DocumentNumber>fixture-${number}</DocumentNumber>${body}</Document>`);return{source,path:target};};
  const run=files=>importPricat({databaseUrl:url.toString(),mode:'production',files});
  const base1=await file('PRICAT1',['a','b','c','locked'].map(c=>detail(c)).join('')),base2=await file('PRICAT2',['a','b','c','locked'].map(c=>detail(c,'9')).join(''));
  await run([base1,base2]);
  const state=async()=>db`SELECT p."supplierCode" code,w.code warehouse,s.quantity,s.uom FROM product_stocks s JOIN products p ON p.id=s."productId" JOIN warehouses w ON w.id=s."warehouseId" ORDER BY p.id,w.code`;
  await db`UPDATE product_stocks SET "isLocked"=true WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='locked') AND source='PRICAT1'`;
  const next1=await file('PRICAT1',detail('a','','')+detail('c','11','12'));
  const beforeDry=JSON.stringify(await state());
  const dry=await importPricat({databaseUrl:url.toString(),mode:'dry-run',files:[next1,base2]});
  assert.equal(JSON.stringify(await state()),beforeDry);assert.equal(dry.zeroedPositiveStocks,4);
  const next=await run([next1,base2]);assert.equal(next.zeroedPositiveStocks,4);
  let stocks=await state();
  for(const r of stocks.filter(r=>['a','b'].includes(r.code)&&r.warehouse!=='stock2'))assert.equal(Number(r.quantity),0);
  assert.ok(stocks.filter(r=>r.warehouse==='stock2').every(r=>Number(r.quantity)===9));
  assert.ok(stocks.filter(r=>r.code==='locked'&&r.warehouse!=='stock2').every(r=>Number(r.quantity)>0));
  assert.deepEqual((await readAvailableStocks(db,['locked'])).map(r=>r.warehouse),['stock2']);
  const beforeRepeat=JSON.stringify(await state());assert.equal((await run([next1,base2])).status,'SKIPPED');assert.equal(JSON.stringify(await state()),beforeRepeat);
  const savedFirst=JSON.stringify((await state()).filter(r=>r.warehouse!=='stock2'));
  const next2=await file('PRICAT2',detail('c','13'));
  await run([next1,next2]);assert.equal(JSON.stringify((await state()).filter(r=>r.warehouse!=='stock2')),savedFirst);
  assert.ok((await state()).filter(r=>r.warehouse==='stock2'&&r.code!=='c').every(r=>Number(r.quantity)===0));
  const mismatch=await file('PRICAT1',detail('c','14','15','MTR')+detail('a','2','3')+detail('a','4','5'));
  await run([mismatch,next2]);assert.equal((await readAvailableStocks(db,['c'])).some(r=>r.warehouse==='stock3'),false);
  assert.ok((await db`SELECT quantity FROM product_stocks s JOIN products p ON p.id=s."productId" WHERE p."supplierCode"='a' AND s.source='PRICAT1'`).every(s=>s.quantity===null));
  const broken=await file('PRICAT1',detail('c'));await fs.appendFile(broken.path,'<broken>');
  const before=JSON.stringify(await state()),snapshot=JSON.stringify(await db`SELECT * FROM assortment_snapshots WHERE active`);
  await assert.rejects(run([broken,next2]));assert.equal(JSON.stringify(await state()),before);assert.equal(JSON.stringify(await db`SELECT * FROM assortment_snapshots WHERE active`),snapshot);
  const empty=await file('PRICAT1','');await assert.rejects(run([empty,next2]),/Empty full PRICAT/);assert.equal(JSON.stringify(await state()),before);
  const valid=await file('PRICAT1',detail('c','16','17'));
  await assert.rejects(importPricat({databaseUrl:url.toString(),mode:'production',files:[valid,next2],beforeSnapshotActivate:()=>{throw Error('fixture rollback');}}),/fixture rollback/);
  assert.equal(JSON.stringify(await state()),before);assert.equal(JSON.stringify(await db`SELECT * FROM assortment_snapshots WHERE active`),snapshot);
  assert.equal((await run([valid,next2])).status,'SUCCEEDED');
 }finally{if(db)await db.end({timeout:5});if(created)await admin.unsafe('DROP DATABASE "'+name+'"');await admin.end({timeout:5});await fs.rm(dir,{recursive:true});}
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {Readable}=require('node:stream');
const {randomBytes}=require('node:crypto');
const postgres=require('postgres');
const AdmZip=require('adm-zip');
const iconv=require('iconv-lite');
const {parseProdatXml}=require('./prodat.cjs');
const {readPricat}=require('./pricat.cjs');
const {normalizePricat,customerPrice}=require('./pricat-normalize.cjs');
const {importPricat,VERSION,LOCK}=require('./pricat-import.cjs');
const {readStorefrontPrices,readAvailableStocks,readSaleOffers}=require('./pricat-store.cjs');
const {connectionUrl}=require('./prodat-import.cjs');
require('dotenv').config({path:path.resolve(__dirname,'../../.env'),quiet:true});
const record=(code,extra='')=>`<DocDetail><SenderPrdCode>${code}</SenderPrdCode><UOM>PCE</UOM><ItemsPerUnit>1</ItemsPerUnit><Multiplicity/><QTY>5</QTY><RetailPrice>90.00</RetailPrice><RetailCurrency>rub</RetailCurrency><Price2>100.00</Price2><CustPrice>500.00</CustPrice><SupOnhandDetail><PartnerQTY>7</PartnerQTY><PartnerUOM>MTR</PartnerUOM><LastUpdDate>20260923</LastUpdDate></SupOnhandDetail>${extra}</DocDetail>`;
const xml=rows=>`<Document><DocType>PRICAT</DocType><Currency>RUB</Currency><DocumentNumber>test</DocumentNumber><DocumentDate>20261009010000</DocumentDate>${rows}</Document>`;
test('exact pricing and source mapping without conversion',async()=>{
  const [item]=await Array.fromAsync(parseProdatXml(Readable.from([Buffer.from(xml(record('a')))])));
  const a=normalizePricat(item.record,'PRICAT1','30.000','RUB');
  assert.equal(a.price.rawData.effectiveRetailPrice,'130.00');assert.equal(a.price.custPrice,'500.00');
  assert.equal(a.commercial.multiplicity,null);assert.equal(a.commercial.multiplicityRaw,'');
  assert.deepEqual(a.stocks.map(s=>[s.warehouse,s.quantity,s.uom]),[['stock1','5','PCE'],['stock3','7','MTR']]);
  const b=normalizePricat(item.record,'PRICAT2',30,'RUB');assert.deepEqual(b.stocks.map(s=>s.warehouse),['stock2']);
  assert.equal(customerPrice('0.01','0.05','30'),'0.07');
  assert.throws(()=>normalizePricat({...item.record,QTY:'-1'},'PRICAT1',30,'RUB'),/nonnegative/);
  assert.throws(()=>normalizePricat({...item.record,Multiplicity:['1','2']},'PRICAT1',30,'RUB'),/Ambiguous/);
  assert.throws(()=>normalizePricat({...item.record,RetailCurrency:'USD'},'PRICAT1',30,'RUB'),/currencies/);
});
test('ZIP Windows-1251 and strict XML failure',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pricat-unit-'));
  try {
    const zip=new AdmZip();zip.addFile('a.xml',iconv.encode('<?xml version="1.0" encoding="windows-1251"?>'+xml(record('а')),'windows-1251'));
    const file=path.join(dir,'a.zip');await fs.writeFile(file,zip.toBuffer());
    assert.equal((await Array.fromAsync(readPricat(file)))[0].record.SenderPrdCode,'а');
    await assert.rejects(Array.fromAsync(parseProdatXml(Readable.from([Buffer.from('<!DOCTYPE Document><Document/>')]))),/DOCTYPE/);
    await assert.rejects(Array.fromAsync(parseProdatXml(Readable.from([Buffer.from('<Document><DocDetail>')]))));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('isolated PostgreSQL publication, rollback, quarantine and recovery',{timeout:180000},async t=>{
  const adminUrl=connectionUrl(process.env.PRICAT_TEST_ADMIN_URL || process.env.DATABASE_URL);
  const admin=postgres(adminUrl,{max:1,onnotice:()=>{}});
  const name=`pricat_test_${process.pid}_${randomBytes(8).toString('hex')}`;
  const url=new URL(adminUrl);url.pathname='/'+name;
  let db,created=false;
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pricat-db-'));
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);created=true;
    db=postgres(url.toString(),{max:1,onnotice:()=>{}});
    const migrations=path.resolve(__dirname,'../../prisma/migrations');
    for(const entry of (await fs.readdir(migrations,{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))
      await db.unsafe(await fs.readFile(path.join(migrations,entry.name,'migration.sql'),'utf8'));
    await db`INSERT INTO shop_settings(id,"protectiveMarkupPercent","updatedAt") VALUES (1,30,NOW())`;
    for(const code of ['stock1','stock2','stock3'])await db`INSERT INTO warehouses(code,name,"sortOrder") VALUES (${code},${code},1)`;
    for(const code of ['a','b','c'])await db`INSERT INTO products("supplierCode",name,slug,"updatedAt") VALUES (${code},${code},${code},NOW())`;
    const file=async(name,rows)=>{const p=path.join(dir,name+'.xml');await fs.writeFile(p,xml(rows));return p;};
    const a=await file('a',record('a')+record('missing')+record('b'));
    const files=[{source:'PRICAT1',path:a},{source:'PRICAT2',path:await file('b',record('a'))}];
    const run=opts=>importPricat({databaseUrl:url.toString(),files,mode:'production',batchSize:1,...opts});
    await t.test('dry-run is read-only and agrees with production',async()=>{
      const dry=await run({mode:'dry-run'});assert.equal(dry.matchedProducts,3);assert.equal(dry.missingProducts,1);
      assert.equal((await db`SELECT count(*)::int n FROM import_runs`)[0].n,0);
      const result=await run();assert.equal(result.updatedRecords,3);
      assert.equal((await db`SELECT count(*)::int n FROM products`)[0].n,3);
      assert.equal((await db`SELECT count(*)::int n FROM product_stocks`)[0].n,5);
      const prices=await db`SELECT * FROM product_prices`;assert.ok(prices.every(p=>p.rawData.effectiveRetailPrice==='130.00' && p.retailPrice==='130.00' && p.rawData.RetailPrice==='90.00'));
      assert.equal((await db`SELECT count(*)::int n FROM import_issues WHERE code='MISSING_PRODUCT'`)[0].n,1);
    });
    await t.test('SHA repeat does not republish',async()=>{
      const before=JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`);
      assert.equal((await run()).status,'SKIPPED');assert.equal(JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`),before);
    });
    await t.test('conflicts quarantine stale stocks, retain all rows, other codes update',async()=>{
      const conflict=await file('conflict',record('a')+record('a').replace('<ItemsPerUnit>1','<ItemsPerUnit>100')+record('c'));
      const result=await run({files:[{source:'PRICAT1',path:conflict}]});assert.equal(result.status,'SUCCEEDED');assert.equal(result.conflictingCodes,1);assert.equal(result.updatedRecords,1);
      assert.equal((await db`SELECT count(*)::int n FROM import_issues WHERE "runId"=${result.runId} AND code='CONFLICTING_DUPLICATE'`)[0].n,2);
      const stocks=await db`SELECT s.* FROM product_stocks s JOIN products p ON p.id=s."productId" WHERE p."supplierCode"='a'`;
      assert.ok(stocks.filter(s=>s.source==='PRICAT1').every(s=>s.quantity===null));assert.equal(stocks.find(s=>s.source==='PRICAT2').quantity,'5.00000000');
    });
    await t.test('manual and locked prices, UOM mismatch, absent quantities preserved',async()=>{
      await db`UPDATE product_prices SET "isLocked"=true`;
      await db`UPDATE product_stocks SET source='MANUAL' WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='c')`;
      const stocks=JSON.stringify(await db`SELECT * FROM product_stocks WHERE source='MANUAL' ORDER BY id`);
      await run({files:[{source:'PRICAT1',path:await file('locks',record('c')+record('b').replace('<QTY>5</QTY>','<QTY/>').replace('<PartnerQTY>7</PartnerQTY>','<PartnerQTY/>'))}]});
      assert.equal(JSON.stringify(await db`SELECT * FROM product_stocks WHERE source='MANUAL' ORDER BY id`),stocks);
      assert.equal((await db`SELECT quantity FROM product_stocks WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='b') LIMIT 1`)[0].quantity,'5.00000000');
    });
    await t.test('malformed file fails audit without publication',async()=>{
      const broken=path.join(dir,'broken.xml');await fs.writeFile(broken,xml(record('b')).slice(0,-5));
      const before=JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`);
      await assert.rejects(run({files:[{source:'PRICAT1',path:broken}]}));
      assert.equal(JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`),before);
      assert.equal((await db`SELECT status FROM import_runs ORDER BY id DESC LIMIT 1`)[0].status,'FAILED');
    });
    await t.test('publication failure rolls back, abandoned runs recover, lock rejects concurrency',async()=>{
      const fresh=[{source:'PRICAT1',path:await file('fresh',record('b').replace('<QTY>5','<QTY>8'))}];
      const before=JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`);
      await assert.rejects(run({files:fresh,beforePublish:async()=>{await db`UPDATE warehouses SET "isArchived"=true WHERE code='stock1'`;throw new Error('injected');}}),/injected/);
      assert.equal(JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`),before);
      await db`UPDATE warehouses SET "isArchived"=false`;
      const [abandoned]=await db`INSERT INTO import_runs(type,status,"importerVersion") VALUES ('PRICAT','RUNNING',${VERSION}) RETURNING id`;
      await run({files:fresh});assert.equal((await db`SELECT status FROM import_runs WHERE id=${abandoned.id}`)[0].status,'FAILED');
      await db`SELECT pg_advisory_lock(${LOCK})`;
      try{await assert.rejects(run(),/Another PRICAT/);}finally{await db`SELECT pg_advisory_unlock(${LOCK})`;}
    });
    await t.test('rollback after first published batch is atomic and retry succeeds',async()=>{
      const fresh=[{source:'PRICAT1',path:await file('atomic',record('b').replace('<QTY>5','<QTY>9')+record('c'))}];
      const before=JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`);
      await assert.rejects(run({files:fresh,onProgress:p=>{if(p.phase==='publish')throw new Error('after batch');}}),/after batch/);
      assert.equal(JSON.stringify(await db`SELECT * FROM product_stocks ORDER BY id`),before);
      assert.equal((await run({files:fresh})).status,'SUCCEEDED');
    });
    await t.test('locked quarantined quantity excluded from availability, compatible UOM not merged',async()=>{
      await db`UPDATE product_stocks SET "isLocked"=true WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='b')`;
      const before=JSON.stringify(await db`SELECT * FROM product_stocks WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='b') ORDER BY id`);
      await run({files:[{source:'PRICAT1',path:await file('locked-conflict',record('b')+record('b').replace('<ItemsPerUnit>1','<ItemsPerUnit>100'))}]});
      assert.equal(JSON.stringify(await db`SELECT * FROM product_stocks WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='b') ORDER BY id`),before);
      assert.equal((await readAvailableStocks(db,['b'])).length,0);
      await db`UPDATE product_stocks SET "isLocked"=false WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='b')`;
      await run({files:[{source:'PRICAT1',path:await file('resolved',record('b').replace('<QTY>5','<QTY>12'))}]});
      assert.equal((await readAvailableStocks(db,['b'])).length,0); // old locked price is still quarantined
      await db`UPDATE product_prices SET "isLocked"=false WHERE "commercialDataId"=(SELECT c.id FROM product_commercial_data c JOIN products p ON p.id=c."productId" WHERE p."supplierCode"='b' AND c.source='PRICAT1')`;
      await run({files:[{source:'PRICAT1',path:path.join(dir,'resolved.xml')}],reprocess:true});
      assert.equal((await readAvailableStocks(db,['b'])).length,1); // partner MTR has no compatible price
      await db`UPDATE product_prices SET "isLocked"=true WHERE "commercialDataId"=(SELECT c.id FROM product_commercial_data c JOIN products p ON p.id=c."productId" WHERE p."supplierCode"='b' AND c.source='PRICAT1')`;
      const previous=JSON.stringify(await db`SELECT * FROM product_stocks WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='b') ORDER BY id`);
      const mismatch=await run({files:[{source:'PRICAT1',path:await file('uom-mismatch',record('b').replace('<UOM>PCE','<UOM>MTR').replace('<PartnerUOM>MTR','<PartnerUOM>PCE'))}]});
      assert.equal(mismatch.protectedRecords,3); // price remained locked and both stocks retained
      assert.equal(JSON.stringify(await db`SELECT * FROM product_stocks WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='b') ORDER BY id`),previous);
    });
    await t.test('source mutation and older snapshots rejected before publication',async()=>{
      const mutation=await file('mutation',record('c'));
      await assert.rejects(run({files:[{source:'PRICAT1',path:mutation}],beforePublish:async()=>fs.appendFile(mutation,' ')}),/changed before publication/);
      const old=path.join(dir,'old.xml');await fs.writeFile(old,xml(record('c')).replace('20261009010000','20260909010000'));
      await assert.rejects(run({files:[{source:'PRICAT1',path:old}]}),/Older PRICAT/);
    });
    await t.test('identical rows collapse, empty vs one preserved, settings invalidate SHA cache',async()=>{
      await db`UPDATE product_prices SET "isLocked"=false`;
      const repeated=[{source:'PRICAT2',path:await file('identical',record('c')+record('c'))}];
      const first=await run({files:repeated});assert.equal(first.identicalDuplicates,1);assert.equal(first.updatedRecords,1);
      const [empty]=await db`SELECT multiplicity,"multiplicityRaw" FROM product_commercial_data WHERE source='PRICAT2' AND "productId"=(SELECT id FROM products WHERE "supplierCode"='c')`;
      assert.equal(empty.multiplicity,null);assert.equal(empty.multiplicityRaw,'');
      await db`UPDATE shop_settings SET "protectiveMarkupPercent"=12.345`;
      assert.equal((await run({files:repeated})).status,'SUCCEEDED');
      const [price]=await db`SELECT p."retailPrice" FROM product_prices p JOIN product_commercial_data c ON c.id=p."commercialDataId" WHERE c.source='PRICAT2' AND c."productId"=(SELECT id FROM products WHERE "supplierCode"='c')`;
      assert.equal(price.retailPrice,'112.35');
      await run({files:[{source:'PRICAT2',path:await file('one',record('c').replace('<Multiplicity/>','<Multiplicity>1</Multiplicity>'))}]});
      const [one]=await db`SELECT multiplicity,"multiplicityRaw" FROM product_commercial_data WHERE source='PRICAT2' AND "productId"=(SELECT id FROM products WHERE "supplierCode"='c')`;
      assert.equal(one.multiplicity,'1.0000000000');assert.equal(one.multiplicityRaw,'1');
      const again=await run({files:repeated,reprocess:true});assert.equal(again.status,'SUCCEEDED');
    });
    await t.test('one storefront price: PRICAT2 then PRICAT1, independent of warehouse availability',async()=>{
      for(const code of ['offer','no-price','zero-price','no-cost','currency','partner'])
        await db`INSERT INTO products("supplierCode",name,slug,"updatedAt") VALUES (${code},${code},${code},NOW())`;
      await db`UPDATE shop_settings SET "protectiveMarkupPercent"=30`;
      const first=record('offer').replace('<RetailPrice>90.00','<RetailPrice>150.00')+record('no-price').replace('<RetailPrice>90.00</RetailPrice>','<RetailPrice/>')
        +record('zero-price').replace('<RetailPrice>90.00','<RetailPrice>0.00').replace('<Price2>100.00','<Price2>0.00')
        +record('no-cost').replace('<Price2>100.00</Price2>','<Price2/>')+record('currency')+record('partner');
      const second=record('offer').replace('<RetailPrice>90.00','<RetailPrice>120.00').replace('<Price2>100.00','<Price2>200.00');
      await run({files:[{source:'PRICAT1',path:await file('offers1',first)},{source:'PRICAT2',path:await file('offers2',second)}]});
      const [primary]=await readSaleOffers(db,['offer']);
      assert.equal(primary.priceSource,'PRICAT2');assert.equal(primary.retailPrice,'260.00');assert.deepEqual(primary.stocks.map(s=>s.warehouse),['stock1','stock2']);
      await db`UPDATE product_stocks SET quantity=0 WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='offer') AND source='PRICAT2'`;
      const [zeroStock2]=await readSaleOffers(db,['offer']);assert.equal(zeroStock2.priceSource,'PRICAT2');assert.equal(zeroStock2.retailPrice,'260.00');
      assert.deepEqual(zeroStock2.stocks.map(s=>s.warehouse),['stock1']);
      await db`UPDATE product_stocks SET quantity=0 WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='offer')`;
      assert.equal((await readStorefrontPrices(db,['offer']))[0].priceSource,'PRICAT2');assert.equal((await readSaleOffers(db,['offer'])).length,0);
      await db`UPDATE product_stocks SET quantity=5 WHERE "productId"=(SELECT id FROM products WHERE "supplierCode"='offer')`;
      await db`UPDATE shop_settings SET "protectiveMarkupPercent"=40`;
      assert.equal((await readSaleOffers(db,['offer']))[0].retailPrice,'280.00');
      await db`UPDATE shop_settings SET "protectiveMarkupPercent"=30`;
      assert.equal((await readAvailableStocks(db,['no-price','zero-price','no-cost'])).length,0);
      await db`UPDATE product_prices SET currency='USD',"retailCurrency"='USD' WHERE "commercialDataId" IN (SELECT c.id FROM product_commercial_data c JOIN products p ON p.id=c."productId" WHERE p."supplierCode"='currency')`;
      assert.equal((await readAvailableStocks(db,['currency'])).length,0);
      const partner=await readAvailableStocks(db,['partner']);assert.deepEqual(partner.map(s=>s.warehouse),['stock1']);
      await db`UPDATE product_prices SET "retailPrice"=NULL WHERE "commercialDataId" IN (SELECT c.id FROM product_commercial_data c JOIN products p ON p.id=c."productId" WHERE p."supplierCode"='offer' AND c.source='PRICAT2')`;
      const [fallback]=await readSaleOffers(db,['offer']);assert.equal(fallback.priceSource,'PRICAT1');assert.equal(fallback.retailPrice,'150.00');
      assert.deepEqual(fallback.stocks.map(s=>s.warehouse),['stock1','stock2']); // stock2 doesn't need its own sale price
    });
    await t.test('manual price precedes PRICAT, invalid prices excluded, locked values preserved',async()=>{
      const [p]=await db`SELECT id FROM products WHERE "supplierCode"='offer'`;
      const [manual]=await db`INSERT INTO product_commercial_data("productId",source,uom,"updatedAt") VALUES (${p.id},'MANUAL','PCE',NOW()) RETURNING id`;
      await db`INSERT INTO product_prices("commercialDataId","retailPrice",currency,"retailCurrency","updatedAt") VALUES (${manual.id},300,'RUB','RUB',NOW())`;
      const before=JSON.stringify(await db`SELECT * FROM product_prices WHERE "commercialDataId"=${manual.id}`);
      const allBefore=JSON.stringify(await db`SELECT * FROM product_commercial_data WHERE id=${manual.id}`);
      await run({files:[{source:'PRICAT1',path:await file('manual-offer',record('offer').replace('<QTY>5','<QTY>17'))}]});
      assert.equal(JSON.stringify(await db`SELECT * FROM product_prices WHERE "commercialDataId"=${manual.id}`),before);
      assert.equal(JSON.stringify(await db`SELECT * FROM product_commercial_data WHERE id=${manual.id}`),allBefore);
      assert.equal((await db`SELECT quantity FROM product_stocks s JOIN warehouses w ON w.id=s."warehouseId" WHERE s."productId"=${p.id} AND w.code='stock1'`)[0].quantity,'17.00000000');
      const [offer]=await readSaleOffers(db,['offer']);
      assert.equal(offer.priceSource,'MANUAL');assert.equal(offer.retailPrice,'300.00');
      await db`UPDATE product_prices SET "retailPrice"=0 WHERE "commercialDataId"=${manual.id}`;
      assert.equal((await readSaleOffers(db,['offer']))[0].priceSource,'PRICAT1');
      await db`UPDATE product_prices SET "retailPrice"=90,"isLocked"=true WHERE "commercialDataId"=(SELECT c.id FROM product_commercial_data c JOIN products p ON p.id=c."productId" WHERE p."supplierCode"='partner' AND c.source='PRICAT1')`;
      const lockedBefore=JSON.stringify(await db`SELECT * FROM product_prices WHERE "isLocked" ORDER BY id`);
      const [protectedOffer]=await readAvailableStocks(db,['partner']);assert.equal(protectedOffer.retailPrice,'130.00');
      assert.equal(JSON.stringify(await db`SELECT * FROM product_prices WHERE "isLocked" ORDER BY id`),lockedBefore);
    });
    await t.test('42 synthetic conflicting codes quarantined across 59 source/code pairs, including locked stock and SHA repeat',async()=>{
      const codes=Array.from({length:42},(_,i)=>'quarantine-'+String(i).padStart(2,'0'));
      await db`INSERT INTO products("supplierCode",name,slug,"updatedAt") SELECT code,code,code,NOW() FROM unnest(${db.array(codes)}) AS code`;
      await run({batchSize:17,files:[{source:'PRICAT1',path:await file('q-base1',codes.map(c=>record(c)).join(''))},{source:'PRICAT2',path:await file('q-base2',codes.map(c=>record(c)).join(''))}]});
      await db`UPDATE product_stocks SET "isLocked"=true WHERE "productId" IN (SELECT id FROM products WHERE "supplierCode" IN ${db(codes.filter((_,i)=>i%2===0))})`;
      const q1=codes.slice(0,30),q2=codes.slice(13);
      const variants=cs=>cs.map(c=>record(c)+record(c).replace('<ItemsPerUnit>1','<ItemsPerUnit>100')).join('');
      const conflicts=[{source:'PRICAT1',path:await file('q-conflict1',variants(q1))},{source:'PRICAT2',path:await file('q-conflict2',variants(q2))}];
      const result=await run({batchSize:17,files:conflicts});assert.equal(result.conflictingCodes,59);
      assert.equal((await db`SELECT count(*)::int n FROM import_issues WHERE "runId"=${result.runId} AND code='CONFLICTING_DUPLICATE'`)[0].n,118);
      const assertQuarantine=async()=>{for(const stock of await readAvailableStocks(db,codes))assert.ok(!(stock.source==='PRICAT1'?q1:q2).includes(stock.supplierCode));};
      await assertQuarantine();assert.equal((await run({files:conflicts})).status,'SKIPPED');await assertQuarantine();
    });
    t.diagnostic(`Isolated database ${name}`);
  }finally {
    if(db)await db.end({timeout:5});
    if(created && /^pricat_test_\d+_[a-f0-9]{16}$/.test(name) && new URL(adminUrl).pathname!=='/'+name)await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end({timeout:5});await fs.rm(dir,{recursive:true,force:true});
  }
});

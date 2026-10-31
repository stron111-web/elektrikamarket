'use strict';
const assert = require('node:assert/strict');
const postgres = require('postgres');
require('dotenv').config({path:require('node:path').resolve(__dirname,'../../.env'),quiet:true});
const { connectionUrl } = require('../../scripts/import/prodat-import.cjs');
const { readStorefrontPrices,readAvailableStocks } = require('../../scripts/import/pricat-store.cjs');
const db=postgres(connectionUrl(process.env.DATABASE_URL),{max:1,connection:{default_transaction_read_only:'on'}});
const base=process.env.STOREFRONT_TEST_URL||'http://127.0.0.1:3000';
const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(Number(n));
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;');
const units={PCE:'шт.',MTR:'м',NMP:'уп.',KGM:'кг',KMT:'км',MTK:'м²'};
async function html(route,status=200){const r=await fetch(base+route);assert.equal(r.status,status,route);const s=(await r.text()).replace(/<!--.*?-->/gs,'');assert(!/purchasePrice|DATABASE_URL|postgresql:\/\//.test(s));return s;}
(async()=>{try{
 const products=await db.unsafe('SELECT p."supplierCode",p.slug,p.name FROM products p JOIN assortment_items a ON a."productId"=p.id JOIN assortment_snapshots s ON s.id=a."snapshotId" WHERE s.active ORDER BY p.id LIMIT 20');
 const codes=products.map(p=>p.supplierCode),prices=await readStorefrontPrices(db,codes),stocks=await readAvailableStocks(db,codes);
 for(const p of products){
  const s=await html('/product/'+p.slug),price=prices.find(x=>x.supplierCode===p.supplierCode);
  assert(s.includes(esc(p.name)));assert(s.includes(money(price.retailPrice)));
  for(const w of ['stock1','stock2','stock3']){
   const stock=stocks.find(x=>x.supplierCode===p.supplierCode&&x.warehouse===w);
   const text=stock?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:8}).format(Number(stock.quantity))+' '+(units[stock.uom]||stock.uom):'Нет доступного остатка';
   assert(s.includes('<dt>'+w+'</dt><dd>'+text+'</dd>'));
  }
  console.log('PASS snapshot product '+p.supplierCode);
 }
 const first=await html('/catalog'),second=await html('/catalog?page=2');
 const count=s=>(s.match(/class="product-card"/g)||[]).length;
 assert.equal(count(first),24);assert.equal(count(second),24);
 assert(!first.includes('Все товары'));assert(!first.includes('availability-switch'));assert(!first.includes('name="availability"'));
 const ids=s=>[...s.matchAll(/class="card-name" href="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids(first).length,24);
 for(const query of ['availability=all','availability=all&diagnostics=1&all=true&snapshotId=invalid','availability=stock&availability=all']){
  const response=await html('/catalog?'+query);assert.deepEqual(ids(response),ids(first));
  assert.equal(response.match(/Найдено:[\s\S]*?<b>(.*?)<\/b>/)?.[1],first.match(/Найдено:[\s\S]*?<b>(.*?)<\/b>/)?.[1]);
 }
 assert(!first.includes('availability='));
 assert((await html('/catalog?q='+encodeURIComponent(products[0].supplierCode))).includes(esc(products[0].name)));
 assert((await html('/catalog?q=no-such-product-xyz')).includes('Товары не найдены'));
 assert((await html('/catalog?category=no-such-category')).includes('Товары не найдены'));
 await html('/product/not-a-real-product',404);
 const conflicts=await db.unsafe("SELECT DISTINCT p.\"supplierCode\",p.slug FROM import_issues i JOIN import_files f ON f.id=i.\"fileId\" JOIN import_runs r ON r.id=f.\"runId\" JOIN products p ON p.\"supplierCode\"=i.\"supplierCode\" WHERE i.code IN ('CONFLICTING_DUPLICATE','INVALID_RECORD','COMMERCIAL_UNIT_CONFLICT','STOCK_UOM_CONFLICT') AND f.status='SUCCEEDED' AND r.status='SUCCEEDED' LIMIT 10");
 const allowed=await readAvailableStocks(db,conflicts.map(p=>p.supplierCode));
 for(const p of conflicts)if(!allowed.some(s=>s.supplierCode===p.supplierCode))assert(!(await html('/catalog?q='+encodeURIComponent(p.supplierCode))).includes('/product/'+p.slug));
 console.log('PASS snapshot HTTP catalog/search/pagination/404, public all disabled, quarantine, no purchase price in HTML');
}finally{await db.end({timeout:5});}})().catch(e=>{console.error(e.message);process.exitCode=1;});

'use strict';
// Read-only integration checks against the running local web server and real DB.
const assert = require('node:assert/strict');
const postgres = require('postgres');
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env'), quiet: true });
const { connectionUrl } = require('../../scripts/import/prodat-import.cjs');
const { readStorefrontPrices, readAvailableStocks } = require('../../scripts/import/pricat-store.cjs');
const codes = ['82066','53669','50619','202701','209687','257359','51024','51049','267297','124939','295756','389802','1062160','87886','48982','217912','340851','416848','91373','82031'];
const base = process.env.STOREFRONT_TEST_URL || 'http://127.0.0.1:3000';
const db = postgres(connectionUrl(process.env.DATABASE_URL), { max: 1, connection: { default_transaction_read_only: 'on' } });
const money = n => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(n));
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;');
async function html(url, status = 200) { const r = await fetch(base + url); assert.equal(r.status, status, url); return (await r.text()).replace(/<!--.*?-->/gs,''); }
(async () => { try {
  await db.begin('isolation level repeatable read read only', async tx => {
    const rows = await tx`SELECT "supplierCode",slug,name,"vendorNumber","brandId" FROM products WHERE "supplierCode" IN ${tx(codes)}`;
    assert.equal(rows.length,20);
    const prices = await readStorefrontPrices(tx,codes), stocks = await readAvailableStocks(tx,codes);
    for (const p of rows) {
      const page = await html('/product/'+p.slug), price = prices.find(x=>x.supplierCode===p.supplierCode);
      assert(page.includes(escape(p.name)), 'full product name');
      assert(page.includes(money(price.retailPrice)), 'authoritative price '+p.supplierCode);
      assert(page.includes('Код: '+p.supplierCode));
      const units={PCE:'шт.',MTR:'м',NMP:'уп.',KGM:'кг',KMT:'км',MTK:'м²'};
      for(const warehouse of ['stock1','stock2','stock3']) {
        const stock=stocks.find(s=>s.supplierCode===p.supplierCode&&s.warehouse===warehouse);
        const expected=stock ? `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:8}).format(Number(stock.quantity))} ${units[stock.uom]??stock.uom}` : 'Нет доступного остатка';
        assert(page.includes(`<dt>${warehouse}</dt><dd>${expected}</dd>`), 'warehouse sale projection '+p.supplierCode+' '+warehouse);
      }
      if(price.uom==='NMP') assert(page.includes('Упаковки не делятся.'));
      assert(!page.includes('postgresql://') && !page.includes('DATABASE_URL'), 'no database configuration in HTML');
      console.log('PASS product '+p.supplierCode+' '+price.uom);
    }
    const first = await html('/catalog'); assert.equal((first.match(/class="product-card"/g)||[]).length,24);
    const second = await html('/catalog?page=2'); assert.equal((second.match(/class="product-card"/g)||[]).length,24); assert.notEqual(first.match(/href="\/product\/[^\"]+/)?.[0],second.match(/href="\/product\/[^\"]+/)?.[0]);
    for(const term of [rows[0].supplierCode,rows[0].vendorNumber]) { const page=await html('/catalog?q='+encodeURIComponent(term));assert(page.includes(escape(rows[0].name))); }
    assert((await html('/catalog?q=definitely-no-such-product-xyz')).includes('Товары не найдены'));
    assert((await html('/catalog?q=%27%3BSELECT%201%3B--')).includes('Товары не найдены'));
    assert((await html('/catalog?category=nonexistent-category')).includes('Товары не найдены'));
    const [{slug,id:categoryId}] = await tx`SELECT slug,id FROM categories WHERE name='Розетки' LIMIT 1`;
    const slugs = page => [...new Set([...page.matchAll(/href="\/product\/([^"?]+)/g)].map(m=>decodeURIComponent(m[1])))];
    const categoryPage=await html('/catalog?category='+encodeURIComponent(slug));
    const categoryProducts=await tx`SELECT "categoryId" FROM products WHERE slug IN ${tx(slugs(categoryPage))}`;
    assert.equal(categoryProducts.length,24);assert(categoryProducts.every(p=>p.categoryId===categoryId),'category filter');
    const [{id}] = await tx`SELECT id FROM brands WHERE name='IEK'`;
    const brandPage=await html('/catalog?brand='+id);
    const brandProducts=await tx`SELECT "brandId" FROM products WHERE slug IN ${tx(slugs(brandPage))}`;
    assert.equal(brandProducts.length,24);assert(brandProducts.every(p=>p.brandId===id),'brand filter');
    await html('/product/not-a-real-product',404);
    const conflicts=await tx`SELECT DISTINCT p."supplierCode",p.slug FROM import_issues i JOIN import_files f ON f.id=i."fileId" JOIN import_runs r ON r.id=f."runId" JOIN products p ON p."supplierCode"=i."supplierCode" WHERE i.code IN ('CONFLICTING_DUPLICATE','INVALID_RECORD') AND f.status='SUCCEEDED' AND r.status='SUCCEEDED' LIMIT 10`;
    assert(conflicts.length>0);
    const conflictStocks=await readAvailableStocks(tx,conflicts.map(p=>p.supplierCode));
    for(const p of conflicts){const page=await html('/product/'+p.slug);for(const warehouse of ['stock1','stock2','stock3'])if(!conflictStocks.some(s=>s.supplierCode===p.supplierCode&&s.warehouse===warehouse))assert(page.includes(`<dt>${warehouse}</dt><dd>Нет доступного остатка</dd>`),'quarantine not published');}
    console.log('PASS quarantine projection for '+conflicts.length+' real products');
    console.log('PASS catalog pagination, search, category, brand, missing product');
  });
} finally { await db.end({timeout:5}); } })().catch(e=>{console.error(e);process.exitCode=1;});

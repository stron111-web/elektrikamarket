'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseCatalogFilters:parse,catalogHref}=require('./filters.cjs');
test('price bounds are validated as exact decimal strings, not floats',()=>{
 assert.equal(parse({minPrice:'00012,30'}).minPrice,'12.30');
 for(const x of ['-1','Infinity','1e3','0.001',"1; SELECT 1",'99999999999'])assert.equal(parse({minPrice:x}).minPrice,'');
 assert.equal(parse({maxPrice:'0'}).maxPrice,'0');
});
test('untrusted URL input cannot select arbitrary warehouses or identifiers',()=>{
 assert.equal(parse({stock:'stock1'}).stock,'stock1');assert.equal(parse({stock:'stock4'}).stock,'');
 assert.equal(parse({brand:'1 OR 1=1',page:'-4',q:['bad']}).brand,0);
 assert.equal(parse({page:'99999999'}).page,1);assert.equal(parse({q:'x'.repeat(200)}).q.length,120);
});
test('pagination keeps all active filters and resets only the page requested',()=>{
 const f=parse({category:'leaf',brand:'5',stock:'stock1',minPrice:'10',maxPrice:'20',q:'кабель'});
 const u=new URL(catalogHref(f,{page:2}),'https://test.invalid');
 assert.equal(u.searchParams.get('page'),'2');for(const k of ['brand','stock','minPrice','maxPrice','category','q'])assert.equal(u.searchParams.get(k),String(f[k]));
 assert.equal(catalogHref({...f,category:''},{page:1}).includes('page='),false);
});

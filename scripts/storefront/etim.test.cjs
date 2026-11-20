'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseEtim,token,etimTokens,LIMITS}=require('./etim.cjs');
const {parseCatalogFilters:parse,catalogHref}=require('./filters.cjs');
const {etimRequest,featureIdentity}=require('./etim.cjs');
const t=(v='16',uom='А',name='Номинальный ток')=>token('EF000227',name,uom,v);
test('ETIM is bound to its category and reset by navigation',()=>{
 assert.deepEqual(parseEtim({etimCategory:'old',etim:t()},'new'),[]);
 const f=parse({category:'leaf',etimCategory:'leaf',etim:t()});assert.equal(f.etim.length,1);
 const u=new URL(catalogHref(f,{category:'other'}),'https://test.invalid');assert.equal(u.searchParams.has('etim'),false);
});
test('OR values deduplicate within an identity, unlike units/names stay separate',()=>{
 const f=parseEtim({etimCategory:'leaf',etim:[t(),t(),t('20'),t('16','мА'),t('16','А','Номинальный ток с')]},'leaf');
 assert.equal(f.length,3);assert.deepEqual(f[0].values,['16','20']);
});
test('malformed and oversized entries are ignored, no SQL syntax comes from URL',()=>{
 assert.deepEqual(parseEtim({etimCategory:'leaf',etim:['bad','{}','[1,2,3,4]',token(null,'x',null,'x'.repeat(257))]},'leaf'),[]);
 assert.deepEqual(parseEtim({etimCategory:'leaf',etim:Array(65).fill(t())},'leaf'),[]);
 const s="'; DROP TABLE products; --";assert.equal(parseEtim({etimCategory:'leaf',etim:t(s)},'leaf')[0].values[0],s);
});
test('property and value counts are bounded',()=>{
 const values=Array.from({length:30},(_,i)=>t(String(i)));assert.equal(parseEtim({etimCategory:'leaf',etim:values},'leaf')[0].values.length,LIMITS.values);
 const props=Array.from({length:20},(_,i)=>t('1','А','Ток '+i));assert.equal(parseEtim({etimCategory:'leaf',etim:props},'leaf').length,LIMITS.properties);
});
test('pagination and sorting round-trip repeated ETIM parameters and all filters',()=>{
 const f=parse({category:'leaf',etimCategory:'leaf',etim:[t('16'),t('20')],brand:'5',stock:'stock1',minPrice:'10',sort:'price_desc',q:'автомат'});
 const u=new URL(catalogHref(f,{page:2,sort:'quantity_desc'}),'https://test.invalid');
 const restored=parse({...Object.fromEntries(u.searchParams),etim:u.searchParams.getAll('etim')});
 assert.deepEqual(restored.etim,f.etim);assert.equal(restored.page,2);assert.equal(restored.stock,'stock1');assert.equal(restored.sort,'quantity_desc');assert.equal(etimTokens(restored.etim).length,2);
});
test('whitespace is normalized but decimals, ranges and units are not guessed',()=>{
 const f=parseEtim({etimCategory:'leaf',etim:[t('  10   м  '),t('0'),t('.1'),t('10,5')]},'leaf');
 assert.deepEqual(f[0].values,['10 м','0','.1','10,5']);
});
test('lazy requests are category/snapshot scoped, bounded and validate identities',()=>{
 assert.equal(etimRequest({category:'leaf',snapshot:'13',offset:'60'}).offset,60);
 for(const offset of ['-1','Infinity','1;SELECT','999999'])assert.throws(()=>etimRequest({category:'leaf',snapshot:'13',offset}));
 assert.throws(()=>etimRequest({category:'',snapshot:'13'}));assert.throws(()=>etimRequest({category:'leaf',snapshot:'x'}));
 assert.equal(featureIdentity('[1,2,3]'),null);assert.deepEqual(featureIdentity('[null,"Материал",null]'),{code:null,name:'Материал',uom:null});
 assert.throws(()=>etimRequest({category:'leaf',snapshot:'13',feature:'{}'}));
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {productFeatures,duplicateBasic}=require('../lib/product-features.cjs');
const row=(name,value,code='EF000001',uom=null)=>({featureName:name,featureValue:value,featureCode:code,featureUom:uom});
test('all real characteristics survive beyond initial disclosure, including zero and No',()=>{
 const input=Array.from({length:45},(_,i)=>row('Свойство '+i,String(i),'EF'+i));input.push(row('Диммирование','Нет'));
 assert.equal(productFeatures(input).length,46);assert.ok(productFeatures(input).some(f=>f.values.includes('0')));
});
test('exact duplicates collapse, codes and units keep separate identities and range endpoints',()=>{
 const f=productFeatures([row('Ток','16','A','А'),row('Ток','16','A','А'),row('Ток','20','A','А'),row('Ток','16','B','А'),row('Ток','16','A','мА'),row('Ток с','10'),row('Ток по','20')]);
 assert.equal(f.length,5);assert.deepEqual(f.find(x=>x.code==='A'&&x.uom==='А').values,['16','20']);
});
test('empty and technical payloads do not turn into invented values',()=>{
 assert.deepEqual(productFeatures([row('','12'),row('Вес','  '),row('Raw','{"x":1}'),row('Raw','[1,2]'),row('EF00001','42')]),[]);
 assert.equal(productFeatures([row('Сечение','2.5','A','кв.мм'),row('Температура','-25..+40')]).length,2);
});
test('basic deduplication requires same label and exact value/unit, no unit conversion',()=>{
 const f=productFeatures([row('Ширина','8','A','мм')]);
 assert.equal(duplicateBasic('Ширина','8 мм',f),true);assert.equal(duplicateBasic('Ширина','0.8 см',f),false);assert.equal(duplicateBasic('Глубина','8 мм',f),false);
});

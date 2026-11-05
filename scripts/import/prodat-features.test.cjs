'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeFeatures}=require('./prodat-features.cjs');
const n=features=>normalizeFeatures({FeatureETIMDetails:{FeatureETIM:features}});
const f=(FeatureCode='EF001',FeatureValue='0')=>({FeatureCode,FeatureName:'Название',FeatureValue,FeatureUom:'мм'});
test('ETIM keeps codes, text precision, zero, units, order and stable identity',()=>{
 const a=n([f('0001','0'),f('EF002','001.2300'),f('EF003','Нет')]);
 assert.equal(a.rows[0].featureValue,'0');assert.equal(a.rows[1].featureValue,'001.2300');assert.equal(a.rows[2].sortOrder,2);assert.equal(a.rows[0].featureUom,'мм');
 assert.equal(a.rows[0].identityKey,n(f('0001','Новое')).rows[0].identityKey);
});
test('ETIM empty values are counted, never materialized or interpreted as deletion',()=>{
 assert.equal(normalizeFeatures({}).rows.length,0);const a=n([f('A',''),f('B','  '),f('C','0')]);assert.equal(a.rows.length,1);assert.equal(a.stats.emptyEntries,2);
});
test('ETIM identical duplicates collapse; conflicting duplicates or ambiguous structures fail closed',()=>{
 assert.equal(n([f(),f()]).stats.duplicateEntries,1);
 assert.throws(()=>n([f(),f('EF001','1')]),{code:'FEATURE_STRUCTURE'});
 for(const bad of [{...f(),FeatureValue:['a','b']},{...f(),FeatureCode:''},{...f(),Extra:'x'}])assert.throws(()=>n(bad),{code:'FEATURE_STRUCTURE'});
});

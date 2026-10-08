'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {slugify,planSlugs,technicalSlug,hash}=require('./prodat-slug.cjs');
const {buildPlan,initialProvenance,repairSlugs}=require('./prodat-repair-slugs.cjs');
const row=(identity,name)=>({identity,name});
test('explicit Russian transliteration, Latin accents, Unicode equivalence and punctuation',()=>{
  assert.equal(slugify('Ёж, Йод, Щит — съёмный; ЮЯ ХЦ ЧШ ЫЭ'),'yozh-yod-shchit-syomnyy-yuya-khts-chsh-ye');
  assert.equal(slugify('Crème BRÛLÉE / ABB 16A'),'creme-brulee-abb-16a');
  assert.equal(slugify('Е\u0308ж'),slugify('Ёж')); assert.equal(slugify('  A___B  '),'a-b');
  assert.equal(slugify('!!!'),''); assert.equal(slugify('A'.repeat(121)).length,120);
});
test('collision suffixes use supplierCode or sourceKey; result independent of row order',()=>{
  for(const [kind,rows,expected] of [
    ['product',[row('002','Товар'),row('001','Товар')],['tovar-001','tovar-002']],
    ['category',[row('rsv:catalog:L2:1','Щиты'),row('rsv:catalog:L3:2','Щиты')],['shchity-rsv-catalog-l2-1','shchity-rsv-catalog-l3-2']],
  ]) {
    const plan=planSlugs(kind,rows); assert.deepEqual(plan.rows.map(r=>r.proposed),expected);
    assert.deepEqual(planSlugs(kind,rows.toReversed()),plan);
  }
});
test('brand homographs remain distinct with stable identity digests',()=>{
  const plan=planSlugs('brand',[row('ERA','ERA'),row('Эра','Эра')]);
  assert.deepEqual(plan.rows.map(r=>r.proposed),['era-'+hash('ERA').slice(0,12),'era-'+hash('Эра').slice(0,12)]);
});
test('existing/manual slugs reserved; candidates never rename prior winners',()=>{
  const existing=[{slug:'tovar',identity:'old'}];
  assert.equal(planSlugs('product',[row('2','Товар')],existing).rows[0].proposed,'tovar-2');
  assert.equal(existing[0].slug,'tovar');
});
test('second-order and identity-normalization collisions have deterministic fallback',()=>{
  const candidates=[row('a/b','Item'),row('a b','Item'),row('3','Item-a-b')];
  const plan=planSlugs('product',candidates);
  assert.equal(new Set(plan.rows.map(r=>r.proposed)).size,3);
  assert.ok(plan.rows.some(r=>r.fallback));
  assert.deepEqual(planSlugs('product',candidates.toReversed()),plan);
});
test('empty names, truncation collisions and final collision refusal',()=>{
  assert.equal(planSlugs('product',[row('1','!!!')]).rows[0].proposed,'product-1');
  const plan=planSlugs('product',[row('1','x'.repeat(130)+'a'),row('2','x'.repeat(130)+'b')]);
  assert.equal(plan.stats.suffixed,2);
  assert.throws(()=>planSlugs('product',[row('1','Item')],[{slug:'item'},{slug:'item-1'},{slug:'item-1-'+hash('1')}] ),/Unresolved/);
  assert.throws(()=>planSlugs('product',[row('1','A'),row('1','B')]),/Duplicate/);
});
test('repair accepts exact legacy hash only, skips manual/locked/noninitial values',()=>{
  const state={product:[
    {...row('1','One'),id:1,slug:technicalSlug('product','1'),initial:true},
    {...row('2','Two'),id:2,slug:'manual',initial:true},
    {...row('3','Three'),id:3,slug:technicalSlug('product','3'),initial:true,lockedFields:['slug']},
    {...row('4','Four'),id:4,slug:technicalSlug('product','4'),initial:false},
    {...row('5','Five'),id:5,slug:'product-'+'a'.repeat(64),initial:true},
  ],brand:[],category:[]};
  const plan=buildPlan(state);assert.equal(plan.plans.product.length,1);assert.equal(plan.plans.product[0].proposed,'one');
});
test('repair rejects unverified provenance and apply without reviewed plan',async()=>{
  assert.throws(()=>initialProvenance([],[]),/Initial/);
  await assert.rejects(repairSlugs({dryRun:false}),/expected-plan/);
});

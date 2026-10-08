'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBarcodes,validGtinChecksum}=require('./prodat-barcodes.cjs');
const a='04600572029629', b='03245060104115';
const ean=(Value,Description)=>({Value,Description});
test('missing/empty EAN yields no barcodes',()=>{
  for(const value of [undefined,''])assert.deepEqual(normalizeBarcodes(value),{rows:[],issues:[],stats:{entries:0,empty:0,duplicates:0}});
});
test('single and multiple EAN pair descriptions by index, keep source order and leading zero',()=>{
  assert.deepEqual(normalizeBarcodes(ean(a,'Unit')).rows,[{barcode:a,type:'Unit',sortOrder:0}]);
  const value=normalizeBarcodes(ean([a,b],['Unit','Box']));
  assert.deepEqual(value.rows,[{barcode:a,type:'Unit',sortOrder:0},{barcode:b,type:'Box',sortOrder:1}]);assert.equal(value.issues.length,0);
});
test('multiple EAN containers have one product-wide identity map',()=>{
  const value=normalizeBarcodes([ean(a,'Unit'),ean(b,'Box')]);assert.equal(value.rows.length,2);assert.equal(value.rows[1].sortOrder,1);
});
test('identical barcode within product is deduplicated and audited',()=>{
  const value=normalizeBarcodes(ean([a,a,b],['Unit','Unit','Box']));assert.equal(value.rows.length,2);assert.equal(value.rows[1].sortOrder,2);assert.equal(value.stats.duplicates,1);assert.equal(value.issues[0].code,'BARCODE_DUPLICATE');
});
test('same barcode with different descriptions is an explicit error, never last-wins',()=>{
  for(const types of [['Unit','Box'],['Box','Unit']])assert.throws(()=>normalizeBarcodes(ean([a,a],types)),{code:'BARCODE_DESCRIPTION_CONFLICT'});
});
test('whitespace is visible in diagnostics, non-digit and unusual lengths never corrected',()=>{
  const value=normalizeBarcodes(ean([' '+a+' ','00012','AB001',''],['Unit','Unit','Unit','Unit']));
  assert.deepEqual(value.rows.map(r=>r.barcode),[a,'00012','AB001']);assert.deepEqual(value.issues.map(r=>r.code),['BARCODE_WHITESPACE','BARCODE_LENGTH','BARCODE_NON_DIGIT','BARCODE_EMPTY']);assert.equal(value.issues[0].details.raw,' '+a+' ');
});
test('GTIN checksum is validated but bad original digit is preserved',()=>{
  for(const barcode of [a,b,'4006381333931','96385074','036000291452'])assert.equal(validGtinChecksum(barcode),true,barcode);
  const barcode='04690309495526';const value=normalizeBarcodes(ean(barcode,'Unit'));assert.equal(value.rows[0].barcode,barcode);assert.equal(value.issues[0].code,'BARCODE_CHECKSUM');
});
test('ambiguous pairs and numeric barcodes are rejected instead of losing digits',()=>{
  for(const value of [ean([a,b],['Unit']),ean(a,undefined),ean(4600572029629,'Unit'),{Barcode:a},a])assert.throws(()=>normalizeBarcodes(value),e=>e.code.startsWith('BARCODE_'));
});

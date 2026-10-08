'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { normalizeProduct, decimal, documentMetadata, slug } = require('./prodat-normalize.cjs');
const { parseProdatXml, ProdatDeduplicator } = require('./prodat.cjs');
const { connectionUrl, importProdat } = require('./prodat-import.cjs');
const base = { SenderPrdCode: '001', ProductName: 'Товар' };

test('decimals retain all 20 digits without Number or rounding', () => {
  for (const [raw, expected] of [['9999999999.1234567891', '9999999999.1234567891'], ['1.', '1'], ['0.', '0'], ['+001.00200','1.002'], ['-0.000','0'], ['-1.25','-1.25'], ['.5','0.5'], ['-.125','-0.125'], ['', null]]) assert.equal(decimal(raw, 'test'), expected);
  for (const raw of ['1e3', '1,2', 'NaN', '10000000000', '1.00000000001', ['1'], 1]) assert.throws(() => decimal(raw, 'test'));
});
test('countries, GOST and TY become trimmed, unique, sorted lists', () => {
  const { product } = normalizeProduct({ ...base, Country: { Value: [' Китай ', '', 'Россия', 'Китай'] }, GOST: ['ГОСТ 1','ГОСТ 2'], CertificateInfo: { GOST: 'ГОСТ 1', TY: { Value: ['ТУ 2','ТУ 2'] } } });
  assert.deepEqual(product.countries, ['Китай','Россия']);
  assert.deepEqual(product.gost, ['ГОСТ 1','ГОСТ 2']); assert.deepEqual(product.ty, ['ТУ 2']);
});
test('LabelledItemCHZ preserves all four states and rejects unknown values', () => {
  for (const v of ['Y','N','check', null]) assert.equal(normalizeProduct({ ...base, LabelledItemCHZ: v }).product.labelledItemChz, v);
  assert.throws(() => normalizeProduct({ ...base, LabelledItemCHZ: 'yes' }));
});
test('RsCatalog identity and hierarchy use L4 -> L3 -> L2, missing L4 allowed', () => {
  const r = { ...base, RsCatalog: { Level4ID:'1',Level4Name:'Root',Level3ID:'2',Level3Name:'Middle',Level2ID:'3',Level2Name:'Leaf' } };
  const a = normalizeProduct(r);
  assert.deepEqual(a.categories.map(v => [v.sourceKey,v.parentKey]), [['rsv:catalog:L4:1',null],['rsv:catalog:L3:2','rsv:catalog:L4:1'],['rsv:catalog:L2:3','rsv:catalog:L3:2']]);
  assert.equal(a.categoryKey, 'rsv:catalog:L2:3');
  delete r.RsCatalog.Level4ID; delete r.RsCatalog.Level4Name;
  assert.equal(normalizeProduct(r).categories[0].parentKey,null);
  assert.equal(normalizeProduct(base).categoryKey,null);
});
test('strict scalar, required fields, category pairs and ItemID validation', () => {
  for (const r of [{...base,SenderPrdCode:[]},{...base,ProductName:''},{...base,Brand:['A','B']},{...base,ItemID:'2147483648'},{...base,RsCatalog:{Level2ID:'1'}}]) assert.throws(() => normalizeProduct(r));
});
test('physicalRaw preserves original decimal spelling and zero', () => {
  const { product } = normalizeProduct({ ...base, Weight:{Value:'0.',WeightUnit:'KGM'}, Dimension:{Depth:'1.1234567891',DimensionUnit:'MTR'}, ItemsPerUnit:'1.', ItemsPerUOM:'шт' });
  assert.equal(product.weight,'0'); assert.equal(product.depth,'1.1234567891');
  assert.equal(product.physicalRaw.Weight.Value,'0.'); assert.equal(product.itemsPerUom,'шт');
});
test('normalizer proposes readable slugs from names; writer preserves existing slugs', () => {
  assert.equal(normalizeProduct(base).product.slug,'tovar');
  assert.equal(normalizeProduct({...base,ProductName:'Renamed'}).product.slug,'renamed');
  assert.equal(slug('brand','A'),'a');
});
test('full record dedup detects even differences in not-yet-imported children', () => {
  const d = new ProdatDeduplicator();
  assert.equal(d.accept({...base,Image:{Value:'a'}},{}).kind,'unique');
  assert.equal(d.accept({...base,Image:{Value:'a'}},{}).kind,'identical');
  assert.equal(d.accept({...base,Image:{Value:'b'}},{}).kind,'conflict');
});
test('streaming parser exposes header metadata and validates dates', async () => {
  let meta;
  const xml = '<Document><DocType>PRODAT</DocType><SenderGln>001</SenderGln><DocumentNumber>0002</DocumentNumber><DocumentDate>20261007</DocumentDate><DocDetail><SenderPrdCode>1</SenderPrdCode></DocDetail></Document>';
  let count = 0;
  for await (const item of parseProdatXml(Readable.from([Buffer.from(xml)]), {onMetadata:v=>{meta=v;}})) count++;
  assert.equal(count,1); assert.equal(meta.SenderGln,'001'); assert.equal(meta.encoding,'utf-8');
  assert.equal(documentMetadata(meta).documentDate,'2026-10-07T00:00:00.000Z');
  assert.throws(()=>documentMetadata({...meta,DocumentDate:'20260230'}));
  assert.throws(()=>documentMetadata({...meta,DocType:'PRICAT'}));
  assert.throws(()=>documentMetadata({...meta,DocType:['PRODAT','PRODAT']}));
});
test('writer requires explicit destination and files', async () => {
  assert.throws(()=>connectionUrl()); assert.throws(()=>connectionUrl('postgres://localhost/db?schema=other'));
  await assert.rejects(importProdat({ databaseUrl:'postgres://localhost/db',files:[] }));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const iconv = require('iconv-lite');
const { parseProdatXml, ProdatDeduplicator } = require('./prodat.cjs');
async function parse(bytes, size = 7) {
  let encoding;
  async function* chunks() { for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size); }
  const records = [];
  for await (const item of parseProdatXml(Readable.from(chunks()), { onEncoding: value => encoding = value })) records.push(JSON.parse(JSON.stringify(item.record)));
  return { records, encoding };
}
const body = '<Document><DocDetail id="01"><SenderPrdCode>001</SenderPrdCode><Country><Value>Китай</Value></Country><Image><Value>A</Value><Value>B</Value></Image><Empty/><Explicit></Explicit><Flag unit="m"/><Text lang="ru"> тест &amp; <![CDATA[ещё]]></Text><Mixed>до<B>x</B>после</Mixed><__proto__>safe</__proto__></DocDetail></Document>';
test('nested elements, arrays, attributes, text, CDATA, empty and mixed content across byte boundaries', async () => {
  const { records: [r], encoding } = await parse(Buffer.from(body), 1);
  assert.equal(encoding, 'utf-8');
  assert.deepEqual(r.Country, { Value: 'Китай' });
  assert.deepEqual(r.Image.Value, ['A', 'B']);
  assert.deepEqual(r['@attributes'], { id: '01' });
  assert.equal(r.Empty, ''); assert.equal(r.Explicit, '');
  assert.deepEqual(r.Flag, { '@attributes': { unit: 'm' } });
  assert.equal(r.Text['#text'], ' тест & ещё');
  assert.equal(r.Mixed['#text'], 'допосле');
  assert.deepEqual(r.Mixed['#content'], ['до', { name: 'B', value: 'x' }, 'после']);
  assert.equal(r.__proto__, 'safe');
});
for (const encoding of ['windows-1251', 'utf-8', 'utf-16le', 'utf-16be']) {
  test('encoding declaration and split multibyte characters: ' + encoding, async () => {
    const bytes = iconv.encode('<?xml version="1.0" encoding="' + encoding + '"?>' + body, encoding);
    const result = await parse(bytes, 1);
    assert.equal(result.encoding, encoding); assert.equal(result.records[0].Country.Value, 'Китай');
  });
}
for (const [encoding, bom] of [['utf-8', 'efbbbf'], ['utf-16le', 'fffe'], ['utf-16be', 'feff']]) {
  test('BOM without declaration: ' + encoding, async () => {
    const result = await parse(Buffer.concat([Buffer.from(bom, 'hex'), iconv.encode(body, encoding)]), 1);
    assert.equal(result.encoding, encoding); assert.equal(result.records[0].Country.Value, 'Китай');
  });
}
test('generic UTF-16 declaration with BOM', async () => {
  assert.equal((await parse(iconv.encode('<?xml version="1.0" encoding="UTF-16"?>' + body, 'utf-16le', { addBOM: true }), 1)).encoding, 'utf-16le');
});
test('rejects encoding mismatch, unsupported encoding, bad UTF-8, malformed XML and DTD', async () => {
  const invalid = [Buffer.concat([Buffer.from('efbbbf', 'hex'), Buffer.from('<?xml version="1.0" encoding="windows-1251"?>' + body)]), Buffer.from('<?xml version="1.0" encoding="x-invalid"?><Document/>'), Buffer.from([60, 68, 111, 99, 117, 109, 101, 110, 116, 62, 255]), Buffer.from('<Document><DocDetail></Document>'), Buffer.from('<!DOCTYPE Document><Document/>'), Buffer.from(''), Buffer.from('<Other/>'), Buffer.from('<?xml ' + ' '.repeat(4096))];
  for (const bytes of invalid) await assert.rejects(parse(bytes));
});
test('stream failures propagate', async () => {
  const stream = Readable.from((async function* () { yield Buffer.from('<Document>'); throw new Error('read failed'); })());
  await assert.rejects(async () => { for await (const r of parseProdatXml(stream)) {} }, /read failed/);
});
test('early consumer stop closes source and does not read entire XML', async () => {
  let read = 0, closed = false;
  async function* chunks() { try { yield Buffer.from('<Document>'); for (let i = 0; i < 10000; i++) { read++; yield Buffer.from('<DocDetail><SenderPrdCode>' + i + '</SenderPrdCode></DocDetail>'); } yield Buffer.from('</Document>'); } finally { closed = true; } }
  for await (const r of parseProdatXml(Readable.from(chunks(), { highWaterMark: 1 }))) { assert.equal(r.record.SenderPrdCode, '0'); break; }
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(read < 10); assert.equal(closed, true);
});
test('identical duplicates skip, nested/attribute/array differences conflict, first record remains reference', () => {
  const d = new ProdatDeduplicator();
  const record = { SenderPrdCode: '001', Country: { Value: 'Китай' }, Image: { Value: ['a', 'b'] }, '@attributes': { id: 'x' } };
  assert.equal(d.accept(record, 'a').kind, 'unique');
  assert.equal(d.accept({ ...record, Country: { Value: 'Китай' } }, 'b').kind, 'identical');
  for (const changed of [{ ...record, Country: { Value: 'Россия' } }, { ...record, '@attributes': { id: 'y' } }, { ...record, Image: { Value: ['b', 'a'] } }]) {
    const result = d.accept(changed, 'c'); assert.equal(result.kind, 'conflict'); assert.equal(result.first, 'a'); assert.equal(result.current, 'c');
  }
  assert.equal(d.accept(record, 'd').kind, 'identical');
  assert.deepEqual(d.summary(), { rawRecords: 6, uniqueSenderPrdCode: 1, identicalDuplicates: 2, conflicts: 3 });
  assert.throws(() => d.accept({ SenderPrdCode: ['1', '2'] }, 'e'), /SenderPrdCode/);
});

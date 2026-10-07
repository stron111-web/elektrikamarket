const path = require('node:path');
const { readProdatZip, getText, ProdatDeduplicator } = require('./prodat.cjs');

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) files.push('PRODAT_369147_1312247470.zip', 'PRODAT_369147_1312233182.zip');
  const dedup = new ProdatDeduplicator();
  let shown = 0;
  for (const file of files) {
    let count = 0;
    for await (const { record, source } of readProdatZip(path.resolve(file), {
      onEncoding: info => console.log('XML:', JSON.stringify(info)),
    })) {
      count++;
      const result = dedup.accept(record, source);
      if (result.kind === 'conflict') { console.error('CONFLICT:', JSON.stringify(result)); continue; }
      if (result.kind === 'identical') continue;
      if (shown++ < 5) console.log('RECORD:', JSON.stringify({ SenderPrdCode: result.code, ProductName: getText(record.ProductName) }));
      if (result.code === '1804651') {
        const fields = ['Country', 'Weight', 'Dimension', 'Analog', 'FeatureETIMDetails', 'Image', 'CertificateInfo'];
        console.log('VERIFICATION 1804651:', JSON.stringify(Object.fromEntries(fields.map(field => [field, record[field]])), null, 2));
      }
    }
    console.log('ZIP:', JSON.stringify({ file, rawRecords: count }));
  }
  console.log('SUMMARY:', JSON.stringify(dedup.summary()));
  console.log('База данных не изменялась.');
  if (dedup.conflicts) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

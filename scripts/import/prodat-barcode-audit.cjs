'use strict';
const {readProdatZip,ProdatDeduplicator}=require('./prodat.cjs');
const {normalizeBarcodes}=require('./prodat-barcodes.cjs');
async function auditBarcodes(files,{onProgress=()=>{}}={}) {
  if(!Array.isArray(files)||!files.length)throw new Error('Explicit ZIP paths required');
  const dedup=new ProdatDeduplicator(),owners=new Map();
  const result={files:[],products:0,withEan:0,withoutEan:0,entries:0,emptyValues:0,duplicateWithinProduct:0,productBarcodePairs:0,maxPerProduct:0,leadingZero:0,lengths:{},descriptions:{},warnings:{},examples:{},structures:{}};
  const started=performance.now();let peakRss=process.memoryUsage().rss;
  for(const file of files){let rawRecords=0,rawEanEntries=0;
    for await(const {record,source} of readProdatZip(file)) {
      rawRecords++;
      const value=normalizeBarcodes(record.EAN);rawEanEntries+=value.stats.entries;
      const accepted=dedup.accept(record,source);
      if(accepted.kind==='conflict')throw new Error('Conflicting product '+accepted.code);
      if(accepted.kind==='identical')continue;
      result.products++;result.entries+=value.stats.entries;result.emptyValues+=value.stats.empty;result.duplicateWithinProduct+=value.stats.duplicates;
      result.productBarcodePairs+=value.rows.length;
      if(value.rows.length)result.withEan++;else result.withoutEan++;
      result.maxPerProduct=Math.max(result.maxPerProduct,value.rows.length);
      const shape=record.EAN===''?'empty':Array.isArray(record.EAN)?'array':record.EAN===undefined?'absent':Object.keys(record.EAN).sort().join(',');
      result.structures[shape]=(result.structures[shape]||0)+1;
      for(const row of value.rows) {
        result.lengths[row.barcode.length]=(result.lengths[row.barcode.length]||0)+1;
        result.descriptions[row.type]=(result.descriptions[row.type]||0)+1;
        if(row.barcode.startsWith('0'))result.leadingZero++;
        if(!owners.has(row.barcode))owners.set(row.barcode,new Set());owners.get(row.barcode).add(accepted.code);
      }
      for(const issue of value.issues){result.warnings[issue.code]=(result.warnings[issue.code]||0)+1;
        const examples=result.examples[issue.code]??=[];if(examples.length<5)examples.push({supplierCode:accepted.code,...issue.details});}
      if(result.products%10000===0){peakRss=Math.max(peakRss,process.memoryUsage().rss);onProgress(result.products);}
    }
    result.files.push({file,rawRecords,rawEanEntries});
  }
  const shared=[...owners].filter(([,codes])=>codes.size>1);
  return {...result,uniqueBarcodes:owners.size,sharedAcrossProducts:shared.length,sharedExamples:shared.slice(0,10).map(([barcode,codes])=>({barcode,codes:[...codes]})),dedup:dedup.summary(),elapsedMs:Math.round(performance.now()-started),peakRssBytes:Math.max(peakRss,process.memoryUsage().rss)};
}
if(require.main===module)auditBarcodes(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={auditBarcodes};

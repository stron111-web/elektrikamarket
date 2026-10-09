'use strict';
const {readPricat}=require('./pricat.cjs');
const fields=['UOM','ItemsPerUOM','ItemsPerUnit','Multiplicity','RetailPrice','Price2','CustPrice','RetailCurrency'];
async function audit(files) {
  const signatures=new Map(),conflicts=new Set(),result={files:[],crossSource:{commonCodes:0,differingFields:{},samples:[]}};
  for(let n=0;n<files.length;n++) {
    const stats={source:n===0?'PRICAT1':'PRICAT2',quantity:{},partnerQuantity:{},sumQuantity:{},partnerUom:{},quantityLots:0,fieldPaths:{},dates:[]};
    const count=(obj,key)=>obj[key]=(obj[key]||0)+1;
    const quantity=(obj,v)=>count(obj,v===undefined?'missing':v===''?'empty':/^0+(\.0+)?$/.test(v)?'zero':'nonzero');
    const seen=new Set();
    for await(const {record:r} of readPricat(files[n],{onMetadata:m=>stats.dates.push(m.DocumentDate)})) {
      for(const key of Object.keys(r))count(stats.fieldPaths,key);
      if(r.SupOnhandDetail && typeof r.SupOnhandDetail==='object')for(const key of Object.keys(r.SupOnhandDetail))count(stats.fieldPaths,'SupOnhandDetail/'+key);
      quantity(stats.quantity,r.QTY);quantity(stats.partnerQuantity,r.SupOnhandDetail?.PartnerQTY);quantity(stats.sumQuantity,r.SumQTY);
      count(stats.partnerUom,r.SupOnhandDetail?.PartnerUOM ?? '<missing>');
      if(r.QtyLots)stats.quantityLots++;
      const signature=JSON.stringify(fields.map(k=>r[k]));
      if(n===0) {
        if(signatures.has(r.SenderPrdCode) && signatures.get(r.SenderPrdCode)!==signature)conflicts.add(r.SenderPrdCode);
        else signatures.set(r.SenderPrdCode,signature);
      } else if(!seen.has(r.SenderPrdCode) && signatures.has(r.SenderPrdCode) && !conflicts.has(r.SenderPrdCode)) {
        seen.add(r.SenderPrdCode);result.crossSource.commonCodes++;
        const first=JSON.parse(signatures.get(r.SenderPrdCode)),current=fields.map(k=>r[k]);
        const differences=fields.filter((k,i)=>first[i]!==current[i]);
        for(const field of differences)count(result.crossSource.differingFields,field);
        if(differences.length && result.crossSource.samples.length<10)result.crossSource.samples.push({supplierCode:r.SenderPrdCode,differences,pricat1:Object.fromEntries(fields.map((k,i)=>[k,first[i]])),pricat2:Object.fromEntries(fields.map((k,i)=>[k,current[i]]))});
      }
    }
    result.files.push(stats);
  }
  return result;
}
if(require.main===module) {
  const files=process.argv.slice(2);
  if(files.length!==2)throw new Error('Usage: node pricat-audit.cjs PRICAT1.xml/zip PRICAT2.xml/zip');
  audit(files).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={audit};

'use strict';
const {createHash}=require('node:crypto');
const REFERENCE_LAYERS={images:'images-v1',documents:'documents-v1',relations:'relations-v1'};
const names=Object.keys(REFERENCE_LAYERS);
const list=v=>v===undefined?[]:Array.isArray(v)?v:[v];
const hash=v=>createHash('sha256').update(v).digest('hex');
function referenceError(message,details){return Object.assign(new Error(message),{code:'REFERENCE_STRUCTURE',details});}
function object(v,keys,path){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw referenceError('Unexpected reference structure at '+path,{path,value:v});}
function scalar(v,path){if(typeof v!=='string')throw referenceError('Expected string at '+path,{path,value:v});return v;}
function normalizeReferences(record,supplierCode){
  const result=Object.fromEntries(names.map(k=>[k,{rows:[],issues:[],stats:{inputEntries:0,duplicateEntries:0,emptyEntries:0}}]));
  const seen=Object.fromEntries(names.map(k=>[k,new Map()]));
  function warn(layer,code,message,details){result[layer].issues.push({severity:'WARNING',code,message,details});}
  function url(raw,layer,path,index){scalar(raw,path);const value=raw.trim();
    if(!value){result[layer].stats.emptyEntries++;warn(layer,'REFERENCE_EMPTY','Empty source reference omitted',{path,raw,index});return null;}
    if(value!==raw)warn(layer,'REFERENCE_WHITESPACE','Outer whitespace removed from source reference',{path,raw,value,index});
    let parsed;try{parsed=new URL(value);}catch{}
    if(!parsed||!['http:','https:'].includes(parsed.protocol))warn(layer,'REFERENCE_URL','Non-HTTP or non-absolute reference preserved without guessing a URL',{path,raw,value,index});
    if(/\s/.test(value))warn(layer,'REFERENCE_URL_WHITESPACE','Internal whitespace preserved in reference',{path,raw,value,index});
    if(parsed&&(parsed.username||parsed.password))warn(layer,'REFERENCE_URL_CREDENTIALS','Source reference contains credentials',{path,index});
    const ext=parsed?.pathname.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase();
    if(ext&&['gpg','pd'].includes(ext))warn(layer,'REFERENCE_EXTENSION','Unusual source extension preserved',{path,raw,extension:ext,index});
    return value;
  }
  function add(layer,key,row){const previous=seen[layer].get(key);if(previous){
      const identity=layer==='images'?'url':layer==='documents'?'url':null;
      if(identity&&previous[identity]!==row[identity])throw referenceError('Reference identity hash collision',{layer,previous,row});
      result[layer].stats.duplicateEntries++;warn(layer,'REFERENCE_DUPLICATE','Repeated reference omitted; first position preserved',{layer,...row,firstIndex:previous.sortOrder});return;
    }seen[layer].set(key,row);result[layer].rows.push(row);
  }
  function values(field,key){const v=record[field];if(v===undefined||v==='')return [];object(v,[key],field);return list(v[key]);}
  for(const [sortOrder,raw] of values('Image','Value').entries()){
    result.images.stats.inputEntries++;const value=url(raw,'images','Image.Value',sortOrder);if(value!==null)add('images',hash(value),{url:value,urlKey:hash(value),sortOrder,alt:null});
  }
  const docs=[];const cert=record.CertificateInfo;
  if(cert!==undefined&&cert!==''){object(cert,['Certificate','GOST','TY'],'CertificateInfo');for(const c of list(cert.Certificate)){
    object(c,['CertificateType','CertificateURL'],'CertificateInfo.Certificate');const certificateType=scalar(c.CertificateType,'CertificateType').trim().normalize('NFC')||null;
    docs.push({raw:c.CertificateURL,type:'certificate',certificateType,path:'CertificateInfo.Certificate.CertificateURL'});
  }}
  for(const [field,type] of [['CatalogBrochure','catalog'],['Passport','passport'],['Video','video']])for(const raw of values(field,'Value'))docs.push({raw,type,certificateType:null,path:field+'.Value'});
  for(const [sortOrder,d] of docs.entries()){
    result.documents.stats.inputEntries++;const value=url(d.raw,'documents',d.path,sortOrder);if(value===null)continue;
    const identityKey=hash(JSON.stringify([d.type,d.certificateType,value]));add('documents',identityKey,{url:value,identityKey,type:d.type,certificateType:d.certificateType,name:null,sortOrder});
  }
  for(const [field,relationType] of [['Analog','analog'],['RelatedProd','related']])for(const [sortOrder,raw] of values(field,'ItemCode').entries()){
    result.relations.stats.inputEntries++;const targetSupplierCode=scalar(raw,field+'.ItemCode').trim();
    if(!targetSupplierCode){result.relations.stats.emptyEntries++;warn('relations','REFERENCE_EMPTY','Empty relation target omitted',{path:field+'.ItemCode',raw,index:sortOrder});continue;}
    if(targetSupplierCode!==raw)warn('relations','REFERENCE_WHITESPACE','Outer whitespace removed from target code',{path:field+'.ItemCode',raw,value:targetSupplierCode,index:sortOrder});
    if(targetSupplierCode===supplierCode)warn('relations','RELATION_SELF','Self relation preserved',{relationType,targetSupplierCode});
    if(!/^\d+$/.test(targetSupplierCode))warn('relations','RELATION_TARGET_FORMAT','Unusual target code preserved as string',{relationType,targetSupplierCode});
    add('relations',JSON.stringify([relationType,targetSupplierCode]),{targetSupplierCode,relationType,sortOrder});
  }
  return result;
}
module.exports={normalizeReferences,REFERENCE_LAYERS,hash};

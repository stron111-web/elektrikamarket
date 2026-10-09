'use strict';
const {readProdatZip,ProdatDeduplicator}=require('./prodat.cjs');
const list=v=>v===undefined?[]:Array.isArray(v)?v:[v];
function extractReferences(r){
  const images=list(r.Image?.Value).map((url,sortOrder)=>({url,sortOrder}));
  const documents=list(r.CertificateInfo?.Certificate).map((c,sortOrder)=>({url:c.CertificateURL,type:'certificate',certificateType:c.CertificateType,sortOrder}));
  for(const [field,type] of [['CatalogBrochure','catalog'],['Passport','passport'],['Video','video']])for(const url of list(r[field]?.Value))documents.push({url,type,certificateType:null,sortOrder:documents.length});
  const relations=[];for(const [field,relationType] of [['Analog','analog'],['RelatedProd','related']])for(const [sortOrder,targetSupplierCode] of list(r[field]?.ItemCode).entries())relations.push({targetSupplierCode,relationType,sortOrder});
  return {images,documents,relations};
}
function urlFacts(raw){
  const url=raw.trim();let kind='invalid',extension='none';
  try{const u=new URL(url);kind=['http:','https:'].includes(u.protocol)?'absolute':'otherScheme';extension=(u.pathname.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]||'none').toLowerCase();}catch{if(url&&!/^[a-z][a-z0-9+.-]*:/i.test(url))kind='relative';}
  return {url,kind,extension,whitespace:raw!==url,internalWhitespace:/\s/.test(url),nonAscii:/[^\x00-\x7f]/.test(url)};
}
async function auditReferences(files){
  const started=performance.now(),dedup=new ProdatDeduplicator(),owners={images:new Map(),documents:new Map()},edges=new Set(),targets=new Set(),sources=new Set(),paths={},examples={};
  let peak=process.memoryUsage().rss;
  const media=()=>({products:0,entries:0,uniquePairs:0,duplicates:0,max:0,empty:0,absolute:0,relative:0,invalid:0,otherScheme:0,whitespace:0,internalWhitespace:0,nonAscii:0,extensions:{},types:{},certificateTypes:{}});
  const result={files:[],images:media(),documents:media(),relations:{entries:0,uniquePairs:0,duplicates:0,products:0,max:0,self:0,empty:0,types:{}}};
  const bump=(o,k)=>o[k]=(o[k]||0)+1;
  function shape(v,p){if(Array.isArray(v)){for(const x of v)shape(x,p+'[]');}else if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v))shape(x,p+'.'+k);}else bump(paths,p+':'+typeof v);}
  for(const file of files){const raw={file,records:0,images:0,documents:0,relations:0};for await(const {record,source} of readProdatZip(file)){
    raw.records++;const data=extractReferences(record);for(const k of ['images','documents','relations'])raw[k]+=data[k].length;
    const accepted=dedup.accept(record,source);if(accepted.kind==='conflict')throw Error('Conflicting supplierCode '+accepted.code);if(accepted.kind==='identical')continue;
    for(const k of ['Image','CertificateInfo','CatalogBrochure','Passport','Video','Analog','RelatedProd'])shape(record[k],k);
    for(const kind of ['images','documents']){const s=result[kind],rows=data[kind],seen=new Set();if(rows.length)s.products++;s.entries+=rows.length;s.max=Math.max(s.max,rows.length);
      for(const row of rows){if(typeof row.url!=='string')throw Error('Non-string URL '+accepted.code);const f=urlFacts(row.url);if(!f.url)s.empty++;bump(s,f.kind);for(const key of ['whitespace','internalWhitespace','nonAscii'])if(f[key])s[key]++;bump(s.extensions,f.extension);if(row.type)bump(s.types,row.type);if(row.certificateType)bump(s.certificateTypes,row.certificateType);
        const identity=kind==='images'?f.url:JSON.stringify([row.type,row.certificateType?.trim()||null,f.url]);if(seen.has(identity))s.duplicates++;else{s.uniquePairs++;seen.add(identity);const entry=owners[kind].get(f.url);if(!entry)owners[kind].set(f.url,{first:accepted.code,shared:false});else if(entry.first!==accepted.code)entry.shared=true;}
        if(f.whitespace||f.internalWhitespace||f.kind!=='absolute'){const key=kind+':'+(f.kind!=='absolute'?f.kind:f.whitespace?'whitespace':'internalWhitespace');if((examples[key]??=[]).length<5)examples[key].push({supplierCode:accepted.code,...row});}
      }
    }
    const rs=result.relations,seen=new Set();if(data.relations.length){rs.products++;sources.add(accepted.code);}rs.entries+=data.relations.length;rs.max=Math.max(rs.max,data.relations.length);
    for(const r of data.relations){bump(rs.types,r.relationType);const target=r.targetSupplierCode.trim();if(!target)rs.empty++;if(target===accepted.code)rs.self++;const key=[r.relationType,accepted.code,target].join('\t');if(seen.has(key))rs.duplicates++;else{seen.add(key);edges.add(key);targets.add(target);rs.uniquePairs++;}}
    if(dedup.seen.size%10000===0){peak=Math.max(peak,process.memoryUsage().rss);await new Promise(resolve=>setImmediate(resolve));}
  }result.files.push(raw);}
  for(const kind of ['images','documents']){result[kind].without=dedup.seen.size-result[kind].products;result[kind].uniqueUrls=owners[kind].size;result[kind].sharedUrls=[...owners[kind].values()].filter(v=>v.shared).length;}
  const rs=result.relations;rs.resolved=0;rs.unresolved=0;rs.reverseDirected=0;rs.byType={};const involved=new Set(sources);
  for(const edge of edges){const [type,code,target]=edge.split('\t');const stat=rs.byType[type]??={resolved:0,unresolved:0,reverseDirected:0};const key=dedup.seen.has(target)?'resolved':'unresolved';rs[key]++;stat[key]++;if(key==='resolved')involved.add(target);if(code!==target&&edges.has([type,target,code].join('\t'))){rs.reverseDirected++;stat.reverseDirected++;}}
  rs.involvedCatalogProducts=involved.size;rs.uniqueTargets=targets.size;rs.existingTargets=[...targets].filter(t=>dedup.seen.has(t)).length;rs.missingTargets=targets.size-rs.existingTargets;
  return {...result,paths,examples,dedup:dedup.summary(),elapsedMs:Math.round(performance.now()-started),peakRssBytes:Math.max(peak,process.memoryUsage().rss)};
}
if(require.main===module){if(!process.argv[2])throw Error('Explicit ZIP paths required');auditReferences(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={auditReferences,extractReferences,urlFacts};

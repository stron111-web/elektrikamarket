'use strict';
// Identity includes name and unit: supplier range endpoints and unlike units
// must never be silently combined. Values are discrete, not inferred ranges.
const LIMITS={properties:8,values:8,facets:12,options:60,url:6000};
function token(code,name,uom,value){return JSON.stringify([code,name,uom,value]);}
function parseEtim(params,category){
 if(!category||params.etimCategory!==category)return [];
 const raw=typeof params.etim==='string'?[params.etim]:Array.isArray(params.etim)?params.etim:[];
 if(raw.length>LIMITS.properties*LIMITS.values||raw.reduce((n,s)=>n+(typeof s==='string'?encodeURIComponent(s).length:LIMITS.url),0)>LIMITS.url)return [];
 const groups=new Map();
 for(const s of raw){try{
  const a=JSON.parse(s);if(!Array.isArray(a)||a.length!==4)continue;
  const [code,name,uom,value]=a;
  if(!(code===null||typeof code==='string'&&code.length<=100)||typeof name!=='string'||!name.trim()||name.length>240||!(uom===null||typeof uom==='string'&&uom.length<=60)||typeof value!=='string'||!value.trim()||value.length>256)continue;
  const key=JSON.stringify([code,name,uom]);
  if(!groups.has(key)&&groups.size<LIMITS.properties)groups.set(key,{code,name,uom,values:[]});
  const g=groups.get(key);if(g&&g.values.length<LIMITS.values&&!g.values.includes(value.trim().replace(/\s+/g,' ')))g.values.push(value.trim().replace(/\s+/g,' '));
 }catch{ /* Malformed URL entries never become SQL. */ }}
 return [...groups.values()];
}
function etimTokens(groups=[]){return groups.flatMap(g=>g.values.map(v=>token(g.code,g.name,g.uom,v)));}
function normalizedValue(tx){return tx`btrim(regexp_replace(f."featureValue",'\\s+',' ','g'))`;}
function etimWhere(tx,groups=[]){
 let predicate=tx`TRUE`;
 for(const g of groups)predicate=tx`${predicate} AND EXISTS (SELECT 1 FROM product_features f WHERE f."productId"=p.id AND f."featureCode" IS NOT DISTINCT FROM ${g.code}::text AND f."featureName"=${g.name} AND f."featureUom" IS NOT DISTINCT FROM ${g.uom}::text AND ${normalizedValue(tx)} IN ${tx(g.values)})`;
 return predicate;
}

const facetCache=new Map();
async function cached(key,read){
 if(!key)return read();
 const found=facetCache.get(key);if(found&&found.expires>Date.now())return found.promise;
 if(facetCache.size>=48)facetCache.delete(facetCache.keys().next().value);
 const entry={expires:Date.now()+60000,promise:Promise.resolve().then(read)};facetCache.set(key,entry);
 try{return await entry.promise;}catch(e){if(facetCache.get(key)===entry)facetCache.delete(key);throw e;}
}
const identity=f=>JSON.stringify([f.code,f.name,f.uom]);
function featureIdentity(value){
 try{const a=JSON.parse(value);if(Array.isArray(a)&&a.length===3&&(a[0]===null||typeof a[0]==='string'&&a[0].length<=100)&&typeof a[1]==='string'&&a[1].length>0&&a[1].length<=240&&(a[2]===null||typeof a[2]==='string'&&a[2].length<=60))return {code:a[0],name:a[1],uom:a[2]};}catch{}
 return null;
}
function etimRequest(params){
 const one=k=>typeof params[k]==='string'?params[k]:'';
 const offset=one('offset');if(offset&&!/^\d{1,5}$/.test(offset))throw new Error('INVALID_ETIM_REQUEST');
 const category=one('category'),snapshot=one('snapshot'),search=one('search');
 if(!category||category.length>200||!/^\d{1,12}$/.test(snapshot)||search.length>80)throw new Error('INVALID_ETIM_REQUEST');
 const raw=one('feature'),feature=raw?featureIdentity(raw):null;
 if(raw&&!feature)throw new Error('INVALID_ETIM_REQUEST');
 return {category,snapshot,search:search.trim(),offset:Number(offset)||0,feature};
}
function propertyWhere(tx,properties){
 let where=tx`FALSE`;
 for(const g of properties)where=tx`${where} OR (f."featureCode" IS NOT DISTINCT FROM ${g.code}::text AND f."featureName"=${g.name} AND f."featureUom" IS NOT DISTINCT FROM ${g.uom}::text)`;
 return where;
}
function validFeature(tx){return tx`length(f."featureName") BETWEEN 1 AND 240 AND length(f."featureValue") BETWEEN 1 AND 256 AND length(coalesce(f."featureCode",''))<=100 AND length(coalesce(f."featureUom",''))<=60 AND ${normalizedValue(tx)}<>''`;}
async function metadata(tx,from,base,key){return cached(key&&'meta:'+key,()=>tx`
 WITH eligible AS MATERIALIZED(SELECT p.id FROM ${from} WHERE ${base})
 SELECT f."featureCode" code,f."featureName" name,f."featureUom" uom,count(DISTINCT e.id)::int coverage,count(DISTINCT ${normalizedValue(tx)})::int variants,
 CASE WHEN f."featureName" ~* '^(Цоколь|Номинальный ток$|Общее количество полюсов|Количество жил$|Номинальное сечение проводника|Мощность лампы$|Цветовая температура$|Характеристика срабатывания)' THEN 0 ELSE 1 END priority
 FROM eligible e CROSS JOIN LATERAL(SELECT "featureCode","featureName","featureUom","featureValue" FROM product_features WHERE "productId"=e.id OFFSET 0) f
 WHERE ${validFeature(tx)} GROUP BY f."featureCode",f."featureName",f."featureUom"
 ORDER BY priority,(count(DISTINCT ${normalizedValue(tx)})>1) DESC,coverage DESC,code,name,uom`);}
async function optionsPage(tx,from,base,properties,offset=0,search=''){
 if(!properties.length)return [];
 const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
 return tx`WITH eligible AS MATERIALIZED(SELECT p.id FROM ${from} WHERE ${base}),counts AS(
 SELECT f."featureCode" code,f."featureName" name,f."featureUom" uom,${normalizedValue(tx)} value,count(DISTINCT e.id)::int total
 FROM eligible e CROSS JOIN LATERAL(SELECT "featureCode","featureName","featureUom","featureValue" FROM product_features WHERE "productId"=e.id OFFSET 0) f
 WHERE (${propertyWhere(tx,properties)}) AND ${validFeature(tx)} AND (${search}='' OR ${normalizedValue(tx)} ILIKE ${pattern})
 GROUP BY f."featureCode",f."featureName",f."featureUom",${normalizedValue(tx)}),ranked AS(
 SELECT *,row_number() OVER(PARTITION BY code,name,uom ORDER BY total DESC,value) n,count(*) OVER(PARTITION BY code,name,uom)::int variants FROM counts)
 SELECT code,name,uom,max(variants)::int variants,json_agg(json_build_object('value',value,'total',total) ORDER BY n) options
 FROM ranked WHERE n>${offset} AND n<=${offset+LIMITS.options} GROUP BY code,name,uom`;
}
function decorate(property,options,offset=0,variants=property.variants){return {...property,options:options.map(o=>({...o,token:token(property.code,property.name,property.uom,o.value)})),nextOffset:offset+LIMITS.options<variants?offset+LIMITS.options:null};}
async function facetBatch(tx,from,base,properties,key){
 const rows=await cached(key&&'batch:'+key,()=>optionsPage(tx,from,base,properties));
 return properties.map(p=>decorate(p,rows.find(r=>identity(r)===identity(p))?.options||[]));
}
async function readEtimFacets(tx,from,base,selected=[],key=''){
 const all=await metadata(tx,from,base,key),properties=all.slice(0,LIMITS.facets);
 const rows=await facetBatch(tx,from,base,properties,key);
 // Restore selected properties/values beyond the first page from real rows only.
 for(const g of selected){
  let facet=rows.find(f=>identity(f)===identity(g));const property=all.find(f=>identity(f)===identity(g));
  if(!property)continue;
  if(!facet){[facet]=await facetBatch(tx,from,base,[property]);rows.push(facet);}
  const missing=g.values.filter(v=>!facet.options.some(o=>o.value===v));if(!missing.length)continue;
  const actual=await tx`WITH eligible AS MATERIALIZED(SELECT p.id FROM ${from} WHERE ${base}) SELECT ${normalizedValue(tx)} value,count(DISTINCT e.id)::int total FROM eligible e CROSS JOIN LATERAL(SELECT "featureCode","featureName","featureUom","featureValue" FROM product_features WHERE "productId"=e.id OFFSET 0) f WHERE (${propertyWhere(tx,[g])}) AND ${normalizedValue(tx)} IN ${tx(missing)} GROUP BY ${normalizedValue(tx)}`;
  facet.options.push(...actual.map(o=>({...o,token:token(g.code,g.name,g.uom,o.value)})));
 }
 return {rows,total:all.length,nextOffset:all.length>LIMITS.facets?LIMITS.facets:null};
}
async function readEtimPage(tx,request,snapshot){
 if(String(snapshot.id)!==request.snapshot)throw new Error('ETIM_SNAPSHOT_CHANGED');
 await tx`SET LOCAL statement_timeout='8s'`;
 const [category]=await tx`SELECT c.id FROM categories c WHERE c.slug=${request.category} AND NOT c."isArchived" AND NOT EXISTS(SELECT 1 FROM categories child WHERE child."parentId"=c.id AND NOT child."isArchived")`;
 if(!category)throw new Error('INVALID_ETIM_CATEGORY');
 const from=tx`assortment_items a JOIN products p ON p.id=a."productId"`;
 const base=tx`a."snapshotId"=${snapshot.id} AND NOT p."isArchived" AND p."categoryId"=${category.id}`;
 const key=String(snapshot.id)+':'+category.id,all=await metadata(tx,from,base,key);
 if(request.feature){
  const property=all.find(f=>identity(f)===identity(request.feature));if(!property)throw new Error('INVALID_ETIM_FEATURE');
  const rows=await optionsPage(tx,from,base,[property],request.offset,request.search),row=rows[0];
  const variants=row?.variants??0;
  return {snapshot:String(snapshot.id),total:variants,facet:decorate(property,row?.options||[],request.offset,variants)};
 }
 const match=all.filter(p=>!request.search||(p.name+' '+(p.uom||'')+' '+(p.code||'')).toLocaleLowerCase('ru').includes(request.search.toLocaleLowerCase('ru')));
 const properties=match.slice(request.offset,request.offset+LIMITS.facets);
 return {snapshot:String(snapshot.id),total:match.length,facets:properties.map(p=>({...decorate(p,[]),loaded:false})),nextOffset:request.offset+LIMITS.facets<match.length?request.offset+LIMITS.facets:null};
}
module.exports={LIMITS,parseEtim,etimTokens,etimWhere,readEtimFacets,readEtimPage,etimRequest,featureIdentity,token};

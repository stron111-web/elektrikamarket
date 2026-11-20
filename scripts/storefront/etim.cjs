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
async function readEtimFacets(tx,from,base,selected=[]){
 // The lateral index lookup is deliberately confined to this leaf's accepted
 // products. Never load all feature rows or raw characteristics into Node/UI.
 const rows=await tx`WITH eligible AS MATERIALIZED (SELECT p.id FROM ${from} WHERE ${base}),
 feature_values AS MATERIALIZED (
 SELECT e.id,f."featureCode" code,f."featureName" name,f."featureUom" uom,${normalizedValue(tx)} value
 FROM eligible e CROSS JOIN LATERAL (SELECT "featureCode","featureName","featureValue","featureUom" FROM product_features WHERE "productId"=e.id OFFSET 0) f
 WHERE length(f."featureName") BETWEEN 1 AND 240 AND length(f."featureValue") BETWEEN 1 AND 256 AND length(coalesce(f."featureCode",''))<=100 AND length(coalesce(f."featureUom",''))<=60),
 counts AS (SELECT code,name,uom,value,count(DISTINCT id)::int total FROM feature_values WHERE value<>'' GROUP BY code,name,uom,value),
 properties AS (SELECT code,name,uom,count(*)::int variants,sum(total)::int coverage,
 CASE WHEN name ~* '^(Цоколь|Номинальный ток$|Общее количество полюсов|Количество жил$|Номинальное сечение проводника|Мощность лампы$|Цветовая температура$|Характеристика срабатывания)' THEN 0 ELSE 1 END priority
 FROM counts GROUP BY code,name,uom HAVING count(*)>1 ORDER BY priority,coverage DESC,code,name,uom LIMIT ${LIMITS.facets}),
 ranked AS (SELECT c.*,p.variants,p.priority,p.coverage,row_number() OVER(PARTITION BY c.code,c.name,c.uom ORDER BY c.total DESC,c.value) n FROM counts c JOIN properties p ON c.code IS NOT DISTINCT FROM p.code AND c.name=p.name AND c.uom IS NOT DISTINCT FROM p.uom)
 SELECT code,name,uom,variants,priority,coverage,json_agg(json_build_object('value',value,'total',total) ORDER BY value) options FROM ranked WHERE n<=${LIMITS.options} GROUP BY code,name,uom,variants,priority,coverage ORDER BY priority,coverage DESC,code,name,uom`;
 // Selected valid source values remain removable even outside the top limits.
 for(const g of selected){
  let facet=rows.find(f=>f.code===g.code&&f.name===g.name&&f.uom===g.uom);
  const missing=g.values.filter(value=>!facet?.options.some(o=>o.value===value));
  if(!missing.length)continue;
  const actual=await tx`WITH eligible AS MATERIALIZED (SELECT p.id FROM ${from} WHERE ${base}) SELECT ${normalizedValue(tx)} value,count(DISTINCT e.id)::int total FROM eligible e CROSS JOIN LATERAL (SELECT "featureCode","featureName","featureUom","featureValue" FROM product_features WHERE "productId"=e.id OFFSET 0) f WHERE f."featureCode" IS NOT DISTINCT FROM ${g.code}::text AND f."featureName"=${g.name} AND f."featureUom" IS NOT DISTINCT FROM ${g.uom}::text AND ${normalizedValue(tx)} IN ${tx(missing)} GROUP BY ${normalizedValue(tx)}`;
  if(!actual.length)continue;
  if(!facet){facet={code:g.code,name:g.name,uom:g.uom,variants:0,options:[]};rows.push(facet);}
  facet.options.push(...actual);
 }
 for(const f of rows){f.options.sort((a,b)=>a.value.localeCompare(b.value,'ru',{numeric:true}));f.options=f.options.map(o=>({...o,token:token(f.code,f.name,f.uom,o.value)}));}
 return rows;
}
module.exports={LIMITS,parseEtim,etimTokens,etimWhere,readEtimFacets,token};

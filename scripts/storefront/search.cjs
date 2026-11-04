'use strict';
const escaped=value=>'%'+value.replace(/[\\%_]/g,'\\$&')+'%';
// Parsing bounds syntax/work only. Russian stemming, ranking and typo similarity
// belong to PostgreSQL dictionaries / tsquery / ts_rank_cd / pg_trgm.
function terms(value){
 return String(value??'').normalize('NFKC').trim().slice(0,120).split(/\s+/u).filter(Boolean).map(raw=>({
  raw,word:/^[\p{L}]+$/u.test(raw),shortWord:/^[\p{L}]+$/u.test(raw)&&[...raw].length<=4,technical:/^[\p{L}\p{N}]+$/u.test(raw)&&/\p{N}/u.test(raw),
  fuzzy:/^[\p{L}]{5,}$/u.test(raw),pattern:escaped(raw)
 }));
}
function searchPlan(tx,input,{fuzzy=false}={}){
 const parsed=terms(input),vector=tx`p."searchVector"`;
 const checks=[],queries=[],ranks=[],misses=[];
 for(const t of parsed){
  let strict,query;
  if(t.word||t.technical){
   // Short complete words are not prefix completions: stemming + :* made
   // e.g. a short electrical term match unrelated narrow-tool names.
   // Search whole lexemes in both the Russian dictionary and the normalized
   // simple dictionary. Long words retain the established partial-word search.
   query=t.shortWord
    ?tx`(plainto_tsquery('pg_catalog.russian',${t.raw}) || plainto_tsquery('pg_catalog.simple',public.storefront_search_normalize(${t.raw})))`
    :tx`public.storefront_search_query(${t.raw},${t.technical})`;
   const fts=tx`${vector} @@ ${query}`;
   strict=t.shortWord?fts:t.word?tx`(${fts} OR p.name ILIKE ${t.pattern} OR p."vendorNumber" ILIKE ${t.pattern})`:fts;
   queries.push(query);
  }else strict=tx`(p.name ILIKE ${t.pattern} OR p."vendorNumber" ILIKE ${t.pattern} OR p."supplierCode" ILIKE ${t.pattern})`;
  // A bare numeric fragment keeps the former literal article/code substring
  // lookup for a SINGLE-term request; multi-word numeric constraints stay exact.
  if(parsed.length===1&&/^\d+$/.test(t.raw))strict=tx`(${strict} OR p."supplierCode" ILIKE ${t.pattern} OR p."vendorNumber" ILIKE ${t.pattern})`;
  if(fuzzy&&t.fuzzy){
   checks.push(tx`(${strict} OR p.name %> ${t.raw})`);
   misses.push(tx`(CASE WHEN ${strict} THEN 0 ELSE 1 END)`);
   ranks.push(tx`word_similarity(${t.raw},p.name)`);
  }else checks.push(strict);
 }
 const and=checks.reduce((a,b)=>tx`${a} AND ${b}`,tx`TRUE`);
 const missed=misses.reduce((a,b)=>tx`${a}+${b}`,tx`0`);
 const combined=queries.reduce((a,b)=>a?tx`(${a} && ${b})`:b,null);
 const rank=combined?tx`ts_rank_cd(${vector},${combined},32)`:tx`0::real`;
 const score=ranks.reduce((a,b)=>tx`${a}+${b}`,rank);
 const exact=parsed.reduce((a,t)=>tx`(${a} OR coalesce(lower(p."vendorNumber")=lower(${t.raw}),false) OR lower(p."supplierCode")=lower(${t.raw}))`,
  tx`(coalesce(lower(p."vendorNumber")=lower(${input}),false) OR lower(p."supplierCode")=lower(${input}))`);
 return {where:fuzzy?tx`(${and}) AND (${missed})<=1`:and,
  order:parsed.length?tx`${exact} DESC NULLS LAST,(${score}) DESC,p.id`:tx`p.id`,
  canFuzzy:parsed.some(t=>t.fuzzy),termCount:parsed.length};
}
module.exports={terms,searchPlan};

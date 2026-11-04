'use strict';
// Independent regional coverage of accepted PRICAT. No FTP or publication APIs.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{createHash}=require('node:crypto');
const postgres=require('postgres');
const guard=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
async function sha(file){const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
(async()=>{
 const previous=JSON.parse(await fsp.readFile('/inputs/comparison.json','utf8'));
 guard(previous.status==='COMPLETED'&&await sha('/inputs/code-sets.json')===previous.codeSetsSha256,'CODE_SET_SHA_MISMATCH');
 const inputs=JSON.parse(await fsp.readFile('/inputs/code-sets.json','utf8'));
 guard(inputs.version===1,'CODE_SET_VERSION');
 const directories={TVER:'/inputs',MOSKVA:'/regions',SAMARA:'/samara'};
 const expectedCounts={TVER:previous.regions.tverUniqueCodes,MOSKVA:previous.regions.moscowUniqueCodes,SAMARA:previous.regions.samaraUniqueCodes};
 for(const [region,files] of Object.entries(inputs.sourceFiles)){
  guard(Object.hasOwn(directories,region)&&files.length===2,'REGIONAL_SOURCE_REQUIRED');
  guard(Array.isArray(inputs.sets[region])&&new Set(inputs.sets[region]).size===inputs.sets[region].length&&inputs.sets[region].length===expectedCounts[region],'REGIONAL_CODE_COUNT');
  for(const f of files){guard(/^PRODAT_369147_\d+\.zip$/.test(f.name)&&/^[a-f0-9]{64}$/.test(f.sha256),'SOURCE_DESCRIPTOR');guard(await sha(path.join(directories[region],f.name))===f.sha256,'REGIONAL_SOURCE_SHA_MISMATCH');}
 }
 const cache=JSON.parse(await fsp.readFile('/pricat-cache/state.json','utf8'));
 for(const reference of inputs.acceptedFiles){
  const file=cache.versions?.[reference.source]?.[0];guard(file&&file.sha256===reference.sha256&&['zip','xml'].includes(file.format),'ACCEPTED_PRICAT_CHANGED');
  guard(await sha(path.join('/pricat-cache/versions',reference.source,file.sha256+'.'+file.format))===reference.sha256,'PRICAT_SHA_MISMATCH');
 }
 const pricat=new Set(inputs.acceptedPricatCodes);guard(pricat.size===previous.pricat.uniqueCodes,'PRICAT_CODE_COUNT');
 const url=new URL((await fsp.readFile('/run/db/database_url','utf8')).trim());
 guard(url.username==='storefront_test_ro'&&url.pathname==='/elektrikamarket_test_20261029t010219z_2761a73c','READ_ONLY_TARGET_REQUIRED');url.searchParams.delete('schema');
 const db=postgres(url.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:true,application_name:'prodat-independent-region-ranking-readonly'}});
 let report;
 try{report=await db.begin('isolation level repeatable read read only',async tx=>{
  guard((await tx`SHOW transaction_read_only`)[0].transaction_read_only==='on','READ_ONLY_REQUIRED');
  const rows=await tx`SELECT "supplierCode" FROM public.products`,existing=new Set(rows.map(r=>r.supplierCode));
  const [active]=await tx`SELECT s.id,f1.sha256 hash1,f2.sha256 hash2 FROM public.assortment_snapshots s JOIN public.import_files f1 ON f1.id=s."pricat1FileId" JOIN public.import_files f2 ON f2.id=s."pricat2FileId" WHERE s.active AND f1.status='SUCCEEDED' AND f2.status='SUCCEEDED'`;
  guard(active&&String(active.id)===String(cache.snapshotId)&&String(active.id)===previous.pricat.acceptedSnapshotId&&active.hash1===inputs.acceptedFiles.find(f=>f.source==='PRICAT1').sha256&&active.hash2===inputs.acceptedFiles.find(f=>f.source==='PRICAT2').sha256,'ACTIVE_PRICAT_CHANGED');
  const unknown=new Set([...pricat].filter(code=>!existing.has(code)));guard(unknown.size===33919,'UNKNOWN_CODE_BASELINE_CHANGED');
  const regions=[];
  for(const region of ['SAMARA','MOSKVA','TVER']){
   let covered=0,unknownCovered=0;
   for(const code of inputs.sets[region]){if(pricat.has(code))covered++;if(unknown.has(code))unknownCovered++;}
   regions.push({region,prodatUniqueCodes:inputs.sets[region].length,pricatUniqueCodes:pricat.size,pricatCodesCovered:covered,coveragePercent:100*covered/pricat.size,unknownPricatCodesCovered:unknownCovered,pricatCodesNotCovered:pricat.size-covered});
  }
  const best=Math.max(...regions.map(r=>r.pricatCodesCovered));
  return {status:'COMPLETED',checkedAt:new Date().toISOString(),transactionReadOnly:true,sourceSHA256Verified:true,downloads:0,comparison:'Each PRODAT region independently; no regional unions',acceptedSnapshotId:String(active.id),databaseProducts:existing.size,pricatUniqueCodes:pricat.size,unknownPricatCodes:unknown.size,regions,winners:regions.filter(r=>r.pricatCodesCovered===best).map(r=>r.region)};
 });}finally{await db.end();}
 const after=JSON.parse(await fsp.readFile('/pricat-cache/state.json','utf8'));guard(String(after.snapshotId)===String(cache.snapshotId)&&inputs.acceptedFiles.every(f=>after.versions[f.source][0].sha256===f.sha256),'PRICAT_CHANGED_DURING_CHECK');
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(JSON.stringify({status:'FAILED',code:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'REGION_RANKING_FAILED'}));process.exitCode=1;});

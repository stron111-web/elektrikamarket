'use strict';
// Code-set research only. Never pass regional documents to a publication API.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{createHash}=require('node:crypto');
const {Client}=require('basic-ftp'),postgres=require('postgres');
const {readProdatZip,getText}=require('../import/prodat.cjs');
const {readPricat}=require('../import/pricat.cjs');
const {documentMetadata}=require('../import/prodat-normalize.cjs');
const {verifyZip,remoteInfo,download,same,requireCondition:guard}=require('./compare-samara.cjs');
const TVER=[{directory:'/allstock/TVER/',name:'PRODAT_369147_1326897393.zip'},
 {directory:'/allstock/TVER/',name:'PRODAT_369147_1326901642.zip'}];
const event=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function sha(file){const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
const common=(a,b)=>{let n=0;for(const code of a)if(b.has(code))n++;return n;};
async function main(){
 process.umask(0o077);const startedAt=new Date().toISOString();
 const prior=JSON.parse(await fsp.readFile('/regions/comparison.json','utf8'));
 const samaraPrior=JSON.parse(await fsp.readFile('/samara/comparison.json','utf8'));
 guard(prior.status==='COMPLETED'&&samaraPrior.status==='COMPLETED','PRIOR_REPORTS_REQUIRED');
 const auth=JSON.parse(await fsp.readFile('/run/prodat/ftp-credentials.json','utf8'));
 guard(auth.username==='prodat'&&typeof auth.password==='string'&&auth.password.length>0&&!/[\x00-\x1f\x7f]/.test(auth.username+auth.password),'CREDENTIAL_FORMAT');
 const client=new Client(30000);client.ftp.verbose=false;const tverFiles=[];
 try{
  await client.access({host:'service.russvet.ru',port:21021,user:auth.username,password:auth.password,secure:false});
  const before=[];for(const f of TVER)before.push(await remoteInfo(client,f));
  for(let i=0;i<TVER.length;i++){const local=await download(client,TVER[i],before[i],'/research');tverFiles.push({...TVER[i],remote:before[i],...local});event({phase:'downloaded',region:'TVER',name:TVER[i].name,bytes:before[i].sizeBytes});}
  for(let i=0;i<TVER.length;i++)guard(same(before[i],await remoteInfo(client,TVER[i])),'TVER_SOURCE_CHANGED');
 }finally{client.close();}
 const sets={TVER:new Set(),MOSKVA:new Set(),SAMARA:new Set()},sources={TVER:[],MOSKVA:[],SAMARA:[]};
 let peakRssBytes=process.memoryUsage().rss;
 async function parseFile(region,file,expected){
  guard(await sha(file)===expected.sha256,'SOURCE_SHA_MISMATCH');
  let records=0;const docs=[],partCodes=new Set();
  for await(const {record} of readProdatZip(file,{onMetadata:m=>docs.push(documentMetadata(m))})){
   const code=getText(record.SenderPrdCode);guard(typeof code==='string'&&code.length>0,'PRODAT_CODE_REQUIRED');sets[region].add(code);partCodes.add(code);records++;
   if(records%25000===0){peakRssBytes=Math.max(peakRssBytes,process.memoryUsage().rss);event({phase:'parsing',region,name:expected.name,records});}
  }
  guard(docs.length===1&&records>0&&(!expected.records||records===expected.records),'PRODAT_DOCUMENT_OR_COUNT');
  guard(await sha(file)===expected.sha256,'SOURCE_CHANGED_DURING_READ');
  const details={name:expected.name,sha256:expected.sha256,records,uniqueCodes:partCodes.size,documents:docs};
  sources[region].push(details);event({phase:'parsed',region,name:expected.name,records});return details;
 }
 for(const f of tverFiles){Object.assign(f,await verifyZip(f.destination),await parseFile('TVER',f.destination,f));delete f.destination;}
 for(const f of prior.moscowFiles){guard(/^PRODAT_369147_(1326892406|1326898165)\.zip$/.test(f.name),'MOSCOW_ALLOWLIST');await parseFile('MOSKVA',path.join('/regions',f.name),f);}
 for(const name of ['PRODAT_369147_1326894989.zip','PRODAT_369147_1326898736.zip']){
  const f=samaraPrior.files.find(f=>f.set==='allstock'&&f.name===name);guard(f,'SAMARA_ALLOWLIST');await parseFile('SAMARA',path.join('/samara',name),f);
 }
 guard(sets.MOSKVA.size===prior.regions.moscow.uniqueCodes&&sets.SAMARA.size===prior.regions.samara.uniqueCodes&&common(sets.MOSKVA,sets.SAMARA)===prior.regions.common,'REGION_BASELINE_MISMATCH');
 const oldUnion=new Set([...sets.MOSKVA,...sets.SAMARA]);
 const additional=new Set([...sets.TVER].filter(code=>!oldUnion.has(code)));
 const cache=JSON.parse(await fsp.readFile('/pricat-cache/state.json','utf8')),pricat=new Set(),acceptedFiles=[];
 for(const source of ['PRICAT1','PRICAT2']){
  const f=cache.versions?.[source]?.[0],reference=prior.pricat.acceptedFiles.find(f=>f.source===source);
  guard(f?.source===source&&/^[a-f0-9]{64}$/.test(f.sha256)&&['zip','xml'].includes(f.format)&&f.sha256===reference?.sha256,'ACCEPTED_PRICAT_BASELINE_CHANGED');
  const file=path.join('/pricat-cache/versions',source,f.sha256+'.'+f.format);guard(await sha(file)===f.sha256,'PRICAT_CACHE_SHA_MISMATCH');
  let records=0;const docs=[];
  for await(const {record} of readPricat(file,{onMetadata:m=>docs.push(m)})){
   const code=getText(record.SenderPrdCode);guard(typeof code==='string'&&code.length>0,'PRICAT_CODE_REQUIRED');pricat.add(code);records++;
   if(records%50000===0)event({phase:'parsing',source,records});
  }
  guard(docs.length===1&&docs[0].DocumentDate===f.documentDate&&await sha(file)===f.sha256,'PRICAT_SOURCE_CHANGED');
  acceptedFiles.push({source,name:f.remote?.name,sha256:f.sha256,documentDate:f.documentDate,records});event({phase:'parsed',source,records});
 }
 const url=new URL((await fsp.readFile('/run/db/database_url','utf8')).trim());
 guard(url.username==='storefront_test_ro'&&url.pathname==='/elektrikamarket_test_20261029t010219z_2761a73c','READ_ONLY_TARGET_REQUIRED');url.searchParams.delete('schema');
 const db=postgres(url.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:true,application_name:'prodat-tver-code-comparison-readonly'}});
 let result;
 try{result=await db.begin('isolation level repeatable read read only',async tx=>{
  guard((await tx`SHOW transaction_read_only`)[0].transaction_read_only==='on','READ_ONLY_REQUIRED');
  const checkedAt=new Date().toISOString(),products=await tx`SELECT "supplierCode" FROM public.products`,existing=new Set(products.map(p=>p.supplierCode));
  const [active]=await tx`SELECT s.id,s."productCount",f1.sha256 hash1,f2.sha256 hash2 FROM public.assortment_snapshots s JOIN public.import_files f1 ON f1.id=s."pricat1FileId" JOIN public.import_files f2 ON f2.id=s."pricat2FileId" WHERE s.active AND f1.status='SUCCEEDED' AND f2.status='SUCCEEDED'`;
  guard(active&&String(active.id)===String(cache.snapshotId)&&String(active.id)===prior.pricat.acceptedSnapshotId&&active.hash1===acceptedFiles[0].sha256&&active.hash2===acceptedFiles[1].sha256,'ACTIVE_SNAPSHOT_BASELINE_CHANGED');
  const unknown=new Set([...pricat].filter(code=>!existing.has(code))),remaining=new Set([...unknown].filter(code=>!oldUnion.has(code)));
  guard(unknown.size===prior.pricat.unknownCodes&&remaining.size===prior.pricat.unknownRemainingAfterUnion&&remaining.size===10935,'UNKNOWN_PRICAT_BASELINE_CHANGED');
  const newlyCovered=common(remaining,sets.TVER);
  return {database:{checkedAt,products:existing.size,transactionReadOnly:true},regions:{tverUniqueCodes:sets.TVER.size,moscowUniqueCodes:sets.MOSKVA.size,samaraUniqueCodes:sets.SAMARA.size,moscowSamaraUnionCodes:oldUnion.size,tverAdditionalCodes:additional.size,tverAdditionalNotInDatabase:additional.size-common(additional,existing),tverSharedWithPriorUnion:common(sets.TVER,oldUnion),threeRegionUnionCodes:oldUnion.size+additional.size},
   pricat:{acceptedSnapshotId:String(active.id),acceptedSnapshotProducts:active.productCount,acceptedFiles,uniqueCodes:pricat.size,unknownCodes:unknown.size,remainingBeforeTver:remaining.size,coveredByTverFromRemaining:newlyCovered,remainingAfterThreeRegions:remaining.size-newlyCovered,coveredByThreeRegions:unknown.size-remaining.size+newlyCovered}};
 });}finally{await db.end();}
 const finalCache=JSON.parse(await fsp.readFile('/pricat-cache/state.json','utf8'));guard(String(finalCache.snapshotId)===String(cache.snapshotId)&&acceptedFiles.every(f=>finalCache.versions[f.source][0].sha256===f.sha256),'PRICAT_CACHE_STATE_CHANGED');
 // Private code-only sidecar permits future approved comparisons without reparsing characteristics.
 const sidecar={version:1,sourceFiles:sources,acceptedFiles,sets:Object.fromEntries(Object.entries(sets).map(([name,codes])=>[name,[...codes].sort()])),acceptedPricatCodes:[...pricat].sort()};
 const sidecarFile='/research/code-sets.json';await fsp.writeFile(sidecarFile,JSON.stringify(sidecar)+'\n',{flag:'wx',mode:0o600});
 const report={status:'COMPLETED',startedAt,finishedAt:new Date().toISOString(),comparisonScope:'SenderPrdCode only; cross-region attributes and conflict policy not evaluated; no importer invoked',tverFiles,sources,codeSetsSha256:await sha(sidecarFile),peakRssBytes:Math.max(peakRssBytes,process.memoryUsage().rss),...result};
 await fsp.writeFile('/research/comparison.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});event({phase:'completed',...report});
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'FAILED',code:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'TVER_RESEARCH_FAILED'}));process.exitCode=1;});

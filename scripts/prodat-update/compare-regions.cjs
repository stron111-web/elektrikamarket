'use strict';
// Moscow downloads only. Samara and accepted PRICAT are immutable read-only inputs.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{createHash}=require('node:crypto');
const {Client}=require('basic-ftp'),postgres=require('postgres');
const {readProdatZip,ProdatDeduplicator,getText}=require('../import/prodat.cjs');
const {readPricat}=require('../import/pricat.cjs');
const {documentMetadata}=require('../import/prodat-normalize.cjs');
const {verifyZip,remoteInfo,download,same,requireCondition:guard}=require('./compare-samara.cjs');
const MOSCOW=[{directory:'/allstock/MOSKVA/',name:'PRODAT_369147_1326892406.zip'},
 {directory:'/allstock/MOSKVA/',name:'PRODAT_369147_1326898165.zip'}];
const event=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function sha(file){const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
const common=(a,b)=>{let n=0;for(const c of a)if(b.has(c))n++;return n;};
async function main(){
 process.umask(0o077);const startedAt=new Date().toISOString(),output='/research';
 const prior=JSON.parse(await fsp.readFile('/samara/comparison.json','utf8'));
 guard(prior.status==='COMPLETED'&&prior.allstockDedup.conflicts===0,'SAMARA_REPORT_REQUIRED');
 const auth=JSON.parse(await fsp.readFile('/run/prodat/ftp-credentials.json','utf8'));
 guard(auth.username==='prodat'&&typeof auth.password==='string'&&auth.password.length>0&&!/[\x00-\x1f\x7f]/.test(auth.username+auth.password),'CREDENTIAL_FORMAT');
 const client=new Client(30000);client.ftp.verbose=false;const moscowFiles=[];
 try{
  await client.access({host:'service.russvet.ru',port:21021,user:auth.username,password:auth.password,secure:false});
  const before=[];for(const file of MOSCOW)before.push(await remoteInfo(client,file));
  for(let i=0;i<MOSCOW.length;i++){const local=await download(client,MOSCOW[i],before[i],output);moscowFiles.push({...MOSCOW[i],remote:before[i],...local});event({phase:'downloaded',region:'MOSKVA',name:MOSCOW[i].name,bytes:before[i].sizeBytes});}
  for(let i=0;i<MOSCOW.length;i++)guard(same(before[i],await remoteInfo(client,MOSCOW[i])),'MOSCOW_SOURCE_CHANGED');
 }finally{client.close();}
 const moscowDedup=new ProdatDeduplicator(),samara=new Set(),samaraFiles=[];
 let peakRssBytes=process.memoryUsage().rss;
 for(const file of moscowFiles){
  Object.assign(file,await verifyZip(file.destination));const docs=[],codes=new Set();let records=0;
  for await(const {record,source} of readProdatZip(file.destination,{onMetadata:m=>docs.push(documentMetadata(m))})){
   const result=moscowDedup.accept(record,source);codes.add(result.code);records++;
   if(records%25000===0){peakRssBytes=Math.max(peakRssBytes,process.memoryUsage().rss);event({phase:'parsing',region:'MOSKVA',name:file.name,records});}
  }
  guard(docs.length===1&&records>0,'PRODAT_DOCUMENT_COUNT');
  Object.assign(file,{records,uniqueCodes:codes.size,documents:docs});delete file.destination;
  event({phase:'parsed',region:'MOSKVA',name:file.name,records});
 }
 const expectedSamaraNames=['PRODAT_369147_1326894989.zip','PRODAT_369147_1326898736.zip'];
 for(const name of expectedSamaraNames){
  const input=prior.files.find(f=>f.set==='allstock'&&f.directory==='/allstock/SAMARA/'&&f.name===name);guard(input,'SAMARA_SOURCE_REQUIRED');
  const file=path.join('/samara',name);guard(await sha(file)===input.sha256,'SAMARA_SHA_MISMATCH');
  let records=0;for await(const {record} of readProdatZip(file)){
   const code=getText(record.SenderPrdCode);guard(typeof code==='string'&&code.length>0,'PRODAT_CODE_REQUIRED');samara.add(code);records++;
   if(records%25000===0){peakRssBytes=Math.max(peakRssBytes,process.memoryUsage().rss);event({phase:'parsing',region:'SAMARA',name,records});}
  }
  guard(records===input.records&&await sha(file)===input.sha256,'SAMARA_INPUT_CHANGED');samaraFiles.push({name,sha256:input.sha256,records});
  event({phase:'parsed',region:'SAMARA',name,records});
 }
 guard(samara.size===prior.comparison.allstock.uniqueCodes,'SAMARA_CODE_COUNT_MISMATCH');
 // No credentials from the PRICAT runtime are read. Its accepted cache is mounted read-only.
 const cache=JSON.parse(await fsp.readFile('/pricat-cache/state.json','utf8'));
 const acceptedFiles=[],pricat=new Set();
 for(const source of ['PRICAT1','PRICAT2']){
  const f=cache.versions?.[source]?.[0];guard(f?.source===source&&/^[a-f0-9]{64}$/.test(f.sha256)&&['zip','xml'].includes(f.format),'ACCEPTED_CACHE_REQUIRED');
  const file=path.join('/pricat-cache/versions',source,f.sha256+'.'+f.format);guard(await sha(file)===f.sha256,'PRICAT_CACHE_SHA_MISMATCH');
  let records=0;const docs=[];
  for await(const {record} of readPricat(file,{onMetadata:m=>docs.push(m)})){
   const code=getText(record.SenderPrdCode);guard(typeof code==='string'&&code.length>0,'PRICAT_CODE_REQUIRED');pricat.add(code);records++;
   if(records%50000===0)event({phase:'parsing',source,records});
  }
  guard(docs.length===1&&docs[0].DocumentDate===f.documentDate&&await sha(file)===f.sha256,'PRICAT_CACHE_CHANGED');
  acceptedFiles.push({source,name:f.remote?.name,sha256:f.sha256,documentDate:f.documentDate,records});event({phase:'parsed',source,records});
 }
 const url=new URL((await fsp.readFile('/run/db/database_url','utf8')).trim());
 guard(url.username==='storefront_test_ro'&&url.pathname==='/elektrikamarket_test_20261029t010219z_2761a73c','READ_ONLY_TARGET_REQUIRED');url.searchParams.delete('schema');
 const db=postgres(url.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:true,application_name:'prodat-region-comparison-readonly'}});
 const moscow=new Set(moscowDedup.seen.keys());let result;
 try{result=await db.begin('isolation level repeatable read read only',async tx=>{
  guard((await tx`SHOW transaction_read_only`)[0].transaction_read_only==='on','READ_ONLY_REQUIRED');
  const checkedAt=new Date().toISOString(),products=await tx`SELECT "supplierCode" FROM public.products`,existing=new Set(products.map(p=>p.supplierCode));
  const [active]=await tx`SELECT s.id,s."productCount",f1.sha256 hash1,f2.sha256 hash2,f1."documentDateRaw" date1,f2."documentDateRaw" date2 FROM public.assortment_snapshots s JOIN public.import_files f1 ON f1.id=s."pricat1FileId" JOIN public.import_files f2 ON f2.id=s."pricat2FileId" WHERE s.active AND f1.status='SUCCEEDED' AND f2.status='SUCCEEDED'`;
  guard(active&&String(active.id)===String(cache.snapshotId)&&active.hash1===acceptedFiles[0].sha256&&active.hash2===acceptedFiles[1].sha256&&active.date1===acceptedFiles[0].documentDate&&active.date2===acceptedFiles[1].documentDate,'ACTIVE_SNAPSHOT_CACHE_MISMATCH');
  const unknown=new Set([...pricat].filter(code=>!existing.has(code))),intersection=common(moscow,samara);
  let additionalMoscowNotInDatabase=0,unknownAddedByMoscow=0;
  for(const code of moscow)if(!samara.has(code)){if(!existing.has(code))additionalMoscowNotInDatabase++;if(unknown.has(code))unknownAddedByMoscow++;}
  const unknownCoveredBySamara=common(unknown,samara),unknownCoveredByMoscow=common(unknown,moscow);
  return {database:{checkedAt,products:existing.size,transactionReadOnly:true},
   regions:{moscow:{uniqueCodes:moscow.size,inDatabase:common(moscow,existing),notInDatabase:moscow.size-common(moscow,existing)},samara:{uniqueCodes:samara.size,inDatabase:common(samara,existing),notInDatabase:samara.size-common(samara,existing)},common:intersection,onlyMoscow:moscow.size-intersection,onlySamara:samara.size-intersection,additionalMoscowNotInDatabase},
   pricat:{acceptedSnapshotId:String(active.id),acceptedSnapshotProducts:active.productCount,acceptedFiles,uniqueCodes:pricat.size,unknownCodes:unknown.size,previouslyReportedUnknownCodes:33919,unknownCountMatchesReference:unknown.size===33919,unknownCoveredBySamara,unknownCoveredByMoscow,unknownAddedByMoscow,unknownCoveredByUnion:unknownCoveredBySamara+unknownAddedByMoscow,unknownRemainingAfterUnion:unknown.size-unknownCoveredBySamara-unknownAddedByMoscow}};
 });}finally{await db.end();}
 const currentCache=JSON.parse(await fsp.readFile('/pricat-cache/state.json','utf8'));
 guard(String(currentCache.snapshotId)===String(cache.snapshotId)&&acceptedFiles.every(f=>currentCache.versions[f.source][0].sha256===f.sha256),'PRICAT_ACCEPTED_STATE_CHANGED');
 peakRssBytes=Math.max(peakRssBytes,process.memoryUsage().rss);
 const report={status:'COMPLETED',startedAt,finishedAt:new Date().toISOString(),moscowFiles,samaraFiles,moscowDedup:moscowDedup.summary(),peakRssBytes,...result};
 await fsp.writeFile(path.join(output,'comparison.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});event({phase:'completed',...report});
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'FAILED',code:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'REGION_COMPARISON_FAILED'}));process.exitCode=1;});

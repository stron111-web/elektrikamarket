'use strict';
// One-off, explicitly scoped research. No importer, scheduler, DDL or DML calls.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path');
const {createHash}=require('node:crypto'),{crc32}=require('node:zlib');
const {Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {Client}=require('basic-ftp'),unzipper=require('unzipper'),postgres=require('postgres');
const {readProdatZip,ProdatDeduplicator}=require('../import/prodat.cjs');
const {documentMetadata}=require('../import/prodat-normalize.cjs');
const FILES=Object.freeze([
 {set:'allstock',directory:'/allstock/SAMARA/',name:'PRODAT_369147_1326894989.zip'},
 {set:'allstock',directory:'/allstock/SAMARA/',name:'PRODAT_369147_1326898736.zip'},
 {set:'sklad',directory:'/sklad/SAMARA/',name:'PRODAT_369147_1326896258.zip'},
]);
function requireCondition(ok,code){if(!ok){const e=new Error(code);e.code=code;throw e;}}
const publicEvent=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function verifyZip(file){
 const entries=(await unzipper.Open.file(file)).files.filter(e=>e.type!=='Directory');
 requireCondition(entries.length===1&&/\.xml$/i.test(entries[0].path),'ONE_XML_REQUIRED');
 const entry=entries[0],limit=2*1024**3;requireCondition(entry.uncompressedSize<=limit,'ZIP_LIMIT');
 let size=0,crc=0;for await(const chunk of entry.stream()){size+=chunk.length;requireCondition(size<=limit,'ZIP_LIMIT');crc=crc32(chunk,crc);}
 requireCondition(size===entry.uncompressedSize&&crc===entry.crc32,'ZIP_CRC_OR_SIZE');
 return {xmlName:entry.path,xmlBytes:size,crcVerified:true};
}
async function remoteInfo(client,file){
 const full=file.directory+file.name;
 const sizeBytes=await client.size(full),modified=(await client.lastMod(full)).toISOString();
 requireCondition(Number.isSafeInteger(sizeBytes)&&sizeBytes>0&&sizeBytes<=128*1024**2,'REMOTE_SIZE');
 return {path:full,sizeBytes,modified};
}
const same=(a,b)=>a.path===b.path&&a.sizeBytes===b.sizeBytes&&a.modified===b.modified;
async function download(client,file,info,output){
 const destination=path.join(output,file.name),part=destination+'.part',hash=createHash('sha256');let bytes=0;
 const sink=fs.createWriteStream(part,{flags:'wx',mode:0o600});
 const bounded=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;if(bytes>info.sizeBytes)return done(new Error('DOWNLOAD_LIMIT'));hash.update(chunk);done(null,chunk);}});
 const writing=pipeline(bounded,sink);writing.catch(()=>{});
 const timer=setTimeout(()=>{bounded.destroy(new Error('TRANSFER_TIMEOUT'));client.close();},600000);
 try{
  await client.downloadTo(bounded,info.path);await writing;
  requireCondition(bytes===info.sizeBytes&&same(info,await remoteInfo(client,file)),'REMOTE_CHANGED');
  const h=await fsp.open(part,'r');try{await h.sync();}finally{await h.close();}
  await fsp.rename(part,destination);
  return {destination,sha256:hash.digest('hex')};
 }catch(e){bounded.destroy();sink.destroy();await writing.catch(()=>{});throw e;}finally{clearTimeout(timer);}
}
function compareSets(allstock,sklad,existing){
 let common=0,allstockKnown=0,skladKnown=0;
 for(const code of allstock){if(sklad.has(code))common++;if(existing.has(code))allstockKnown++;}
 for(const code of sklad)if(existing.has(code))skladKnown++;
 return {allstock:{uniqueCodes:allstock.size,inDatabase:allstockKnown,notInDatabase:allstock.size-allstockKnown},
  sklad:{uniqueCodes:sklad.size,inDatabase:skladKnown,notInDatabase:sklad.size-skladKnown},
  common,onlyAllstock:allstock.size-common,onlySklad:sklad.size-common,skladIsSubsetOfAllstock:common===sklad.size};
}
async function main(){
 process.umask(0o077);const output='/research';
 requireCondition((await fsp.stat(output)).isDirectory(),'OUTPUT_DIRECTORY_REQUIRED');
 const auth=JSON.parse(await fsp.readFile('/run/prodat/ftp-credentials.json','utf8'));
 requireCondition(auth.username==='prodat'&&typeof auth.password==='string'&&auth.password.length>0&&!/[\x00-\x1f\x7f]/.test(auth.username+auth.password),'CREDENTIAL_FORMAT');
 const startedAt=new Date().toISOString(),client=new Client(30000);client.ftp.verbose=false;
 const files=[];
 try{
  await client.access({host:'service.russvet.ru',port:21021,user:auth.username,password:auth.password,secure:false});
  const before=[];for(const file of FILES)before.push(await remoteInfo(client,file));
  for(let i=0;i<FILES.length;i++){
   const local=await download(client,FILES[i],before[i],output);
   files.push({...FILES[i],remote:before[i],...local});
   publicEvent({phase:'downloaded',name:FILES[i].name,bytes:before[i].sizeBytes});
  }
  for(let i=0;i<FILES.length;i++)requireCondition(same(before[i],await remoteInfo(client,FILES[i])),'SOURCE_SET_CHANGED');
 }finally{client.close();}
 const dedup={allstock:new ProdatDeduplicator(),sklad:new ProdatDeduplicator()},partCodes=[];
 let peakRssBytes=process.memoryUsage().rss;
 for(const file of files){
  Object.assign(file,await verifyZip(file.destination));
  const docs=[],codes=new Set();let rows=0;
  for await(const {record,source} of readProdatZip(file.destination,{onMetadata:m=>docs.push(documentMetadata(m))})){
   const result=dedup[file.set].accept(record,source);codes.add(result.code);rows++;
   if(rows%25000===0){peakRssBytes=Math.max(peakRssBytes,process.memoryUsage().rss);publicEvent({phase:'parsing',name:file.name,records:rows});}
  }
  requireCondition(docs.length===1&&rows>0,'PRODAT_DOCUMENT_COUNT');
  file.records=rows;file.uniqueCodes=codes.size;file.documents=docs;delete file.destination;
  partCodes.push(codes);
  publicEvent({phase:'parsed',name:file.name,records:rows,uniqueCodes:codes.size});
 }
 const url=new URL((await fsp.readFile('/run/db/database_url','utf8')).trim());
 requireCondition(url.username==='storefront_test_ro'&&url.pathname==='/elektrikamarket_test_20261029t010219z_2761a73c','READONLY_TARGET_REQUIRED');url.searchParams.delete('schema');
 const db=postgres(url.toString(),{max:1,onnotice:()=>{},connection:{application_name:'prodat-samara-comparison-readonly',default_transaction_read_only:true}});
 let database,comparison;
 try{
  ({database,comparison}=await db.begin('isolation level repeatable read read only',async tx=>{
   requireCondition((await tx`SHOW transaction_read_only`)[0].transaction_read_only==='on','READ_ONLY_REQUIRED');
   const checkedAt=new Date().toISOString();
   const products=await tx`SELECT "supplierCode" FROM public.products`;
   const existing=new Set(products.map(row=>row.supplierCode));
   return {database:{name:decodeURIComponent(url.pathname.slice(1)),checkedAt,rows:products.length,uniqueCodes:existing.size,transactionReadOnly:true},
    comparison:compareSets(new Set(dedup.allstock.seen.keys()),new Set(dedup.sklad.seen.keys()),existing)};
  }));
 }finally{await db.end();}
 let sharedBetweenAllstockParts=0;for(const code of partCodes[0])if(partCodes[1].has(code))sharedBetweenAllstockParts++;
 peakRssBytes=Math.max(peakRssBytes,process.memoryUsage().rss);
 const report={startedAt,finishedAt:new Date().toISOString(),status:'COMPLETED',scope:'Only three explicitly authorized Samara ZIPs; no production import or scheduling',
  files,allstockDedup:dedup.allstock.summary(),skladDedup:dedup.sklad.summary(),sharedBetweenAllstockParts,database,comparison,peakRssBytes};
 const reportFile=path.join(output,'comparison.json');await fsp.writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 publicEvent({phase:'completed',...report});
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'FAILED',code:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'SAMARA_RESEARCH_FAILED'}));process.exitCode=1;});
module.exports={FILES,compareSets};

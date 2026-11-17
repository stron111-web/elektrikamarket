'use strict';
// Offline proposal only. No postgres client, imports, writes or runtime activation.
const fs=require('node:fs'),fsp=fs.promises;
const {createHash}=require('node:crypto');
const {crc32}=require('node:zlib');
const unzipper=require('unzipper');
const {readPricat}=require('../import/pricat.cjs');
const {normalizePricat}=require('../import/pricat-normalize.cjs');
const SOURCES={PRICAT1:['stock1','stock3'],PRICAT2:['stock2']};
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const positive=v=>typeof v==='string'&&/^\d+(\.\d+)?$/.test(v)&&/[1-9]/.test(v);
function newIndex(source){if(!SOURCES[source])fail('EXPLICIT_SOURCE_REQUIRED');return {source,rows:0,identicalDuplicates:0,invalidRecords:0,codes:new Map()};}
function addRecord(index,record,{markup='30.000',currency='RUB'}={}){
 const code=typeof record.SenderPrdCode==='string'?record.SenderPrdCode.trim():'';
 if(!code)fail('UNIDENTIFIABLE_RECORD'); // Cannot safely quarantine an unknown identity.
 const hash=digest(record),prior=index.codes.get(code);index.rows++;
 let normalized,invalid=false;
 try{normalized=normalizePricat(record,index.source,markup,currency);}catch{invalid=true;index.invalidRecords++;}
 if(prior){
  if(prior.hash===hash)index.identicalDuplicates++;else prior.conflict=true;
  prior.invalid=prior.invalid||invalid;
  return;
 }
 index.codes.set(code,{hash,conflict:false,invalid,
  commercial:normalized?{uom:normalized.commercial.uom,itemsPerUnit:normalized.commercial.itemsPerUnit,itemsPerUom:normalized.commercial.itemsPerUom}:null,
  stocks:normalized?.stocks.map(s=>({warehouse:s.warehouse,uom:s.uom,quantity:s.quantity}))||[]});
}
function stats(index){return {source:index.source,rows:index.rows,uniqueCodes:index.codes.size,
 identicalDuplicates:index.identicalDuplicates,invalidRecords:index.invalidRecords,
 conflictingCodes:[...index.codes.values()].filter(v=>v.conflict).length};}
async function sha(file){const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function readIndex(file,source,{maxXmlBytes=1073741824,markup='30.000'}={}){
 if(!Number.isSafeInteger(maxXmlBytes)||maxXmlBytes<=0)fail('XML_LIMIT_REQUIRED');
 const index=newIndex(source),before=await sha(file);
 if(/\.zip$/i.test(file)){
  const files=(await unzipper.Open.file(file)).files.filter(e=>e.type!=='Directory');
  if(files.length!==1||! /\.xml$/i.test(files[0].path))fail('ONE_XML_PER_ZIP');
  const e=files[0];if(e.uncompressedSize>maxXmlBytes)fail('ZIP_EXPANSION_LIMIT');
  let bytes=0,crc=0;for await(const b of e.stream()){bytes+=b.length;if(bytes>maxXmlBytes)fail('ZIP_EXPANSION_LIMIT');crc=crc32(b,crc);}
  if(bytes!==e.uncompressedSize||crc!==e.crc32)fail('ZIP_CRC_OR_SIZE');
 }else if(!/\.xml$/i.test(file)||(await fsp.stat(file)).size>maxXmlBytes)fail('XML_FORMAT_OR_SIZE');
 const documents=[];let header={};
 for await(const {record} of readPricat(file,{onHeader:m=>header=m,onMetadata:m=>documents.push(m)}))addRecord(index,record,{markup,currency:header.Currency});
 if(documents.length!==1||index.rows===0)fail('SOURCE_EMPTY_OR_DOCUMENT_COUNT');
 if(before!==await sha(file))fail('FILE_CHANGED_DURING_REVIEW');
 index.sha256=before;index.document=documents[0];return index;
}
function compare(previous,current){
 if(previous.source!==current.source)fail('SOURCE_MISMATCH');
 const entries=[];let added=0,absent=0,retained=0,changed=0,quarantined=0;
 for(const code of [...new Set([...previous.codes.keys(),...current.codes.keys()])].sort()){
  const old=previous.codes.get(code),fresh=current.codes.get(code);
  if(!fresh){absent++;entries.push({code,kind:'ABSENT',source:current.source,
   warehouses:SOURCES[current.source],previousPositiveWarehouses:old.stocks.filter(s=>positive(s.quantity)).map(s=>s.warehouse),
   action:'REVIEW_ABSENCE_NO_WRITE'});continue;}
  if(old){retained++;if(old.hash!==fresh.hash)changed++;}else added++;
  if(fresh.conflict||fresh.invalid){quarantined++;entries.push({code,kind:fresh.conflict?'CONFLICTING_DUPLICATE':'INVALID_RECORD',
   source:current.source,warehouses:SOURCES[current.source],action:'QUARANTINE_SOURCE_CODE_KEEP_OTHER_SOURCE'});continue;}
  const commercialChanged=!!old&&canonical(old.commercial)!==canonical(fresh.commercial);
  entries.push({code,kind:old?'RETAINED':'ADDED',changed:!!old&&old.hash!==fresh.hash,
   commercialChanged,source:current.source,warehouses:SOURCES[current.source],action:'EXISTING_IMPORTER_AND_STORE_VALIDATION'});
 }
 return {source:current.source,previous:stats(previous),current:stats(current),
  counts:{added,absent,retained,changed,quarantined},entries};
}
// Proposal for replacing both percentage dry-run vetoes. This is NOT a publish permit.
function reviewDrySummary(d,received){
 if(d.status!=='DRY_RUN'||d.files?.length!==2||received?.length!==2)fail('COMPLETE_PAIR_REQUIRED');
 for(const list of [d.files,received])if(new Set(list.map(f=>f.source)).size!==2||list.some(f=>!SOURCES[f.source]))fail('COMPLETE_PAIR_REQUIRED');
 for(const f of d.files){
  const r=received.find(v=>v.source===f.source);
  if(!r||f.sha256!==r.sha256||f.rows!==r.rows)fail('DRY_RUN_SOURCE_MISMATCH');
  for(const k of ['rows','uniqueCodes','matched','missing','conflictingCodes','invalidRecords','identicalDuplicates'])if(!Number.isSafeInteger(f[k])||f[k]<0)fail('INVALID_SOURCE_STATS');
  if(f.rows===0||f.uniqueCodes===0)fail('SOURCE_EMPTY_OR_DOCUMENT_COUNT');
  if(f.uniqueCodes>f.rows||f.matched+f.missing!==f.uniqueCodes||f.conflictingCodes>f.uniqueCodes||f.invalidRecords>f.rows)fail('INVALID_SOURCE_STATS');
 }
 if(d.processedRecords!==d.files.reduce((n,f)=>n+f.rows,0)||d.conflictingCodes!==d.files.reduce((n,f)=>n+f.conflictingCodes,0)||d.invalidRecords!==d.files.reduce((n,f)=>n+f.invalidRecords,0))fail('INVALID_SOURCE_STATS');
 return {status:'SOURCE_STATS_ACCEPTED',quarantinedCodesBySource:d.files.map(f=>({source:f.source,conflictingCodes:f.conflictingCodes,invalidRows:f.invalidRecords})),
  publishAllowed:false,next:'REQUIRE_CODE_RECONCILIATION_AND_EXISTING_STORE_CHECKS'};
}
// Exact hash + snapshot binding; a count or an observed percentage is not evidence of completeness.
function planAbsence(delta,{confirmation,sourceSha256,snapshotId}={}){
 const bound=confirmation&&confirmation.mode==='CONFIRMED_FULL_SNAPSHOT'&&confirmation.source===delta.source&&
  typeof sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(sourceSha256)&&confirmation.sha256===sourceSha256&&
  snapshotId!==undefined&&confirmation.snapshotId===snapshotId;
 return delta.entries.filter(e=>e.kind==='ABSENT').map(e=>({code:e.code,source:e.source,warehouses:e.warehouses,
  decision:bound?'REPLACE_MISSING_SUPPLIER_STOCKS_WITH_EXISTING_LOCK_PROTECTION':'PENDING_ABSENCE_REVIEW',
  // Pending availability suspension needs an approved integration with the canonical reader.
  preserveProduct:true,preserveManualAndLocked:true,automaticWritesAllowed:false,
  unresolvedAvailability:'DO_NOT_TREAT_OLD_SUPPLIER_STOCK_AS_FRESH'}));
}
module.exports={newIndex,addRecord,stats,readIndex,compare,reviewDrySummary,planAbsence};

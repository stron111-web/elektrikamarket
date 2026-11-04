'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {readProdatZip,ProdatDeduplicator}=require('../import/prodat.cjs');
const {documentMetadata,normalizeProduct}=require('../import/prodat-normalize.cjs');
const {normalizeBarcodes}=require('../import/prodat-barcodes.cjs');
const {normalizeReferences}=require('../import/prodat-references.cjs');
const {verifyZip,guard}=require('./files.cjs');
const {fingerprint}=require('../import/prodat-import.cjs');
async function preflight(files,{progress=()=>{},maxXmlBytes=2*1024**3}={}){
 guard(Array.isArray(files)&&files.length===2,'COMPLETE_PRODAT_PAIR_REQUIRED');
 const dedup=new ProdatDeduplicator(),categories=new Map(),parts=[],samples=[];
 let invalidRecords=0,categoryConflicts=0,barcodeIssues=0,referenceIssues=0;
 for(const input of files){
  const file=typeof input==='string'?{path:input}:input;
  const before=await fingerprint(file.path);if(file.sha256)guard(file.sha256===before.sha256,'PRODAT_SHA_MISMATCH');
  const zip=await verifyZip(file.path,maxXmlBytes),documents=[];let records=0;
  for await(const {record,source} of readProdatZip(file.path,{onMetadata:m=>documents.push(documentMetadata(m))})){
   records++;let code;
   try{
    const accepted=dedup.accept(record,source);code=accepted.code;
    if(accepted.kind==='conflict'&&samples.length<10)samples.push({type:'CONFLICTING_CODE',code,firstFile:path.basename(accepted.first.zipPath),file:path.basename(file.path)});
    const normalized=normalizeProduct(record);
    for(const c of normalized.categories){const old=categories.get(c.sourceKey);if(old&&(old.name!==c.name||old.parentKey!==c.parentKey)){categoryConflicts++;if(samples.length<10)samples.push({type:'CATEGORY_CONFLICT',key:c.sourceKey});}else categories.set(c.sourceKey,c);}
    barcodeIssues+=normalizeBarcodes(record.EAN).issues.length;
    for(const value of Object.values(normalizeReferences(record,code)))referenceIssues+=value.issues.length;
   }catch(e){invalidRecords++;if(samples.length<10)samples.push({type:'INVALID_RECORD',code:code??null,errorCode:/^[A-Z_]+$/.test(e.code??'')?e.code:'NORMALIZATION_FAILED'});}
   if(records%25000===0)progress({phase:'preflight',file:path.basename(file.path),records});
  }
  guard(documents.length===1&&records>0,'ONE_PRODAT_DOCUMENT_REQUIRED');
  const d=documents[0],expected=path.basename(file.path).match(/^PRODAT_369147_(\d+)\.zip$/i);
  guard(expected&&d.DocumentNumber===expected[1]&&d.SenderGln==='4607166859990'&&d.ReceiverGln==='4607081908611'&&d.documentDate,'PRODAT_IDENTITY_REQUIRED');
  guard((await fingerprint(file.path)).sha256===before.sha256,'PRODAT_FILE_CHANGED');
  parts.push({name:path.basename(file.path),...before,...zip,records,document:d});
 }
 guard(parts[0].document.DocumentDate===parts[1].document.DocumentDate,'PRODAT_MIXED_GENERATION');
 const summary={status:invalidRecords||categoryConflicts||dedup.conflicts?'REJECTED':'VERIFIED',parts,...dedup.summary(),invalidRecords,categoryConflicts,barcodeIssues,referenceIssues,samples};
 return summary;
}
if(require.main===module)(async()=>{const files=process.argv.slice(2);const result=await preflight(files,{progress:x=>console.log(JSON.stringify(x))});if(process.env.PREFLIGHT_OUTPUT)await fs.writeFile(process.env.PREFLIGHT_OUTPUT,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));})().catch(e=>{console.error(JSON.stringify({status:'FAILED',code:e.code??'PREFLIGHT_FAILED'}));process.exitCode=1;});
module.exports={preflight};

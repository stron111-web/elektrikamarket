'use strict';
// Explicit integration entry point. The installed scheduler does not use this module.
// Source absence semantics are approved by the owner in issue #4, 17 Nov 2026.
const {readIndex,reviewDrySummary}=require('./source-review.cjs');
const {importPricat}=require('../import/pricat-import.cjs');
const {fingerprint}=require('../import/prodat-import.cjs');
function requireValue(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
async function validatePair(files,{senderGln,documents,onProgress=()=>{}}={}){
 requireValue(Array.isArray(files)&&files.length===2&&new Set(files.map(f=>f.source)).size===2&&files.every(f=>['PRICAT1','PRICAT2'].includes(f.source)),'EXPLICIT_PAIR_REQUIRED');
 requireValue(senderGln&&documents,'EXPLICIT_SOURCE_IDENTITIES_REQUIRED');
 const indexes=[];
 for(const file of files){
  requireValue(/^[a-f0-9]{64}$/.test(file.sha256||''),'EXPECTED_SHA_REQUIRED');
  const index=await readIndex(file.path,file.source);
  requireValue(index.sha256===file.sha256,'SOURCE_HASH_MISMATCH');
  requireValue(index.document.SenderGln===senderGln&&index.document.DocumentNumber===documents[file.source],'SOURCE_IDENTITY_MISMATCH');
  requireValue(index.document.Currency==='RUB','SOURCE_CURRENCY_MISMATCH');
  indexes.push(index);onProgress({phase:'technical-validation',source:file.source,rows:index.rows});
 }
 return indexes;
}
async function importReviewedPair({databaseUrl,files,identities,reprocess=false,beforeSnapshotActivate=async()=>{},onProgress=()=>{},reportPath}){
 requireValue(databaseUrl,'EXPLICIT_DATABASE_REQUIRED');
 const indexes=await validatePair(files,{...identities,onProgress});
 const dry=await importPricat({databaseUrl,files,mode:'dry-run',conflictPolicy:'quarantine',onProgress});
 const review=reviewDrySummary(dry,indexes.map(i=>({source:i.source,rows:i.rows,sha256:i.sha256})));
 // Recheck exact files at the write boundary. No percentage reduction/issue veto.
 const verify=async()=>{for(const f of files)requireValue((await fingerprint(f.path)).sha256===f.sha256,'SOURCE_CHANGED_AFTER_REVIEW');};
 await verify();
 const result=await importPricat({databaseUrl,files,mode:'production',conflictPolicy:'quarantine',reprocess,onProgress,reportPath,
  beforePublish:verify,beforeSnapshotActivate});
 return {policy:'owner-current-source-v2',review,dry,result};
}
module.exports={validatePair,importReviewedPair};

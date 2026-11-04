'use strict';
// Pre-publication verification only. The caller mounts only a storefront read-only
// URL; no writer credential is accepted or provisioned here.
const fs=require('node:fs'),path=require('node:path'),postgres=require('postgres');
const {privateJson,hash}=require('../../scripts/pricat-update/update.cjs');
const guard=(ok,code)=>{if(!ok)throw Error(code);};
(async()=>{
 const config=await privateJson('/run/prodat-config.json');
 guard(config.version===2&&config.sourceDirectory==='/allstock/TVER/'&&config.publicationEnabled===false,'TVER_CHECK_ONLY_REQUIRED');
 const state=await privateJson('/prodat-state/source-state.json'),candidate=state.currentCandidate;
 guard(candidate?.verified&&candidate.files.length===2&&candidate.verification.status==='VERIFIED'&&!fs.existsSync('/prodat-state/needs-review.json'),'VERIFIED_SOURCE_REQUIRED');
 const hashes=candidate.verification.parts.map(p=>p.sha256),expected=config.initialExpectedChanges;
 guard(expected&&JSON.stringify(hashes)===JSON.stringify(expected.sourceHashes),'REVIEWED_INITIAL_SOURCE_REQUIRED');
 for(const file of candidate.files)guard(await hash(file.path)===candidate.verification.parts.find(p=>p.name===path.basename(file.path))?.sha256,'SOURCE_CACHE_HASH_MISMATCH');
 const backup=JSON.parse(fs.readFileSync('/backup/backup-validation.json','utf8'));
 guard(backup.status==='RESTORE_VERIFIED'&&backup.tablesVerified===19&&backup.liveWrites===false&&backup.network==='none'&&!backup.publishedPorts,'BACKUP_RESTORE_REQUIRED');
 guard(await hash('/backup/database.dump')===backup.sha256,'BACKUP_SHA_MISMATCH');
 const original=JSON.parse(fs.readFileSync('/baseline-fingerprint.json','utf8')),current=JSON.parse(fs.readFileSync('/backup/source-fingerprint.json','utf8'));
 guard(JSON.stringify(original)===JSON.stringify(current),'LIVE_DATA_DIFFERS_FROM_FULL_REHEARSAL');
 const cache=await privateJson('/pricat-state/ftp/state.json');
 guard(!fs.existsSync('/pricat-state/needs-review.json')&&!fs.existsSync('/pricat-state/ftp/needs-review.json'),'PRICAT_NEEDS_REVIEW');
 const u=new URL(fs.readFileSync('/run/readonly-database-url','utf8').trim());u.searchParams.delete('schema');
 guard(decodeURIComponent(u.username)==='storefront_test_ro','STOREFRONT_READONLY_ROLE_REQUIRED');
 const db=postgres(u.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:true,application_name:'prodat-first-publication-readiness'}});
 try{
  const live=await db.begin('isolation level repeatable read read only',async tx=>{
   const [privileges]=await tx`SELECT current_user role,has_table_privilege(current_user,'products','INSERT') can_insert,has_table_privilege(current_user,'products','UPDATE') can_update,has_table_privilege(current_user,'products','DELETE') can_delete`;
   guard(!privileges.can_insert&&!privileges.can_update&&!privileges.can_delete,'UNEXPECTED_CATALOG_WRITE_PRIVILEGES');
   const [products]=await tx`SELECT count(*)::int n FROM products`;
   guard(products.n===expected.beforeProducts,'REVIEWED_BASELINE_PRODUCT_COUNT_CHANGED');
   const snapshots=await tx`SELECT s.id,s."productCount",f1.sha256 hash1,f2.sha256 hash2 FROM assortment_snapshots s JOIN import_files f1 ON f1.id=s."pricat1FileId" JOIN import_files f2 ON f2.id=s."pricat2FileId" WHERE s.active AND f1.status='SUCCEEDED' AND f2.status='SUCCEEDED'`;
   guard(snapshots.length===1,'ONE_ACCEPTED_SNAPSHOT_REQUIRED');const s=snapshots[0];guard(String(s.id)===String(cache.snapshotId),'PRICAT_CACHE_SNAPSHOT_MISMATCH');
   const [last]=await tx`SELECT id,status FROM import_runs WHERE type='PRODAT' ORDER BY id DESC LIMIT 1`;
   return{products:products.n,snapshotId:String(s.id),saleOffers:s.productCount,lastProdatRun:last,readonlyRole:privileges.role,pairHashes:{PRICAT1:s.hash1,PRICAT2:s.hash2}};
  });
  for(const source of ['PRICAT1','PRICAT2']){const file=cache.versions?.[source]?.[0];guard(file&&file.sha256===live.pairHashes[source]&&['zip','xml'].includes(file.format),'ACCEPTED_PRICAT_PAIR_REQUIRED');guard(await hash(path.join('/pricat-state/ftp/versions',source,file.sha256+'.'+file.format))===file.sha256,'PRICAT_CACHE_HASH_MISMATCH');}
  const proof=JSON.parse(fs.readFileSync('/runtime-proof.json','utf8'));for(const [file,expectedHash]of Object.entries(proof.files))guard(await hash('/work/'+file)===expectedHash,'IMAGE_SOURCE_MISMATCH');
  console.log(JSON.stringify({status:'READY_FOR_OWNER_REVIEW',publicationEnabled:false,publicationRequiresSeparatePermission:true,sourceDirectory:config.sourceDirectory,sourceCodes:candidate.verification.uniqueSenderPrdCode,sourceHashes:hashes,backup:{at:backup.at,archive:backup.archive,sha256:backup.sha256,tablesVerified:backup.tablesVerified},fullRehearsalDataMatchesFreshBackup:true,acceptedPricatCacheVerified:true,reprocess:true,expectedCreatedProducts:expected.createdProducts,expectedUpdatedProducts:expected.updatedProducts,priorRehearsalNewSaleOffers:24009,codeCommit:proof.commit,live},null,2));
 }finally{await db.end({timeout:5});}
})().catch(e=>{console.error(JSON.stringify({status:'NOT_READY',code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'READINESS_CHECK_FAILED'}));process.exitCode=1;});

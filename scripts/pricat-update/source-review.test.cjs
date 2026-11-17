'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const AdmZip=require('adm-zip');
const {newIndex,addRecord,stats,readIndex,compare,reviewDrySummary,planAbsence}=require('./source-review.cjs');
const record=(code,extra={})=>({SenderPrdCode:code,UOM:'PCE',ItemsPerUnit:'1',Multiplicity:'1',QTY:'5',RetailPrice:'150',Price2:'100',RetailCurrency:'RUB',...extra});
const index=(codes,source='PRICAT1')=>{const i=newIndex(source);for(const code of codes)addRecord(i,record(code));return i;};
const summary=(n=1,conflicts=0)=>{const files=['PRICAT1','PRICAT2'].map(source=>({source,rows:n,uniqueCodes:n,matched:n,missing:0,sha256:source,invalidRecords:0,conflictingCodes:conflicts,identicalDuplicates:0}));return {status:'DRY_RUN',files,processedRecords:2*n,invalidRecords:0,conflictingCodes:2*conflicts};};
test('99% legitimate contraction does not veto source stats; no publication permission is implied',()=>{
 const d=summary();const r=reviewDrySummary(d,d.files);assert.equal(r.status,'SOURCE_STATS_ACCEPTED');assert.equal(r.publishAllowed,false);
 const delta=compare(index(Array.from({length:100},(_,i)=>String(i))),index(['0']));assert.equal(delta.counts.absent,99);
});
test('reports exact added, absent, retained and changed identities instead of net count',()=>{
 const old=index(['a','b','c']),fresh=index(['b','c','d']);addRecord(fresh,record('b',{QTY:'8'}));
 const d=compare(old,fresh);assert.deepEqual(d.counts,{added:1,absent:1,retained:2,changed:0,quarantined:1});
 assert.deepEqual(d.entries.filter(e=>e.kind==='ABSENT').map(e=>e.code),['a']);
});
test('same counts and unknown padding do not hide removed identities',()=>{
 const d=compare(index(['a','b']),index(['x','y']));assert.equal(d.counts.absent,2);assert.equal(d.counts.added,2);
});
test('a valid changed record is counted without converting quantities or packaging',()=>{
 const fresh=newIndex('PRICAT1');addRecord(fresh,record('a',{QTY:'6',UOM:'NMP',ItemsPerUnit:'100'}));
 const d=compare(index(['a']),fresh);assert.equal(d.counts.changed,1);assert.equal(d.counts.quarantined,0);
 assert.equal(fresh.codes.get('a').stocks[0].quantity,'6');assert.equal(fresh.codes.get('a').commercial.itemsPerUnit,'100');
});
test('identical duplicates are harmless; conflicting duplicates quarantine every version of that source code',()=>{
 const fresh=index(['a','b']);addRecord(fresh,record('a'));assert.equal(stats(fresh).identicalDuplicates,1);
 addRecord(fresh,record('b',{RetailPrice:'200'}));assert.equal(stats(fresh).conflictingCodes,1);
 const d=compare(index(['a','b']),fresh);assert.equal(d.entries.find(e=>e.code==='b').action,'QUARANTINE_SOURCE_CODE_KEEP_OTHER_SOURCE');
 assert.equal(d.entries.find(e=>e.code==='a').action,'EXISTING_IMPORTER_AND_STORE_VALIDATION');
});
test('68 conflicts with a changing denominator never veto the entire nonempty pair',()=>{
 for(const n of [174404,171832,174511]){const d=summary(n,34);assert.equal(reviewDrySummary(d,d.files).status,'SOURCE_STATS_ACCEPTED');}
});
test('known invalid quantity is quarantined without being reclassified as missing',()=>{
 const fresh=newIndex('PRICAT1');addRecord(fresh,record('a',{QTY:'-5'}));
 const d=compare(index(['a']),fresh);assert.equal(d.counts.absent,0);assert.equal(d.entries[0].kind,'INVALID_RECORD');
});
test('unidentifiable code aborts; unsafe package decimals remain invalid',()=>{
 assert.throws(()=>addRecord(newIndex('PRICAT1'),record('')),{code:'UNIDENTIFIABLE_RECORD'});
 assert.throws(()=>addRecord(newIndex('PRICAT1'),record(['a','b'])),{code:'UNIDENTIFIABLE_RECORD'});
 const i=newIndex('PRICAT1');addRecord(i,record('a',{ItemsPerUnit:'-1'}));assert.equal(stats(i).invalidRecords,1);
});
test('negative price, ambiguous unit/package and conflicting currency remain invalid records',()=>{
 for(const extra of [{RetailPrice:'-1'},{UOM:['PCE','MTR']},{ItemsPerUnit:['1','10']},{RetailCurrency:'USD'}]){
  const fresh=newIndex('PRICAT1');addRecord(fresh,record('a',extra));
  assert.equal(compare(index(['a']),fresh).entries[0].kind,'INVALID_RECORD');
 }
});
test('unit/package changes are exposed for existing store checks, never declared saleable',()=>{
 const current=newIndex('PRICAT1');addRecord(current,record('a',{UOM:'NMP',ItemsPerUnit:'100'}));
 const e=compare(index(['a']),current).entries[0];assert.equal(e.commercialChanged,true);assert.equal(e.action,'EXISTING_IMPORTER_AND_STORE_VALIDATION');
});
test('absence is source-scoped; unrelated warehouses are not included',()=>{
 const one=compare(index(['a']),index(['b'])),two=compare(index(['a'],'PRICAT2'),index(['b'],'PRICAT2'));
 assert.deepEqual(one.entries.find(e=>e.kind==='ABSENT').warehouses,['stock1','stock3']);
 assert.deepEqual(two.entries.find(e=>e.kind==='ABSENT').warehouses,['stock2']);
 assert.throws(()=>compare(index(['a']),index(['a'],'PRICAT2')),{code:'SOURCE_MISMATCH'});
});
test('absence requires exact SHA/source/snapshot confirmation; no code writes even after confirmation',()=>{
 const d=compare(index(['a']),index(['b'])),sha='a'.repeat(64),c={mode:'CONFIRMED_FULL_SNAPSHOT',source:'PRICAT1',sha256:sha,snapshotId:8};
 for(const confirmation of [undefined,{...c,sha256:'b'.repeat(64)},{...c,source:'PRICAT2'},{...c,snapshotId:7}]){
  const p=planAbsence(d,{confirmation,sourceSha256:sha,snapshotId:8})[0];
  assert.equal(p.decision,'BLOCK_SOURCE_PUBLICATION_UNCONFIRMED_FULL_SNAPSHOT');assert.equal(p.publicationBlocked,true);assert.equal(p.oldQuantityFallbackAllowed,false);
 }
 const p=planAbsence(d,{confirmation:c,sourceSha256:sha,snapshotId:8})[0];assert.equal(p.decision,'REPLACE_MISSING_SUPPLIER_STOCKS_WITH_EXISTING_LOCK_PROTECTION');assert.equal(p.automaticWritesAllowed,false);assert(p.preserveManualAndLocked);assert.equal(p.sourceAvailability,'UNAVAILABLE');
});
test('confirmed absence disallows fallback and affects only the supplier source warehouses',()=>{
 for(const [source,warehouses] of [['PRICAT1',['stock1','stock3']],['PRICAT2',['stock2']]]){
  const d=compare(index(['a'],source),index(['b'],source)),sha='c'.repeat(64);
  const [p]=planAbsence(d,{sourceSha256:sha,snapshotId:8,confirmation:{mode:'CONFIRMED_FULL_SNAPSHOT',source,sha256:sha,snapshotId:8}});
  assert.deepEqual(p.warehouses,warehouses);assert.equal(p.oldQuantityFallbackAllowed,false);assert.equal(p.sourceAvailability,'UNAVAILABLE');assert(p.preserveProduct);
 }
});
test('reappearing code uses the new supplier record and does not inherit its previous quarantine',()=>{
 const old=newIndex('PRICAT1');addRecord(old,record('a',{QTY:'-1'}));
 const absent=index(['b']),returned=newIndex('PRICAT1');addRecord(returned,record('a',{QTY:'7',RetailPrice:'250'}));addRecord(returned,record('b'));
 const e=compare(absent,returned).entries.find(x=>x.code==='a');assert.equal(e.kind,'ADDED');assert.equal(e.action,'EXISTING_IMPORTER_AND_STORE_VALIDATION');
 assert.equal(returned.codes.get('a').stocks[0].quantity,'7');assert.notEqual(returned.codes.get('a').hash,old.codes.get('a').hash);
 assert.equal(compare(old,returned).entries.find(x=>x.code==='a').kind,'RETAINED');assert.equal(returned.codes.get('a').invalid,false);
});
test('empty, incomplete, mismatched and inconsistent source stats remain blocking',()=>{
 for(const mutate of [d=>d.files.pop(),d=>d.files[1].source='PRICAT1',d=>d.files[0].rows=0,d=>d.files[0].matched=-1,d=>d.files[0].uniqueCodes=999,d=>d.conflictingCodes=9]){
  const d=summary();mutate(d);assert.throws(()=>reviewDrySummary(d,d.files));
 }
 const d=summary(),received=structuredClone(d.files);received[0].sha256='other';assert.throws(()=>reviewDrySummary(d,received),{code:'DRY_RUN_SOURCE_MISMATCH'});
});
test('real parser rejects malformed XML, DTD, empty file, wrong DocType and bad ZIP CRC without a database',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pricat-source-review-'));
 const body='<Document><DocType>PRICAT</DocType><Currency>RUB</Currency><DocumentNumber>fixture</DocumentNumber><DocumentDate>20261101000000</DocumentDate><DocDetail><SenderPrdCode>a</SenderPrdCode><UOM>PCE</UOM><QTY>5</QTY></DocDetail></Document>';
 try{
  for(const [label,xml] of [['truncated',body.slice(0,-9)],['doctype','<!DOCTYPE Document>'+body],['empty',body.replace(/<DocDetail>.*<\/DocDetail>/,'')],['type',body.replace('PRICAT','PRODAT')]]){
   const file=path.join(dir,label+'.xml');await fs.writeFile(file,xml);await assert.rejects(readIndex(file,'PRICAT1'));
  }
  const good=path.join(dir,'good.xml');await fs.writeFile(good,body);assert.equal((await readIndex(good,'PRICAT1')).rows,1);
  const zip=new AdmZip();zip.addFile('one.xml',Buffer.from(body));let b=zip.toBuffer();const central=b.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));b.writeUInt32LE((b.readUInt32LE(central+16)^0xffffffff)>>>0,central+16);
  const bad=path.join(dir,'bad.zip');await fs.writeFile(bad,b);await assert.rejects(readIndex(bad,'PRICAT1'),{code:'ZIP_CRC_OR_SIZE'});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

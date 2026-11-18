'use strict';
// Controlled mutations of complete retained XML, on the SAME existing isolated restore only.
const fs=require('node:fs'),fsp=fs.promises,assert=require('node:assert/strict'),postgres=require('postgres'),unzipper=require('unzipper'),{once}=require('node:events'),{createHash}=require('node:crypto');
const {importReviewedPair}=require('./reviewed-import.cjs'),{readAvailableStocks,readStorefrontPrices}=require('../import/pricat-store.cjs');
const {streamZipEntry}=require('../import/pricat-zip.cjs');
const DB='pricat_restore_20261117t152456z',SC='pricat_v2_test_20261117',URL='postgres://fixture_admin@127.0.0.1:5432/'+DB,db=postgres(URL,{max:1,onnotice:()=>{}}),OUT='/results';
const input=require('/results/inputs.json').nov6,events=[];let progress=Date.now();
function event(kind,data={}){progress=Date.now();const x={at:new Date().toISOString(),kind,...data};events.push(x);console.log(JSON.stringify(x));}
const watchdog=setInterval(()=>{if(Date.now()-progress>300000){console.error('FIXTURE_NO_PROGRESS_300S');process.exit(124);}},10000);
async function save(){await fsp.writeFile(OUT+'/edge-results.json',JSON.stringify(events,null,2));}
async function stocks(codes){return db`SELECT p."supplierCode",w.code warehouse,s.* FROM product_stocks s JOIN products p ON p.id=s."productId" JOIN warehouses w ON w.id=s."warehouseId" WHERE p."supplierCode" IN ${db(codes)} ORDER BY p."supplierCode",w.code`;}
const businessRows=rows=>rows.map(({updatedAt,importFileId,...r})=>r);
async function snapshot(){return (await db`SELECT id,"productCount" FROM assortment_snapshots WHERE active`)[0];}
async function fingerprint(){const out={};for(const t of ['product_prices','product_stocks','product_commercial_data','products','product_features'])out[t]=(await db.unsafe(`SELECT count(*)::text count,sum(hashtextextended(to_jsonb(t)::text,0)::numeric)::text hash FROM public.${t} t`))[0];return out;}
const change=(text,tag,value)=>{const r=new RegExp('<'+tag+'(?:\\s[^>]*)?>[\\s\\S]*?</'+tag+'>|<'+tag+'\\s*/>');assert.ok(r.test(text),'Missing target field '+tag);return text.replace(r,'<'+tag+'>'+value+'</'+tag+'>');};
async function mutate(file,target,mutations){
 const stream=/\.zip$/.test(file.path)?streamZipEntry(file.path,(await unzipper.Open.file(file.path)).files.find(e=>/\.xml$/.test(e.path))):fs.createReadStream(file.path);
 const out=fs.createWriteStream(target,{flags:'wx',mode:0o600});let pending='',changed=0;const seen=new Set();
 const write=async s=>{if(!out.write(Buffer.from(s,'latin1')))await once(out,'drain');};
 try{for await(const chunk of stream){pending+=chunk.toString('latin1');let end;
  while((end=pending.indexOf('</DocDetail>'))!==-1){end+='</DocDetail>'.length;let segment=pending.slice(0,end);pending=pending.slice(end);const code=segment.match(/<SenderPrdCode>([^<]+)<\/SenderPrdCode>/)?.[1];if(mutations.has(code)){const start=segment.indexOf('<DocDetail>');assert.ok(start>=0);segment=segment.slice(0,start)+mutations.get(code)(segment.slice(start));seen.add(code);changed++;}await write(segment);}
 }await write(pending);out.end();await once(out,'finish');}catch(e){out.destroy();throw e;}
 assert.equal(seen.size,mutations.size,'Every selected mutation must match');const h=createHash('sha256');for await(const b of fs.createReadStream(target))h.update(b);event('synthetic-file',{source:file.source,changedRecords:changed,sha256:h.digest('hex')});
 const hash=createHash('sha256');for await(const b of fs.createReadStream(target))hash.update(b);return {...file,path:target,sha256:hash.digest('hex')};
}
async function run(label,files,extra={}){event('start',{label});const r=await importReviewedPair({databaseUrl:URL,files,identities:{senderGln:'4607166859990',documents:input.documents},onProgress:p=>event('progress',{label,...p}),reportPath:OUT+'/'+label+'-issues.ndjson',...extra});await fsp.writeFile(OUT+'/'+label+'-summary.json',JSON.stringify(r,null,2));event('published',{label,result:r.result});await save();return r;}
async function resumeControls(){
 const prior=JSON.parse(await fsp.readFile(OUT+'/edge-results.json'));events.push(...prior);
 assert.ok(prior.some(e=>e.kind==='changed-values-rollback-pass'));
 assert.ok(!prior.some(e=>e.kind==='controlled-cases-pass'||e.kind==='edge-complete'));
 const checkpoint=await snapshot();assert.equal(String(checkpoint.id),'10','Interrupted controlled snapshot');assert.equal(checkpoint.productCount,131544,'Interrupted controlled count');
 const controls=prior.find(e=>e.kind==='controls');assert.ok(controls);const cases=controls.cases,chosen=Object.values(cases),codes=chosen.map(r=>r.code),nmp=cases.nmp;
 const originalStocks=await db.unsafe(`SELECT p."supplierCode",w.code warehouse,s.* FROM ${SC}.rollback_stocks s JOIN products p ON p.id=s."productId" JOIN warehouses w ON w.id=s."warehouseId" WHERE p."supplierCode" IN (${codes.map((_,i)=>'$'+(i+1)).join(',')}) ORDER BY p."supplierCode",w.code`,codes);
 const originalPrice=await db`SELECT * FROM ${db(SC+'.rollback_prices')} WHERE id IN ${db(chosen.map(r=>r.price1))}`;
 const [nmpContext]=await db`SELECT * FROM ${db(SC+'.rollback_commercial')} WHERE id=${nmp.c1}`;
 const contexts=await db`SELECT * FROM product_commercial_data WHERE "productId"=${nmpContext.productId} AND source='MANUAL'`;assert.equal(contexts.length,1);const manualContext=contexts[0];
 const prices=await db`SELECT * FROM product_prices WHERE "commercialDataId"=${manualContext.id}`;assert.equal(prices.length,1);const manualPrice=prices[0];assert.equal(Number(manualPrice.retailPrice),321.09);
 // Exact checkpoint equality with ONLY the deliberately seeded rows/protection bits allowed.
 const seedIds=[cases.unit.price1,cases.package.price1];assert.deepEqual(seedIds,[1340,4040]);assert.equal(cases.lockedAbsent.stock1,7258);
 for(const [short,table,excluded,seed] of [['prices','product_prices',manualPrice.id,seedIds],['stocks','product_stocks',-1,[7258]],['commercial','product_commercial_data',manualContext.id,[]]]){
  const override=seed.length?`CASE WHEN b.id IN (${seed.join(',')}) THEN to_jsonb(b)||jsonb_build_object('isLocked',true) ELSE to_jsonb(b) END`:'to_jsonb(b)';
  const [check]=await db.unsafe(`SELECT count(*)::int differences FROM ${SC}.rollback_${short} b FULL JOIN (SELECT * FROM public.${table} WHERE id<>$1) n USING(id) WHERE (${override}) IS DISTINCT FROM to_jsonb(n)`,[excluded]);assert.equal(check.differences,0,'Post-pause rollback/seed checkpoint mismatch: '+short);
 }
 const protectedStocks=originalStocks.map(r=>r.id===7258?{...r,isLocked:true}:r);
 const lockedPrices=await db`SELECT * FROM product_prices WHERE id IN ${db(seedIds)} ORDER BY id`;
 const retainedContexts=await db`SELECT * FROM product_commercial_data WHERE id IN ${db([cases.unit.c1,cases.package.c1])} ORDER BY id`;
 const initialPrices=await readStorefrontPrices(db,codes),beforeSnapshot=await snapshot();
 const synthetic=prior.filter(e=>e.kind==='synthetic-file');assert.equal(synthetic.length,2);
 const f1={...input.files[0],path:OUT+'/synthetic-PRICAT1.xml',sha256:synthetic.find(e=>e.source==='PRICAT1').sha256};
 const f2={...input.files[1],path:OUT+'/synthetic-PRICAT2.xml',sha256:synthetic.find(e=>e.source==='PRICAT2').sha256};
 event('night-pause-resume',{interruptedTransactionRolledBack:true,exactCheckpointAndSeedRowsVerified:true,snapshot:beforeSnapshot});await save();
 return {cases,chosen,codes,nmp,originalStocks,originalPrice,nmpContext,manualContext,manualPrice,protectedStocks,lockedPrices,retainedContexts,initialPrices,beforeSnapshot,f1,f2};
}
async function main(){
 assert.equal((await db`SELECT current_database() d`)[0].d,DB);assert.equal((await fsp.readFile('/proc/net/route','utf8')).trim().split('\n').length,1);
 const prior=JSON.parse(await fsp.readFile(OUT+'/results.json'));assert.ok(prior.some(e=>e.kind==='real-sequence-complete'));assert.ok(prior.some(e=>e.kind==='rollback-pass'));
 let state;
 if(process.argv.includes('--resume-controls'))state=await resumeControls();
 else {
 const chosen=await db.unsafe(`SELECT p."supplierCode" code,c1.id c1,pr1.id price1,s1.id stock1 FROM products p JOIN product_commercial_data c1 ON c1."productId"=p.id AND c1.source='PRICAT1' JOIN product_prices pr1 ON pr1."commercialDataId"=c1.id JOIN product_commercial_data c2 ON c2."productId"=p.id AND c2.source='PRICAT2' JOIN product_prices pr2 ON pr2."commercialDataId"=c2.id JOIN product_stocks s1 ON s1."productId"=p.id AND s1."warehouseId"=(SELECT id FROM warehouses WHERE code='stock1') JOIN product_stocks s2 ON s2."productId"=p.id AND s2."warehouseId"=(SELECT id FROM warehouses WHERE code='stock2') JOIN product_stocks s3 ON s3."productId"=p.id AND s3."warehouseId"=(SELECT id FROM warehouses WHERE code='stock3') JOIN ${SC}.source_codes q1 ON q1.phase='nov6' AND q1.source='PRICAT1' AND q1.code=p."supplierCode" JOIN ${SC}.source_codes q2 ON q2.phase='nov6' AND q2.source='PRICAT2' AND q2.code=p."supplierCode" WHERE NOT p."isArchived" AND c1.uom='PCE' AND c2.uom='PCE' AND NOT c1."isLocked" AND NOT c2."isLocked" AND NOT pr1."isLocked" AND NOT pr2."isLocked" AND NOT s1."isLocked" AND NOT s2."isLocked" AND NOT s3."isLocked" AND s1.source='PRICAT1' AND s2.source='PRICAT2' AND s3.source='PRICAT1' AND s1.uom='PCE' AND s2.uom='PCE' AND s3.uom='PCE' AND s1.quantity>0 AND s2.quantity>0 AND s3.quantity>0 AND cardinality(p."lockedFields")=0 AND NOT q1.conflict AND NOT q2.conflict AND NOT q1.invalid AND NOT q2.invalid AND pr2."price2">0 AND pr2."retailPrice">0 ORDER BY p.id LIMIT 10`);
 assert.equal(chosen.length,10,'Need ten existing unprotected controls');
 const initialAvailable=await readAvailableStocks(db,chosen.map(r=>r.code));
 const initialPrices=await readStorefrontPrices(db,chosen.map(r=>r.code));
 for(const r of chosen)assert.ok(initialAvailable.some(s=>s.supplierCode===r.code&&s.source==='PRICAT1')&&initialAvailable.some(s=>s.supplierCode===r.code&&s.source==='PRICAT2'),'Control must initially be available in both sources');
 const names=['conflict','invalid','unit','package','lockedAbsent','absent','empty','price','source2Absent','partnerUnit'],cases=Object.fromEntries(chosen.map((r,i)=>[names[i],r]));
 const [nmp]=await db.unsafe(`SELECT p."supplierCode" code,c.id c1,pr.id price1,s.id stock1,c."itemsPerUnit" FROM products p JOIN product_commercial_data c ON c."productId"=p.id AND c.source='PRICAT1' JOIN product_prices pr ON pr."commercialDataId"=c.id JOIN product_stocks s ON s."productId"=p.id AND s."warehouseId"=(SELECT id FROM warehouses WHERE code='stock1') JOIN ${SC}.source_codes q ON q.phase='nov6' AND q.source='PRICAT1' AND q.code=p."supplierCode" WHERE NOT p."isArchived" AND c.uom='NMP' AND s.uom='NMP' AND s.source='PRICAT1' AND c."itemsPerUnit">1 AND s.quantity>0 AND pr."retailPrice">0 AND pr."price2">0 AND NOT c."isLocked" AND NOT pr."isLocked" AND NOT s."isLocked" AND cardinality(p."lockedFields")=0 AND NOT q.conflict AND NOT q.invalid ORDER BY p.id LIMIT 1`);
 assert.ok(nmp,'Need an existing NMP package control');cases.nmp=nmp;chosen.push(nmp);const codes=chosen.map(r=>r.code);
 event('controls',{synthetic:true,cases});await save();
 // Save complete before rows for exact checks; only three protection bits are seeded.
 const originalStocks=await stocks(codes),originalPrice=await db`SELECT * FROM product_prices WHERE id IN ${db(chosen.map(r=>r.price1))}`;
 const [nmpContext]=await db`SELECT * FROM product_commercial_data WHERE id=${nmp.c1}`;
 assert.equal((await db`SELECT id FROM product_commercial_data WHERE "productId"=${nmpContext.productId} AND source='MANUAL'`).length,0,'Manual seed must not replace existing data');
 const [manualContext]=await db`INSERT INTO product_commercial_data("productId",source,uom,"itemsPerUnit","itemsPerUom","updatedAt") VALUES(${nmpContext.productId},'MANUAL',${nmpContext.uom},${nmpContext.itemsPerUnit},${nmpContext.itemsPerUom},NOW()) RETURNING *`;
 const [manualPrice]=await db`INSERT INTO product_prices("commercialDataId","retailPrice",currency,"retailCurrency","updatedAt") VALUES(${manualContext.id},321.09,'RUB','RUB',NOW()) RETURNING *`;
 await db`UPDATE product_prices SET "isLocked"=true WHERE id IN ${db([cases.unit.price1,cases.package.price1])}`;
 await db`UPDATE product_stocks SET "isLocked"=true WHERE id=${cases.lockedAbsent.stock1}`;
 const lockedPrices=await db`SELECT * FROM product_prices WHERE id IN ${db([cases.unit.price1,cases.package.price1])} ORDER BY id`;
 const retainedContexts=await db`SELECT * FROM product_commercial_data WHERE id IN ${db([cases.unit.c1,cases.package.c1])} ORDER BY id`;
 const protectedStocks=await stocks(codes),beforeSnapshot=await snapshot();
 const m1=new Map([
  [cases.conflict.code,s=>s+change(s,'QTY','12345')],
  [cases.invalid.code,s=>change(s,'QTY','-1')],
  [cases.unit.code,s=>change(s,'UOM','MTR')],
  [cases.package.code,s=>change(s,'ItemsPerUnit','999')],
  [cases.lockedAbsent.code,()=> ''],[cases.absent.code,()=> ''],
  [cases.empty.code,s=>change(change(s,'QTY',''),'PartnerQTY','')]
  ,[cases.nmp.code,s=>change(change(change(s,'QTY','2'),'RetailPrice','200.00'),'Price2','100.00')]
  ,[cases.partnerUnit.code,s=>change(s,'PartnerUOM','MTR')]
 ]),m2=new Map([[cases.price.code,s=>change(change(s,'RetailPrice','1.00'),'Price2','100.00')],[cases.source2Absent.code,()=> '']]);
 const f1=await mutate(input.files[0],OUT+'/synthetic-PRICAT1.xml',m1),f2=await mutate(input.files[1],OUT+'/synthetic-PRICAT2.xml',m2);
 const rollbackBefore=await fingerprint(),rollbackSnapshot=await snapshot();let reachedActivation=false;
 await assert.rejects(run('changed-values-rollback',[f1,f2],{reprocess:true,beforeSnapshotActivate:async()=>{assert.deepEqual(await snapshot(),rollbackSnapshot);reachedActivation=true;throw Error('CONTROLLED_CHANGED_VALUES_ROLLBACK');}}),/CONTROLLED_CHANGED_VALUES_ROLLBACK/);
 assert.ok(reachedActivation);assert.deepEqual(await fingerprint(),rollbackBefore);assert.deepEqual(await snapshot(),rollbackSnapshot);
 event('changed-values-rollback-pass',{pricesStocksAndContextsExactFingerprintPreserved:true,oldSnapshotVisibleUntilFailure:true});await save();
 state={cases,chosen,codes,nmp,originalStocks,originalPrice,nmpContext,manualContext,manualPrice,protectedStocks,lockedPrices,retainedContexts,initialPrices,beforeSnapshot,f1,f2};
 }
 const {cases,chosen,codes,nmp,originalStocks,originalPrice,nmpContext,manualContext,manualPrice,protectedStocks,lockedPrices,retainedContexts,initialPrices,beforeSnapshot,f1,f2}=state;
 await run('controlled-cases',[f1,f2],{reprocess:true});
 const after=await stocks(codes),available=await readAvailableStocks(db,codes);
 for(const name of ['conflict','invalid']){const code=cases[name].code;assert.ok(after.filter(r=>r.supplierCode===code&&r.source==='PRICAT1').every(r=>r.quantity===null));assert.ok(available.filter(r=>r.supplierCode===code).every(r=>r.warehouse==='stock2'));}
 for(const name of ['unit','package']){const code=cases[name].code;assert.deepEqual(after.filter(r=>r.supplierCode===code&&r.source==='PRICAT1'),protectedStocks.filter(r=>r.supplierCode===code&&r.source==='PRICAT1'));assert.ok(!available.some(r=>r.supplierCode===code&&r.source==='PRICAT1'));}
 assert.deepEqual(await db`SELECT * FROM product_prices WHERE id IN ${db([cases.unit.price1,cases.package.price1])} ORDER BY id`,lockedPrices);
 assert.deepEqual(await db`SELECT * FROM product_commercial_data WHERE id IN ${db([cases.unit.c1,cases.package.c1])} ORDER BY id`,retainedContexts);
 for(const name of ['absent','empty'])assert.ok(after.filter(r=>r.supplierCode===cases[name].code&&r.source==='PRICAT1').every(r=>Number(r.quantity)===0));
 assert.deepEqual(after.find(r=>r.id===cases.lockedAbsent.stock1),protectedStocks.find(r=>r.id===cases.lockedAbsent.stock1));assert.ok(!available.some(r=>r.supplierCode===cases.lockedAbsent.code&&r.warehouse==='stock1'));
 assert.equal(Number(after.find(r=>r.supplierCode===cases.lockedAbsent.code&&r.warehouse==='stock3').quantity),0);
 // A PRICAT1 mutation never changes the other source's stock, even for quarantine.
 assert.deepEqual(businessRows(after.filter(r=>r.source==='PRICAT2'&&r.supplierCode!==cases.source2Absent.code)),businessRows(originalStocks.filter(r=>r.source==='PRICAT2'&&r.supplierCode!==cases.source2Absent.code)));
 assert.equal(Number(after.find(r=>r.supplierCode===cases.source2Absent.code&&r.warehouse==='stock2').quantity),0);
 assert.deepEqual(businessRows(after.filter(r=>r.supplierCode===cases.source2Absent.code&&r.source==='PRICAT1')),businessRows(originalStocks.filter(r=>r.supplierCode===cases.source2Absent.code&&r.source==='PRICAT1')));
 assert.ok(!available.some(r=>r.supplierCode===cases.source2Absent.code&&r.warehouse==='stock2'));assert.ok(available.some(r=>r.supplierCode===cases.source2Absent.code&&r.source==='PRICAT1'));
 const [absencePrice]=await readStorefrontPrices(db,[cases.source2Absent.code]);assert.deepEqual(absencePrice,initialPrices.find(p=>p.supplierCode===cases.source2Absent.code));
 event('source2-absence-pass',{code:cases.source2Absent.code,stock2:0,stock1And3Unchanged:true,priceSource:absencePrice.priceSource,pricePreservedWithExistingPriority:true});
 assert.deepEqual(after.find(r=>r.supplierCode===cases.partnerUnit.code&&r.warehouse==='stock3'),originalStocks.find(r=>r.supplierCode===cases.partnerUnit.code&&r.warehouse==='stock3'));
 assert.ok(!available.some(r=>r.supplierCode===cases.partnerUnit.code&&r.warehouse==='stock3'));assert.ok(available.some(r=>r.supplierCode===cases.partnerUnit.code&&r.warehouse==='stock1'));
 event('warehouse-uom-quarantine-pass',{code:cases.partnerUnit.code,stock3Excluded:true,stock1StillAvailable:true,storedStock3Preserved:true});
 const [selectedPrice]=await readStorefrontPrices(db,[cases.price.code]);assert.equal(selectedPrice.priceSource,'PRICAT2');assert.equal(Number(selectedPrice.retailPrice),130);
 const [nmpPrice]=await db`SELECT "retailPrice" FROM product_prices WHERE id=${nmp.price1}`;
 assert.equal(Number(nmpPrice.retailPrice),200);assert.equal(Number(after.find(r=>r.id===nmp.stock1).quantity),2);
 event('nmp-package-pass',{code:nmp.code,itemsPerUnit:nmp.itemsPerUnit,storedQuantity:2,storedPrice:200,divisionOrMultiplicationApplied:false});
 const [manualOffer]=await readStorefrontPrices(db,[nmp.code]);assert.equal(manualOffer.priceSource,'MANUAL');assert.equal(Number(manualOffer.retailPrice),321.09);
 assert.deepEqual((await db`SELECT * FROM product_prices WHERE id=${manualPrice.id}`)[0],manualPrice);assert.deepEqual((await db`SELECT * FROM product_commercial_data WHERE id=${manualContext.id}`)[0],manualContext);event('manual-priority-pass',{code:nmp.code,price:321.09,exactRowsPreserved:true});
 const issues=await db`SELECT code,count(*)::int count FROM import_issues WHERE "runId"=(SELECT max(id) FROM import_runs) GROUP BY code ORDER BY code`;
 event('controlled-cases-pass',{beforeSnapshot,afterSnapshot:await snapshot(),issues,protectivePrice:130,otherSourceStocksUnchanged:true,conflictAndInvalidQuarantined:true,lockedUnitAndPackagePreserved:true,absentAndEmptyZeroed:true});await save();
 // Restore the three test-seeded protection flags, then reprocess original supplier pair.
 for(const row of originalPrice.filter(r=>[cases.unit.price1,cases.package.price1].includes(r.id)))await db`UPDATE product_prices SET "isLocked"=${row.isLocked} WHERE id=${row.id}`;
 const saved=originalStocks.find(r=>r.id===cases.lockedAbsent.stock1);await db`UPDATE product_stocks SET "isLocked"=${saved.isLocked} WHERE id=${saved.id}`;
 await db.begin(async tx=>{await tx`DELETE FROM product_prices WHERE id=${manualPrice.id} AND "commercialDataId"=${manualContext.id}`;await tx`DELETE FROM product_commercial_data WHERE id=${manualContext.id} AND source='MANUAL' AND "productId"=${nmpContext.productId}`;});
 await run('return-original-after-controls',input.files,{reprocess:true});
 const returned=await stocks(codes);
 for(const old of originalStocks){const fresh=returned.find(r=>r.id===old.id);assert.equal(fresh.quantity,old.quantity);assert.equal(fresh.uom,old.uom);assert.equal(fresh.isLocked,old.isLocked);}
 for(const name of ['conflict','invalid','unit','package','absent','empty','lockedAbsent'])assert.ok((await readAvailableStocks(db,[cases[name].code])).some(r=>r.source==='PRICAT1'),'Returned source must be available: '+name);
 assert.ok((await readAvailableStocks(db,[cases.lockedAbsent.code])).some(r=>r.warehouse==='stock1'),'Confirmed protected stock must leave quarantine');
 assert.ok((await readAvailableStocks(db,[cases.source2Absent.code])).some(r=>r.source==='PRICAT2'));
 assert.ok((await readAvailableStocks(db,[cases.partnerUnit.code])).some(r=>r.warehouse==='stock3'));
 event('return-original-pass',{rows:returned.length,state:await snapshot()});
 // Corrupt/empty technical candidates must fail before touching source data or snapshots.
 const before=await fingerprint(),snap=await snapshot();
 for(const [name,content] of [['truncated','<Document><DocType>PRICAT</DocType>'],['empty','']]){const file=OUT+'/rejected-'+name+'.xml';await fsp.writeFile(file,content);const bad={...input.files[0],path:file,sha256:createHash('sha256').update(content).digest('hex')};await assert.rejects(run('reject-'+name,[bad,input.files[1]],{reprocess:true}));assert.deepEqual(await fingerprint(),before);assert.deepEqual(await snapshot(),snap);event('technical-rejection-pass',{name,noWrites:true});}
 event('edge-complete',{snapshot:await snapshot()});await save();
}
main().catch(async e=>{event('FAILED',{error:e.message,code:e.code||null});await save();process.exitCode=1;}).finally(async()=>{clearInterval(watchdog);await db.end({timeout:5});});

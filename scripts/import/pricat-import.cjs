'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { createHash } = require('node:crypto');
const postgres = require('postgres');
const { fingerprint, connectionUrl } = require('./prodat-import.cjs');
const { readPricat } = require('./pricat.cjs');
const { normalizePricat, decimal } = require('./pricat-normalize.cjs');
const { applyBatch } = require('./pricat-store.cjs');
const VERSION = 'pricat-v1.0.1';
const LOCK = 1707312402;
const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : v && typeof v === 'object'
  ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}' : JSON.stringify(v);
async function transaction(db, work) {
  await db`BEGIN`;
  try { const result = await work(); await db`COMMIT`; return result; }
  catch(e) { try { await db`ROLLBACK`; } catch {} throw e; }
}
async function* spoolRows(file) {
  const stream = fs.createReadStream(file);
  const lines = readline.createInterface({ input:stream, crlfDelay:Infinity });
  try { for await (const line of lines) yield JSON.parse(line); }
  finally { lines.close(); stream.destroy(); }
}

// Explicit mode and source prevent an accidental production invocation or inferred warehouse.
async function importPricat({databaseUrl, files, mode='dry-run', batchSize=500, reportPath,
  conflictPolicy='quarantine', reprocess=false, onProgress=()=>{}, beforePublish=async()=>{}}) {
  if (!['dry-run','production'].includes(mode)) throw new Error('Invalid mode');
  if (!['reject','quarantine'].includes(conflictPolicy)) throw new Error('Invalid conflict policy');
  if (!Number.isInteger(batchSize) || batchSize<1 || batchSize>5000) throw new Error('Invalid batchSize');
  if (!files?.length || files.some(f=>!f.path || !['PRICAT1','PRICAT2'].includes(f.source)) || new Set(files.map(f=>f.source)).size!==files.length)
    throw new Error('One explicit file per PRICAT source required');
  if(reportPath && files.some(f=>path.resolve(f.path)===path.resolve(reportPath)))throw new Error('Report must not overwrite a source file');
  const sql = postgres(connectionUrl(databaseUrl),{max:1,connect_timeout:10,onnotice:()=>{}});
  let db,runId,locked=false,dir,report;
  let peakRssBytes=process.memoryUsage().rss;
  const summary={version:VERSION,mode,processedRecords:0,matchedProducts:0,missingProducts:0,conflictingCodes:0,
    identicalDuplicates:0,anomalousPrices:0,invalidRecords:0,protectedRecords:0,updatedRecords:0,warningCount:0,errorCount:0,
    warehouses:{},files:[]};
  const inputs=[];
  const matchedCodes=new Set(),missingCodes=new Set();
  async function issue(input,row,code,message,details,severity='WARNING') {
    const value={source:input.source,supplierCode:row?.supplierCode ?? null,recordNumber:row?.index ?? null,
      xmlName:row?.xmlName ?? null,code,message,severity,details};
    summary[severity==='ERROR'?'errorCount':'warningCount']++;
    if(report) await report.write(JSON.stringify(value)+'\n');
    if(mode==='production') await db`INSERT INTO public.import_issues
      ("runId","fileId",severity,code,"supplierCode","recordNumber",message,details)
      VALUES (${runId},${input.id ?? null},${severity},${code},${value.supplierCode},${value.recordNumber},${message},${db.json({...details,xmlName:value.xmlName})})`;
  }
  try {
    db=await sql.reserve();
    await db`SET lock_timeout='10s'`;
    if(mode==='dry-run') await db`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    else {
      const [lock]=await db`SELECT pg_try_advisory_lock(${LOCK}) AS acquired`;
      if(!lock.acquired) throw new Error('Another PRICAT importer is running');
      locked=true;
      await transaction(db,async()=>{
        const abandoned=await db`UPDATE public.import_runs SET status='FAILED',"finishedAt"=CURRENT_TIMESTAMP,
          "errorCount"="errorCount"+1,message='Interrupted before atomic publication; retry source files'
          WHERE type='PRICAT' AND status='RUNNING' AND "importerVersion" LIKE 'pricat-v%' RETURNING id`;
        for(const r of abandoned) {
          await db`UPDATE public.import_files SET status='FAILED',"finishedAt"=CURRENT_TIMESTAMP WHERE "runId"=${r.id} AND status IN ('PENDING','RUNNING')`;
          await db`INSERT INTO public.import_issues ("runId",severity,code,message) VALUES (${r.id},'ERROR','INTERRUPTED','Retry files: publication was not committed')`;
        }
      });
      [{id:runId}]=await db`INSERT INTO public.import_runs (type,status,"importerVersion") VALUES ('PRICAT','RUNNING',${VERSION}) RETURNING id`;
    }
    const [settings]=await db`SELECT "protectiveMarkupPercent" FROM public.shop_settings WHERE id=1`;
    if(!settings) throw new Error('ShopSettings id=1 is required');
    decimal(String(settings.protectiveMarkupPercent),'protectiveMarkupPercent',7,3);
    summary.protectiveMarkupPercent=settings.protectiveMarkupPercent;
    const warehouses=await db`SELECT id,code FROM public.warehouses WHERE NOT "isArchived"`;
    const warehouseIds=new Map(warehouses.map(w=>[w.code,w.id]));
    for(const code of ['stock1','stock2','stock3']) if(!warehouseIds.has(code)) throw new Error(`Missing active warehouse ${code}`);
    dir=await fsp.mkdtemp(path.join(os.tmpdir(),'pricat-'));
    if(reportPath) report=await fsp.open(path.resolve(reportPath),'w');
    for(const file of files) {
      const input={source:file.source,path:path.resolve(file.path),...(await fingerprint(file.path)),seen:new Map(),conflicts:new Set(),invalidCodes:new Set(),documents:[],
        stats:{source:file.source,rows:0,uniqueCodes:0,matched:0,missing:0,conflictingCodes:0,identicalDuplicates:0,anomalousPrices:0,invalidRecords:0,uom:Object.create(null),multiplicity:Object.create(null),itemsPerUnit:Object.create(null),fields:Object.create(null)}};
      inputs.push(input); summary.files.push(input.stats);
      if(mode==='production') {
        const [prior]=await db`SELECT f.id FROM public.import_files f JOIN public.import_runs r ON r.id=f."runId"
          WHERE f.source=${input.source} AND f.sha256=${input.sha256} AND f.status='SUCCEEDED' AND r.status='SUCCEEDED'
            AND r."importerVersion"=${VERSION} AND f.metadata->>'protectiveMarkupPercent'=${String(settings.protectiveMarkupPercent)} LIMIT 1`;
        input.priorId=reprocess?null:prior?.id;
        [{id:input.id}]=await db`INSERT INTO public.import_files ("runId",source,status,"fileName","sourceUri","sizeBytes",sha256,"startedAt")
          VALUES (${runId},${input.source},'RUNNING',${path.basename(input.path)},${input.path},${input.sizeBytes},${input.sha256},CURRENT_TIMESTAMP) RETURNING id`;
      }
      input.spool=path.join(dir,input.source+'.ndjson');
      const handle=await fsp.open(input.spool,'w');
      let header={};
      try {
        for await(const {record,index,xmlName} of readPricat(input.path,{onHeader:m=>header=m,onMetadata:m=>input.documents.push(m)})) {
          summary.processedRecords++;input.stats.rows++;
          for(const key of Object.keys(record)) input.stats.fields[key]=(input.stats.fields[key]||0)+1;
          for(const [field,key] of [['UOM','uom'],['Multiplicity','multiplicity'],['ItemsPerUnit','itemsPerUnit']]) {
            const v=typeof record[field]==='string'?record[field]:'<ambiguous>';
            input.stats[key][v]=(input.stats[key][v]||0)+1;
          }
          const supplierCode=typeof record.SenderPrdCode==='string'?record.SenderPrdCode.trim():null;
          const hash=createHash('sha256').update(canonical(record)).digest('hex');
          const prior=input.seen.get(supplierCode);
          if(prior && prior.hash!==hash) input.conflicts.add(supplierCode);
          else if(prior) {input.stats.identicalDuplicates++;summary.identicalDuplicates++;}
          else input.seen.set(supplierCode,{hash,index});
          let normalized;
          try {normalized=normalizePricat(record,input.source,settings.protectiveMarkupPercent,header.Currency);}
          catch(e) {input.stats.invalidRecords++;summary.invalidRecords++;input.invalidCodes.add(supplierCode);
            await issue(input,{supplierCode,index,xmlName},'INVALID_RECORD',e.message,{record},'ERROR');}
          if(normalized?.anomalous) {input.stats.anomalousPrices++;summary.anomalousPrices++;}
          await handle.write(JSON.stringify({supplierCode,index,xmlName,record,normalized})+'\n');
          if(index%10000===0) {peakRssBytes=Math.max(peakRssBytes,process.memoryUsage().rss);onProgress({phase:'parse',source:input.source,records:index});}
        }
      } finally {await handle.close();}
      if(input.documents.length!==1) throw new Error('Exactly one PRICAT document per source is required');
      const after=await fingerprint(input.path);
      if(after.sha256!==input.sha256 || after.sizeBytes!==input.sizeBytes) throw new Error('Source file changed during import');
      input.stats.uniqueCodes=input.seen.size;
      input.stats.duplicateRows=input.stats.rows-input.seen.size;
      input.stats.conflictingCodes=input.conflicts.size;summary.conflictingCodes+=input.conflicts.size;
      input.stats.sha256=input.sha256;input.stats.documents=input.documents;
    }
    // Match in bounded batches. Raw records live on disk, never in a catalog-sized array.
    for(const input of inputs) {
      let batch=[];
      const firstConflictRecords=new Map();
      async function assess() {
        if(!batch.length)return;
        const codes=batch.map(r=>r.supplierCode).filter(Boolean);
        const rows=codes.length?await db`SELECT id,"supplierCode" FROM public.products WHERE "supplierCode" IN ${db(codes)}`:[];
        const matched=new Set(rows.map(p=>p.supplierCode));
        for(const row of batch) {
          const first=input.seen.get(row.supplierCode)?.index===row.index;
          if(first) {const key=matched.has(row.supplierCode)?'matched':'missing';input.stats[key]++;summary[key==='matched'?'matchedProducts':'missingProducts']++;
            (key==='matched'?matchedCodes:missingCodes).add(row.supplierCode);
            if(key==='missing') await issue(input,row,'MISSING_PRODUCT','No Product.supplierCode match',{record:row.record});}
          if(input.conflicts.has(row.supplierCode)) {
            if(first)firstConflictRecords.set(row.supplierCode,row.record);
            const original=firstConflictRecords.get(row.supplierCode);
            const changedFields=original?Array.from(new Set([...Object.keys(original),...Object.keys(row.record)])).filter(k=>canonical(original[k])!==canonical(row.record[k])):[];
            await issue(input,row,'CONFLICTING_DUPLICATE','Different source rows for one SenderPrdCode; all variants quarantined',
              {record:row.record,firstRecordNumber:input.seen.get(row.supplierCode)?.index,changedFields,reason:first?'First row of a conflicting code':'Source record differs from first row'},'ERROR');
          }
          if(row.normalized?.anomalous) await issue(input,row,'PROTECTIVE_PRICE','RetailPrice below Price2',{retailPrice:row.record.RetailPrice,price2:row.normalized.price.price2,effectiveRetailPrice:row.normalized.price.rawData.effectiveRetailPrice});
          if(!first || input.conflicts.has(row.supplierCode) || input.invalidCodes.has(row.supplierCode) || !matched.has(row.supplierCode) || !row.normalized)continue;
          if(row.normalized.stocks.length>1 && new Set(row.normalized.stocks.map(s=>s.uom)).size>1)
            await issue(input,row,'PARTNER_UOM_DIFFERENCE','Warehouse quantities retained separately; no unit conversion or total',{stocks:row.normalized.stocks});
          for(const stock of row.normalized.stocks) {
            const key=stock.warehouse+':'+stock.uom;
            const stat=summary.warehouses[key] ||= {records:0,positive:0,zero:0};
            stat.records++;stat[Number(stock.quantity)>0?'positive':'zero']++;
          }
        }
        if(mode==='dry-run')await applyBatch({db,input,batch:batch.filter(row=>row.normalized && !input.conflicts.has(row.supplierCode) && !input.invalidCodes.has(row.supplierCode) && input.seen.get(row.supplierCode)?.index===row.index),warehouseIds,summary,issue,dryRun:true});
        batch=[];
      }
      for await(const row of spoolRows(input.spool)) {batch.push(row);if(batch.length>=batchSize)await assess();}
      await assess();
    }
    summary.peakRssBytes=Math.max(peakRssBytes,process.memoryUsage().rss);
    summary.matchedUniqueProducts=matchedCodes.size;
    summary.missingUniqueCodes=missingCodes.size;
    if(mode==='dry-run') {await db`COMMIT`;return {...summary,status:'DRY_RUN'};}
    if((summary.invalidRecords || summary.conflictingCodes) && conflictPolicy==='reject') throw new Error('Validation failed: invalid records or unresolved duplicate variants');
    await beforePublish({db,runId});
    for(const input of inputs) {
      const after=await fingerprint(input.path);
      if(after.sha256!==input.sha256 || after.sizeBytes!==input.sizeBytes)throw new Error('Source file changed before publication');
    }
    await transaction(db,async()=>{
      await db`LOCK TABLE public.products,public.warehouses,public.shop_settings,public.product_commercial_data,public.product_prices,public.product_stocks IN SHARE ROW EXCLUSIVE MODE`;
      const [current]=await db`SELECT "protectiveMarkupPercent" FROM public.shop_settings WHERE id=1`;
      if(String(current?.protectiveMarkupPercent)!==String(settings.protectiveMarkupPercent)) throw new Error('ShopSettings changed during validation');
      const active=await db`SELECT id,code FROM public.warehouses WHERE NOT "isArchived"`;
      if([...warehouseIds].some(([code,id])=>!active.some(w=>w.code===code && w.id===id)))throw new Error('Warehouse configuration changed during validation');
      for(const input of inputs) {
        const raw=input.documents[0].DocumentDate;
        if(!/^\d{14}$/.test(raw || ''))throw new Error('Expected 14-digit PRICAT DocumentDate');
        const [newer]=await db`SELECT id FROM public.import_files WHERE source=${input.source} AND status='SUCCEEDED'
          AND "documentDateRaw">${raw} LIMIT 1`;
        if(newer && !input.priorId)throw new Error('Older PRICAT snapshot would replace newer data');
      }
      // Missing products are checked again inside publication. No Product is ever inserted.
      for(const input of inputs) {
        if(input.priorId)continue;
        // Quarantine is not a full-snapshot zero: uncertain supplier quantities become unknown.
        // Preserve manual/locked data and report them for the caller's availability policy.
        for(const code of new Set([...input.conflicts,...input.invalidCodes])) {
          const rows=await db`SELECT s.*,p."lockedFields" AS "productLockedFields" FROM public.product_stocks s JOIN public.products p ON p.id=s."productId"
            WHERE p."supplierCode"=${code} AND s.source=${input.source}`;
          for(const stock of rows) {
            if(stock.isLocked || stock.productLockedFields.includes('stocks')) {summary.protectedRecords++;await issue(input,{supplierCode:code},'LOCKED_QUARANTINE','Locked stock retained; exclude this code/source from availability using conflict diagnostics',{stock},'ERROR');continue;}
            await issue(input,{supplierCode:code},'QUARANTINED_STOCK','Previous supplier quantity withdrawn from availability',{stock});
            await db`UPDATE public.product_stocks SET quantity=NULL,"importFileId"=${input.id},"updatedAt"=CURRENT_TIMESTAMP WHERE id=${stock.id}`;
          }
        }
        let batch=[];
        const flush=async()=>{await applyBatch({db,input,batch,warehouseIds,summary,issue});batch=[];onProgress({phase:'publish',source:input.source,updatedRecords:summary.updatedRecords});};
        for await(const row of spoolRows(input.spool)) {
          if(input.conflicts.has(row.supplierCode) || input.invalidCodes.has(row.supplierCode) || input.seen.get(row.supplierCode)?.index!==row.index)continue;
          batch.push(row);if(batch.length>=batchSize)await flush();
        }
        await flush();
      }
      for(const input of inputs) {
        const doc=input.documents[0];
        await db`UPDATE public.import_files SET status=${input.priorId?'SKIPPED':'SUCCEEDED'},"finishedAt"=CURRENT_TIMESTAMP,
          "documentNumber"=${doc.DocumentNumber ?? null},"documentDateRaw"=${doc.DocumentDate ?? null},"documentDate"=${doc.documentDate},
          metadata=${db.json({...input.stats,protectiveMarkupPercent:String(settings.protectiveMarkupPercent),conflictPolicy})} WHERE id=${input.id}`;
      }
      const status=inputs.every(f=>f.priorId)?'SKIPPED':'SUCCEEDED';
      await db`UPDATE public.import_runs SET status=${status},"finishedAt"=CURRENT_TIMESTAMP,"processedRecords"=${summary.processedRecords},
        "updatedRecords"=${summary.updatedRecords},"skippedRecords"=${summary.processedRecords-summary.updatedRecords},
        "warningCount"=${summary.warningCount},"errorCount"=${summary.errorCount},diagnostics=${db.json(summary)} WHERE id=${runId}`;
    });
    return {...summary,runId,status:inputs.every(f=>f.priorId)?'SKIPPED':'SUCCEEDED'};
  } catch(e) {
    if(runId)try {await transaction(db,async()=>{
      const [run]=await db`SELECT status FROM public.import_runs WHERE id=${runId} FOR UPDATE`;
      if(run?.status!=='RUNNING')return;
      await db`INSERT INTO public.import_issues ("runId",severity,code,message) VALUES (${runId},'ERROR','IMPORT_FAILED',${e.message})`;
      for(const input of inputs)if(input.id)await db`UPDATE public.import_files SET status='FAILED',"finishedAt"=CURRENT_TIMESTAMP,
        metadata=${db.json(input.stats)},message=${e.message},"documentNumber"=${input.documents[0]?.DocumentNumber ?? null},
        "documentDateRaw"=${input.documents[0]?.DocumentDate ?? null},"documentDate"=${input.documents[0]?.documentDate ?? null} WHERE id=${input.id}`;
      await db`UPDATE public.import_runs SET status='FAILED',"finishedAt"=CURRENT_TIMESTAMP,message=${e.message},
        "processedRecords"=${summary.processedRecords},"failedRecords"=${summary.processedRecords},"errorCount"=${summary.errorCount+1},diagnostics=${db.json({...summary,updatedRecords:0})} WHERE id=${runId}`;
    });} catch(auditError) {e.auditError=auditError.message;}
    e.runId=runId;throw e;
  } finally {
    try {
      if(report)await report.close();
      if(dir) {
        const resolved=path.resolve(dir),root=path.resolve(os.tmpdir())+path.sep;
        if(!resolved.startsWith(root) || !path.basename(resolved).startsWith('pricat-'))throw new Error('Unexpected temporary spool path');
        await fsp.rm(resolved,{recursive:true,force:true});
      }
    } finally {
      if(db) {try {if(locked)await db`SELECT pg_advisory_unlock(${LOCK})`;else if(mode==='dry-run')await db`ROLLBACK`;}catch{} db.release();}
      await sql.end({timeout:5});
    }
  }
}
async function main() {
  const args=process.argv.slice(2),options={files:[]};
  while(args.length) {
    const key=args.shift(),v=args.shift();
    if(key==='--database-url-env') {require('dotenv').config({quiet:true});options.databaseUrl=process.env[v];}
    else if(key==='--mode')options.mode=v;
    else if(key==='--report')options.reportPath=v;
    else if(key==='--conflict-policy')options.conflictPolicy=v;
    else if(key==='--reprocess') {if(!['true','false'].includes(v))throw new Error('--reprocess expects true or false');options.reprocess=v==='true';}
    else if(['--pricat1','--pricat2'].includes(key))options.files.push({source:key==='--pricat1'?'PRICAT1':'PRICAT2',path:v});
    else throw new Error(`Unknown option ${key}`);
  }
  options.onProgress=p=>console.error(JSON.stringify(p));
  console.log(JSON.stringify(await importPricat(options),null,2));
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({error:e.message,runId:e.runId,auditError:e.auditError}));process.exitCode=1;});
module.exports={importPricat,VERSION,LOCK};

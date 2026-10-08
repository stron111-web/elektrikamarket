'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const postgres = require('postgres');
const { readProdatZip, ProdatDeduplicator } = require('./prodat.cjs');
const { normalizeProduct, documentMetadata } = require('./prodat-normalize.cjs');

const { planSlugs } = require('./prodat-slug.cjs');
const { BARCODE_LAYER, normalizeBarcodes } = require('./prodat-barcodes.cjs');
const { barcodeCounters, createBarcodeStage, stageBarcodes, publishBarcodes } = require('./prodat-barcode-store.cjs');
const VERSION = 'prodat-v1.2.0';
const LOCK = 1707312401;
const COUNTERS = ['processedRecords', 'createdRecords', 'updatedRecords', 'skippedRecords', 'failedRecords', 'errorCount', 'warningCount'];
const counters = () => Object.fromEntries(COUNTERS.map(k => [k, 0]));
function connectionUrl(value) {
  if (!value) throw new Error('Explicit databaseUrl is required');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL URL required');
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') throw new Error('Only public schema is supported');
  url.searchParams.delete('schema');
  return url.toString();
}
async function fingerprint(file) {
  const hash = createHash('sha256');
  let size = 0n;
  for await (const bytes of fs.createReadStream(file)) { hash.update(bytes); size += BigInt(bytes.length); }
  return { sha256: hash.digest('hex'), sizeBytes: size.toString() };
}
async function firstRecord(source) {
  for await (const item of readProdatZip(source.zipPath)) {
    if (item.source.xmlName === source.xmlName && item.index === source.index) return item.record;
  }
  return null;
}
function failure(message, details) { return Object.assign(new Error(message), { details }); }

// Explicit BEGIN is safe on this dedicated reserved connection. Never reconnect/retry a transaction.
async function transaction(db, work) {
  await db`BEGIN`;
  try {
    const result = await work(db);
    await db`COMMIT`;
    return result;
  } catch (error) {
    try { await db`ROLLBACK`; } catch { /* Original error is authoritative. */ }
    throw error;
  }
}

// Explicit URL and explicit file list: no implicit production target or default ZIPs.
async function importProdat({ databaseUrl, files, batchSize = 500, onProgress = () => {} }) {
  if (!Array.isArray(files) || !files.length) throw new Error('At least one explicit ZIP path is required');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new Error('batchSize must be 1..5000');
  const sql = postgres(connectionUrl(databaseUrl), { max: 1, connect_timeout: 10, onnotice: () => {} });
  const started = performance.now();
  let db, locked = false, runId, activeFile, activeSource, committed = false;
  const total = counters(), barcodes = barcodeCounters(), inputs = [], categories = new Map(), dedup = new ProdatDeduplicator();
  let peakRss = process.memoryUsage().rss;
  const sample = phase => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    onProgress({ phase, processedRecords: total.processedRecords, elapsedMs: Math.round(performance.now() - started) });
  };
  const diagnostics = () => ({ version: VERSION, dedup: dedup.summary(), barcodes, elapsedMs: Math.round(performance.now() - started), peakRssBytes: peakRss });
  async function saveFile(tx, input, status, message = null) {
    const doc = input.documents.length === 1 ? input.documents[0] : null;
    await tx`UPDATE public.import_files SET status=${status}, "finishedAt"=CURRENT_TIMESTAMP,
      "documentNumber"=${doc?.DocumentNumber ?? null}, "documentDate"=${doc?.documentDate ?? null},
      "documentDateRaw"=${doc?.DocumentDate ?? null}, metadata=${tx.json({ documents: input.documents, counters: input.counts, priorSuccessfulFileId: input.priorId ?? null, priorBarcodeFileId: input.priorBarcodeId ?? null,
        barcodes: input.barcodes, layers: status==='FAILED' ? {} : { catalog: 'v1', barcodes: BARCODE_LAYER } })},
      message=${message} WHERE id=${input.id}`;
  }
  try {
    db = await sql.reserve();
    const [lock] = await db`SELECT pg_try_advisory_lock(${LOCK}) AS acquired`;
    if (!lock.acquired) throw new Error('Another PRODAT importer is running');
    locked = true;
    // The session lock proves that no previous instance of this importer is alive.
    await transaction(db, async tx => {
      const abandoned = await tx`UPDATE public.import_runs SET status='FAILED', "finishedAt"=CURRENT_TIMESTAMP,
        "errorCount"="errorCount"+1, message='Interrupted before atomic publication; retry source files'
        WHERE type='PRODAT' AND "importerVersion"=${VERSION} AND status='RUNNING' RETURNING id`;
      for (const row of abandoned) await tx`UPDATE public.import_files SET status='FAILED', "finishedAt"=CURRENT_TIMESTAMP,
        message='Interrupted before atomic publication' WHERE "runId"=${row.id} AND status IN ('RUNNING','PENDING')`;
    });
    [ { id: runId } ] = await db`INSERT INTO public.import_runs (type,status,"importerVersion") VALUES ('PRODAT','RUNNING',${VERSION}) RETURNING id`;
    for (const file of files) {
      const filePath = path.resolve(file), fp = await fingerprint(filePath);
      const [prior] = await db`SELECT f.id FROM public.import_files f JOIN public.import_runs r ON r.id=f."runId"
        WHERE f.source='PRODAT' AND f.sha256=${fp.sha256} AND f.status='SUCCEEDED' AND r.status='SUCCEEDED' ORDER BY f.id LIMIT 1`;
      const [priorBarcode] = await db`SELECT f.id FROM public.import_files f JOIN public.import_runs r ON r.id=f."runId"
        WHERE f.source='PRODAT' AND f.sha256=${fp.sha256} AND f.status='SUCCEEDED' AND r.status='SUCCEEDED'
          AND f.metadata->'layers'->>'barcodes'=${BARCODE_LAYER} ORDER BY f.id LIMIT 1`;
      const [row] = await db`INSERT INTO public.import_files ("runId",source,status,"fileName","sourceUri","sizeBytes",sha256,"startedAt")
        VALUES (${runId},'PRODAT','RUNNING',${path.basename(filePath)},${filePath},${fp.sizeBytes},${fp.sha256},CURRENT_TIMESTAMP) RETURNING id`;
      inputs.push({ ...fp, id: row.id, path: filePath, priorId: prior?.id, priorBarcodeId: priorBarcode?.id, counts: counters(), barcodes: barcodeCounters(), documents: [] });
    }
    await db`CREATE TEMP TABLE prodat_stage ("supplierCode" text PRIMARY KEY, data jsonb NOT NULL, brand text, "categoryKey" text, "fileId" integer NOT NULL) ON COMMIT PRESERVE ROWS`;
    await createBarcodeStage(db);
    let batch = [], barcodeBatch = [], issueBatch = [];
    async function flush() {
      if (batch.length) await db`INSERT INTO prodat_stage SELECT * FROM jsonb_to_recordset(${db.json(batch)})
        AS x("supplierCode" text, data jsonb, brand text, "categoryKey" text, "fileId" integer)`;
      await stageBarcodes(db,barcodeBatch,issueBatch);
      batch = []; barcodeBatch = []; issueBatch = [];
      sample('validate');
    }
    for (const input of inputs) {
      activeFile = input; activeSource = null;
      for await (const { record, source } of readProdatZip(input.path, {
        onMetadata: raw => input.documents.push(documentMetadata(raw)),
      })) {
        activeSource = source;
        total.processedRecords++; input.counts.processedRecords++;
        const result = dedup.accept(record, source);
        if (result.kind === 'conflict') throw failure(`Conflicting SenderPrdCode ${result.code}`, {
          ...result, firstRecord: await firstRecord(result.first), currentRecord: record,
        });
        activeSource = {...source,supplierCode:result.code};
        const normalized = normalizeProduct(record);
        for (const category of normalized.categories) {
          const previous = categories.get(category.sourceKey);
          if (previous && (previous.name !== category.name || previous.parentKey !== category.parentKey)) {
            throw failure(`Conflicting Category ${category.sourceKey}`, { first: previous, current: category, source });
          }
          categories.set(category.sourceKey, category);
        }
        const ean = normalizeBarcodes(record.EAN);
        if (result.kind !== 'identical' && !input.priorBarcodeId) {
          for (const [key,value] of Object.entries({inputEntries:ean.stats.entries,uniquePairs:ean.rows.length,duplicateEntries:ean.stats.duplicates,emptyEntries:ean.stats.empty})) {
            input.barcodes[key]+=value;barcodes[key]+=value;
          }
          for (const row of ean.rows) barcodeBatch.push({...row,supplierCode:result.code,fileId:input.id,recordNumber:source.index,xmlName:source.xmlName});
          for (const issue of ean.issues) issueBatch.push({...issue,fileId:input.id,supplierCode:result.code,recordNumber:source.index,details:{...issue.details,xmlName:source.xmlName}});
          if(barcodeBatch.length>=batchSize || issueBatch.length>=batchSize) await flush();
        }
        if (result.kind === 'identical' || input.priorId) {
          input.counts.skippedRecords++; total.skippedRecords++; continue;
        }
        batch.push({ supplierCode: result.code, data: normalized.product, brand: normalized.brand,
          categoryKey: normalized.categoryKey, fileId: input.id });
        if (batch.length >= batchSize) await flush();
      }
      if (!input.documents.length) throw new Error('No PRODAT documents');
      const after = await fingerprint(input.path);
      if (after.sha256 !== input.sha256 || after.sizeBytes !== input.sizeBytes) throw new Error('Source file changed during import');
      await flush();
      sample('file-validated');
    }
    activeFile = null; activeSource = null;
    const hasFreshCatalog = inputs.some(v => !v.priorId);
    const hasFreshBarcodes = inputs.some(v => !v.priorBarcodeId);
    const hasFresh = hasFreshCatalog || hasFreshBarcodes;
    await transaction(db, async tx => {
      // Both layers publish atomically under the same lock, including manual barcode writers.
      if(hasFresh) await tx`LOCK TABLE public.brands, public.categories, public.products, public.product_barcodes IN SHARE ROW EXCLUSIVE MODE`;
      if (hasFreshCatalog) {
        const existingBrands = await tx`SELECT name AS identity,slug FROM public.brands`;
        const brandNames = new Set(existingBrands.map(r=>r.identity));
        const newBrands = (await tx`SELECT DISTINCT brand AS name FROM prodat_stage WHERE brand IS NOT NULL`)
          .filter(r=>!brandNames.has(r.name)).map(r=>({...r,identity:r.name}));
        const brandPlan = planSlugs('brand',newBrands,existingBrands);
        if (brandPlan.rows.length) await tx`INSERT INTO public.brands (name,slug,"updatedAt")
          SELECT name,proposed,CURRENT_TIMESTAMP FROM jsonb_to_recordset(${tx.json(brandPlan.rows.map(r=>({name:r.name,proposed:r.proposed})))})
          AS x(name text,proposed text)`;
        // Only nodes used by fresh products may change. Previously imported files are validation-only.
        const needed = new Set((await tx`SELECT DISTINCT "categoryKey" FROM prodat_stage WHERE "categoryKey" IS NOT NULL`).map(r => r.categoryKey));
        for (const key of needed) { const p = categories.get(key).parentKey; if (p) needed.add(p); }
        const existingCategories = await tx`SELECT "sourceKey" AS identity,slug FROM public.categories`;
        const categorySlugs = new Map(existingCategories.map(r=>[r.identity,r.slug]));
        const categoryPlan = planSlugs('category', [...categories.values()]
          .filter(r=>needed.has(r.sourceKey) && !categorySlugs.has(r.sourceKey))
          .map(r=>({identity:r.sourceKey,name:r.name})),existingCategories);
        for (const row of categoryPlan.rows) categorySlugs.set(row.identity,row.proposed);
        for (const level of [4, 3, 2]) {
          for (const category of categories.values()) {
            if (!needed.has(category.sourceKey) || !category.sourceKey.startsWith(`rsv:catalog:L${level}:`)) continue;
            const parent = category.parentKey ? (await tx`SELECT id FROM public.categories WHERE "sourceKey"=${category.parentKey}`)[0]?.id : null;
            if (category.parentKey && !parent) throw new Error(`Missing parent ${category.parentKey}`);
            await tx`INSERT INTO public.categories AS c (name,slug,"sourceKey","parentId","lockedFields","isArchived")
              VALUES (${category.name},${categorySlugs.get(category.sourceKey)},${category.sourceKey},${parent},'{}',false)
              ON CONFLICT ("sourceKey") DO UPDATE SET
                name=CASE WHEN 'name'=ANY(c."lockedFields") THEN c.name ELSE EXCLUDED.name END,
                "parentId"=CASE WHEN 'parentId'=ANY(c."lockedFields") THEN c."parentId" ELSE EXCLUDED."parentId" END`;
          }
        }
        const cycles = await tx`WITH RECURSIVE walk AS (
          SELECT id,"parentId",ARRAY[id] AS path,false AS cycle FROM public.categories
          UNION ALL SELECT c.id,c."parentId",w.path || c.id,c.id=ANY(w.path)
          FROM walk w JOIN public.categories c ON c.id=w."parentId" WHERE NOT w.cycle
        ) SELECT id FROM walk WHERE cycle LIMIT 1`;
        if (cycles.length) throw new Error('Category parent cycle (including locked manual parents)');
        await tx`CREATE TEMP TABLE prodat_publish ON COMMIT DROP AS
          SELECT p.* FROM prodat_stage s
          LEFT JOIN public.brands b ON b.name=s.brand LEFT JOIN public.categories c ON c."sourceKey"=s."categoryKey"
          CROSS JOIN LATERAL jsonb_populate_record(NULL::public.products, s.data || jsonb_build_object(
            'brandId',b.id,'categoryId',c.id,'lastProdatFileId',s."fileId")) p`;
        await tx`UPDATE prodat_publish n SET slug=p.slug FROM public.products p WHERE p."supplierCode"=n."supplierCode"`;
        const existingProducts = await tx`SELECT "supplierCode" AS identity,slug FROM public.products`;
        const productCodes = new Set(existingProducts.map(r=>r.identity));
        const newProducts = (await tx`SELECT "supplierCode" AS identity,name FROM prodat_publish`).filter(r=>!productCodes.has(r.identity));
        const productPlan = planSlugs('product',newProducts,existingProducts);
        await tx`CREATE INDEX ON prodat_publish ("supplierCode")`;
        for (let offset=0; offset<productPlan.rows.length; offset+=batchSize) {
          const batch=productPlan.rows.slice(offset,offset+batchSize).map(r=>({identity:r.identity,slug:r.proposed}));
          await tx`UPDATE prodat_publish p SET slug=x.slug FROM jsonb_to_recordset(${tx.json(batch)})
            AS x(identity text,slug text) WHERE p."supplierCode"=x.identity`;
        }
        const fields = [...Object.keys(normalizeProduct({ SenderPrdCode: 'x', ProductName: 'x' }).product).filter(k => !['slug','supplierCode'].includes(k)), 'brandId', 'categoryId'];
        // All identifiers below are fixed by code, never by input XML.
        const q = key => '"' + key + '"';
        const value = (key, incoming) => `CASE WHEN '${key}'=ANY(p."lockedFields") THEN p.${q(key)} ELSE ${incoming}.${q(key)} END`;
        const changed = fields.map(k => `p.${q(k)} IS DISTINCT FROM ${value(k, 'n')}`).join(' OR ');
        await tx.unsafe(`ALTER TABLE prodat_publish ADD COLUMN action text`);
        await tx.unsafe(`UPDATE prodat_publish n SET action=CASE WHEN p.id IS NULL THEN 'created' WHEN (${changed}) THEN 'updated' ELSE 'skipped' END
          FROM prodat_publish n2 LEFT JOIN public.products p ON p."supplierCode"=n2."supplierCode" WHERE n."supplierCode"=n2."supplierCode"`);
        const counts = await tx`SELECT "lastProdatFileId" AS id,action,count(*)::int AS count FROM prodat_publish GROUP BY "lastProdatFileId",action`;
        const columns = ['supplierCode', 'slug', ...fields, 'lastProdatFileId'];
        const updates = [...fields, 'lastProdatFileId'].map(k => `${q(k)}=${value(k, 'EXCLUDED')}`);
        updates.push(`"lastProdatAt"=CASE WHEN 'lastProdatAt'=ANY(p."lockedFields") THEN p."lastProdatAt" ELSE EXCLUDED."lastProdatAt" END`,
          `"updatedAt"=CASE WHEN 'updatedAt'=ANY(p."lockedFields") THEN p."updatedAt" ELSE EXCLUDED."updatedAt" END`);
        await tx.unsafe(`INSERT INTO public.products AS p (${columns.map(q).join(',')},"lastProdatAt","updatedAt","lockedFields","isArchived")
          SELECT ${columns.map(q).join(',')},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{}',false FROM prodat_publish WHERE action!='skipped'
          ON CONFLICT ("supplierCode") DO UPDATE SET ${updates.join(',')}`);
        for (const row of counts) {
          const key = `${row.action}Records`, input = inputs.find(v => v.id === row.id);
          input.counts[key] += row.count; total[key] += row.count;
        }
      }
      if(hasFreshBarcodes) {
        const published=await publishBarcodes(tx,runId);
        for(const row of published.counts) {barcodes[row.action]+=row.count;inputs.find(v=>v.id===row.fileId).barcodes[row.action]+=row.count;}
        for(const row of published.warnings) {total.warningCount+=row.count;inputs.find(v=>v.id===row.fileId).counts.warningCount+=row.count;}
      }
      sample('publish');
      for (const input of inputs) await saveFile(tx, input, input.priorId && input.priorBarcodeId ? 'SKIPPED' : 'SUCCEEDED');
      await tx`UPDATE public.import_runs SET ${tx({ ...total, status: hasFresh ? 'SUCCEEDED' : 'SKIPPED', diagnostics: tx.json(diagnostics()) })},
        "finishedAt"=CURRENT_TIMESTAMP WHERE id=${runId}`;
    });
    committed = true;
    return { runId, status: hasFresh ? 'SUCCEEDED' : 'SKIPPED', ...total, ...diagnostics() };
  } catch (error) {
    if (runId && !committed) {
      // Catalog transaction has rolled back. Persist audit in a separate transaction.
      total.createdRecords = 0; total.updatedRecords = 0; total.errorCount = 1; total.warningCount = 0;
      for(const key of ['created','updated','unchanged','protected']) barcodes[key]=0;
      total.failedRecords = total.processedRecords - total.skippedRecords;
      for (const input of inputs) {
        input.counts.createdRecords = 0; input.counts.updatedRecords = 0; input.counts.warningCount=0;
        for(const key of ['created','updated','unchanged','protected']) input.barcodes[key]=0;
        input.counts.failedRecords = input.counts.processedRecords - input.counts.skippedRecords;
        if (input === activeFile) input.counts.errorCount++;
      }
      try {
        await transaction(db, async tx => {
          // A lost COMMIT response must never relabel a committed run as FAILED.
          const rows = await tx`SELECT status FROM public.import_runs WHERE id=${runId} FOR UPDATE`;
          if (rows[0]?.status !== 'RUNNING') return;
          if(error.code?.startsWith('BARCODE_')) await tx`INSERT INTO public.import_issues
            ("runId","fileId",severity,code,"supplierCode","recordNumber",message,details)
            VALUES (${runId},${activeFile?.id ?? null},'ERROR',${error.code},${activeSource?.supplierCode ?? error.details?.supplierCode ?? null},
              ${activeSource?.index ?? null},${error.message},${tx.json({...error.details,source:activeSource ?? null})})`;
          for (const input of inputs) await saveFile(tx, input, 'FAILED', error.message);
          await tx`UPDATE public.import_runs SET ${tx({ ...total, status: 'FAILED', message: error.message,
            diagnostics: tx.json({ ...diagnostics(), error: error.details ?? { source: activeSource ?? null } }) })}, "finishedAt"=CURRENT_TIMESTAMP WHERE id=${runId}`;
        });
      } catch (auditError) { error.auditError = auditError.message; }
      error.runId = runId;
    }
    throw error;
  } finally {
    if (db) {
      try { if (locked) await db`SELECT pg_advisory_unlock(${LOCK})`; }
      catch { /* A closed session releases its advisory lock automatically. */ }
      finally { db.release(); }
    }
    await sql.end({ timeout: 5 });
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.shift() !== '--database-url-env') throw new Error('Usage: node scripts/import/prodat-import.cjs --database-url-env VARIABLE file1.zip [file2.zip ...]');
  const env = args.shift();
  if (!env || !args.length || args.some(v => v.startsWith('--'))) throw new Error('Explicit environment variable and ZIP paths required');
  require('dotenv').config({ quiet: true });
  const result = await importProdat({ databaseUrl: process.env[env], files: args,
    onProgress: p => { if (p.phase !== 'validate' || p.processedRecords % 10000 === 0) console.log(JSON.stringify(p)); } });
  console.log(JSON.stringify(result));
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ error: error.message, runId: error.runId, auditError: error.auditError })); process.exitCode = 1; });
module.exports = { importProdat, fingerprint, connectionUrl, VERSION };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const postgres = require('postgres');
const { readProdatZip, ProdatDeduplicator } = require('./prodat.cjs');
const { normalizeProduct, documentMetadata } = require('./prodat-normalize.cjs');

const VERSION = 'prodat-v1.0.0';
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
  const total = counters(), inputs = [], categories = new Map(), dedup = new ProdatDeduplicator();
  let peakRss = process.memoryUsage().rss;
  const sample = phase => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    onProgress({ phase, processedRecords: total.processedRecords, elapsedMs: Math.round(performance.now() - started) });
  };
  const diagnostics = () => ({ version: VERSION, dedup: dedup.summary(), elapsedMs: Math.round(performance.now() - started), peakRssBytes: peakRss });
  async function saveFile(tx, input, status, message = null) {
    const doc = input.documents.length === 1 ? input.documents[0] : null;
    await tx`UPDATE public.import_files SET status=${status}, "finishedAt"=CURRENT_TIMESTAMP,
      "documentNumber"=${doc?.DocumentNumber ?? null}, "documentDate"=${doc?.documentDate ?? null},
      "documentDateRaw"=${doc?.DocumentDate ?? null}, metadata=${tx.json({ documents: input.documents, counters: input.counts, priorSuccessfulFileId: input.priorId ?? null })},
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
      const [row] = await db`INSERT INTO public.import_files ("runId",source,status,"fileName","sourceUri","sizeBytes",sha256,"startedAt")
        VALUES (${runId},'PRODAT','RUNNING',${path.basename(filePath)},${filePath},${fp.sizeBytes},${fp.sha256},CURRENT_TIMESTAMP) RETURNING id`;
      inputs.push({ ...fp, id: row.id, path: filePath, priorId: prior?.id, counts: counters(), documents: [] });
    }
    await db`CREATE TEMP TABLE prodat_stage ("supplierCode" text PRIMARY KEY, data jsonb NOT NULL, brand text, "categoryKey" text, "fileId" integer NOT NULL) ON COMMIT PRESERVE ROWS`;
    let batch = [];
    async function flush() {
      if (!batch.length) return;
      await db`INSERT INTO prodat_stage SELECT * FROM jsonb_to_recordset(${db.json(batch)})
        AS x("supplierCode" text, data jsonb, brand text, "categoryKey" text, "fileId" integer)`;
      batch = [];
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
        const normalized = normalizeProduct(record);
        for (const category of normalized.categories) {
          const previous = categories.get(category.sourceKey);
          if (previous && (previous.name !== category.name || previous.parentKey !== category.parentKey)) {
            throw failure(`Conflicting Category ${category.sourceKey}`, { first: previous, current: category, source });
          }
          categories.set(category.sourceKey, category);
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
    activeFile = null;
    const hasFresh = inputs.some(v => !v.priorId);
    await transaction(db, async tx => {
      if (hasFresh) {
        // Serialize catalog publication against other writers; parsing happens before these locks.
        await tx`LOCK TABLE public.brands, public.categories, public.products IN SHARE ROW EXCLUSIVE MODE`;
        await tx`INSERT INTO public.brands (name,slug,"updatedAt")
          SELECT DISTINCT brand, 'brand-' || encode(sha256(convert_to(brand,'UTF8')),'hex'), CURRENT_TIMESTAMP
          FROM prodat_stage WHERE brand IS NOT NULL ON CONFLICT (name) DO NOTHING`;
        // Only nodes used by fresh products may change. Previously imported files are validation-only.
        const needed = new Set((await tx`SELECT DISTINCT "categoryKey" FROM prodat_stage WHERE "categoryKey" IS NOT NULL`).map(r => r.categoryKey));
        for (const key of needed) { const p = categories.get(key).parentKey; if (p) needed.add(p); }
        for (const level of [4, 3, 2]) {
          for (const category of categories.values()) {
            if (!needed.has(category.sourceKey) || !category.sourceKey.startsWith(`rsv:catalog:L${level}:`)) continue;
            const parent = category.parentKey ? (await tx`SELECT id FROM public.categories WHERE "sourceKey"=${category.parentKey}`)[0]?.id : null;
            if (category.parentKey && !parent) throw new Error(`Missing parent ${category.parentKey}`);
            await tx`INSERT INTO public.categories AS c (name,slug,"sourceKey","parentId","lockedFields","isArchived")
              VALUES (${category.name},${category.slug},${category.sourceKey},${parent},'{}',false)
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
      sample('publish');
      for (const input of inputs) await saveFile(tx, input, input.priorId ? 'SKIPPED' : 'SUCCEEDED');
      await tx`UPDATE public.import_runs SET ${tx({ ...total, status: hasFresh ? 'SUCCEEDED' : 'SKIPPED', diagnostics: tx.json(diagnostics()) })},
        "finishedAt"=CURRENT_TIMESTAMP WHERE id=${runId}`;
    });
    committed = true;
    return { runId, status: hasFresh ? 'SUCCEEDED' : 'SKIPPED', ...total, ...diagnostics() };
  } catch (error) {
    if (runId && !committed) {
      // Catalog transaction has rolled back. Persist audit in a separate transaction.
      total.createdRecords = 0; total.updatedRecords = 0; total.errorCount = 1;
      total.failedRecords = total.processedRecords - total.skippedRecords;
      for (const input of inputs) {
        input.counts.createdRecords = 0; input.counts.updatedRecords = 0;
        input.counts.failedRecords = input.counts.processedRecords - input.counts.skippedRecords;
        if (input === activeFile) input.counts.errorCount++;
      }
      try {
        await transaction(db, async tx => {
          // A lost COMMIT response must never relabel a committed run as FAILED.
          const rows = await tx`SELECT status FROM public.import_runs WHERE id=${runId} FOR UPDATE`;
          if (rows[0]?.status !== 'RUNNING') return;
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

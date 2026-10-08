'use strict';

// One-time repair for the two-file initial PRODAT import, never a general re-slug command.
const postgres = require('postgres');
const { connectionUrl } = require('./prodat-import.cjs');
const { technicalSlug, planSlugs, hash } = require('./prodat-slug.cjs');
const INITIAL_FILES = [
  {fileName:'PRODAT_369147_1312233182.zip',sha256:'fd1fe6533dfb837212b49b1f029765c2f472accee00060dd3b0b4fcd9e41612a'},
  {fileName:'PRODAT_369147_1312247470.zip',sha256:'08a10608944bb15b68b3c21bec9c9455fad61aa548b87832c283fec3e5d7c597'},
];
const TABLES = {product:'products',category:'categories',brand:'brands'};
function initialProvenance(runs, files) {
  const run = runs.find(r=>r.id===1);
  if (!run || run.type!=='PRODAT' || run.status!=='SUCCEEDED' || run.importerVersion!=='prodat-v1.0.0' || !run.finishedAt) throw new Error('Initial successful prodat-v1.0.0 run #1 is required');
  if (runs.some(r=>r.type==='PRODAT' && r.id!==1 && r.status!=='SKIPPED')) throw new Error('Only initial PRODAT run and successful-SHA skips are allowed before this one-time repair');
  const initial = files.filter(f=>f.runId===1);
  if (initial.length!==2 || !INITIAL_FILES.every(expected=>initial.some(f=>f.status==='SUCCEEDED' && f.source==='PRODAT' && f.fileName===expected.fileName && f.sha256.trim()===expected.sha256))) throw new Error('Initial PRODAT file fingerprints do not match');
  return {run, fileIds:new Set(initial.map(f=>f.id))};
}
async function readState(tx) {
  const runs=await tx`SELECT id,type,status,"importerVersion","finishedAt" FROM public.import_runs ORDER BY id`;
  const files=await tx`SELECT id,"runId",source,status,"fileName",sha256 FROM public.import_files ORDER BY id`;
  const {run,fileIds}=initialProvenance(runs,files);
  const products=await tx`SELECT id,name,slug,"supplierCode" AS identity,"lockedFields","createdAt","lastProdatAt","lastProdatFileId","brandId","rsCatalog",("createdAt"=(SELECT "finishedAt" AT TIME ZONE 'UTC' FROM public.import_runs WHERE id=1)) AS "initialCreated" FROM public.products ORDER BY id`;
  const categories=await tx`SELECT id,name,slug,"sourceKey" AS identity,"lockedFields" FROM public.categories ORDER BY id`;
  const brands=await tx`SELECT id,name,slug,name AS identity,"createdAt",("createdAt"=(SELECT "finishedAt" AT TIME ZONE 'UTC' FROM public.import_runs WHERE id=1)) AS "initialCreated" FROM public.brands ORDER BY id`;
  // The initial publication used PostgreSQL UTC. Compare timestamp-without-timezone in SQL, not the driver's local Date conversion.
  const sameTime=value=>value && new Date(value).getTime()===new Date(run.finishedAt).getTime();
  const initialProducts=products.filter(p=>fileIds.has(p.lastProdatFileId) && p.initialCreated && sameTime(p.lastProdatAt));
  const productIds=new Set(initialProducts.map(p=>p.id));
  const brandIds=new Set(initialProducts.map(p=>p.brandId));
  // Category has no createdAt/provenance column: restrict identity to the original RsCatalog snapshots.
  const categoryKeys=new Set();
  for(const p of initialProducts) for(const level of [4,3,2]) {
    const id=p.rsCatalog?.[`Level${level}ID`];
    if(typeof id==='string' && id.trim()) categoryKeys.add(`rsv:catalog:L${level}:${id.trim().normalize('NFC')}`);
  }
  for(const p of products) p.initial=productIds.has(p.id);
  for(const b of brands) b.initial=brandIds.has(b.id) && b.initialCreated;
  for(const c of categories) c.initial=categoryKeys.has(c.identity);
  return {runs,files,product:products,category:categories,brand:brands};
}
function buildPlan(state) {
  const plans={},summary={};
  for(const kind of Object.keys(TABLES)) {
    const rows=state[kind];
    const candidates=rows.filter(r=>r.initial && !r.lockedFields?.includes('slug') && r.slug===technicalSlug(kind,r.identity));
    // Reserve even technical old slugs: this also prevents transient UNIQUE violations during UPDATE.
    const result=planSlugs(kind,candidates,rows);
    plans[kind]=result.rows.map(r=>({id:r.id,identity:r.identity,name:r.name,current:r.slug,proposed:r.proposed,suffixed:r.suffixed,fallback:r.fallback}));
    summary[kind]={total:rows.length,technicalFormat:rows.filter(r=>new RegExp(`^${kind}-[a-f0-9]{64}$`).test(r.slug)).length,
      ...result.stats,unchanged:rows.length-candidates.length};
  }
  // Bind approval to all inputs, eligibility, current values and the complete deterministic result.
  const planHash=hash(JSON.stringify({algorithm:'readable-v1',state,plans}));
  const examples=[];
  for(const kind of Object.keys(TABLES)) {
    const rows=plans[kind], limit=kind==='product'?10:5;
    const conflicts=rows.filter(r=>r.suffixed).slice(0,kind==='product'?4:3);
    const chosen=[...conflicts,...rows.filter(r=>!conflicts.some(c=>c.id===r.id))].slice(0,limit);
    examples.push(...chosen.map(row=>({kind,...row})));
  }
  return {plans,summary,planHash,examples};
}
async function repairSlugs({databaseUrl,dryRun=true,expectedPlan}={}) {
  if(typeof dryRun!=='boolean') throw new Error('dryRun must be boolean');
  if(!dryRun && !/^[a-f0-9]{64}$/.test(expectedPlan || '')) throw new Error('Apply requires the exact --expected-plan from a reviewed dry-run');
  const sql=postgres(connectionUrl(databaseUrl),{max:1,connect_timeout:10,onnotice:()=>{}});
  try {
    return await sql.begin(dryRun?'isolation level repeatable read read only':'',async tx=>{
      if(!dryRun) {
        const [lock]=await tx`SELECT pg_try_advisory_xact_lock(1707312401) AS acquired`;
        if(!lock.acquired) throw new Error('PRODAT importer is running');
        await tx`SET LOCAL lock_timeout='10s'`;
        await tx`LOCK TABLE public.brands,public.categories,public.products IN SHARE ROW EXCLUSIVE MODE`;
      }
      const plan=buildPlan(await readState(tx));
      if(!dryRun && plan.planHash!==expectedPlan) throw new Error('Repair plan changed; run dry-run again and review it');
      const changed={product:0,category:0,brand:0};
      if(!dryRun) for(const [kind,table] of Object.entries(TABLES)) {
        const rows=plan.plans[kind];
        for(let offset=0;offset<rows.length;offset+=500) {
          // Table identifier comes only from the constant allowlist. Values are query parameters.
          const result=await tx`UPDATE public.${tx(table)} p SET slug=x.proposed
            FROM jsonb_to_recordset(${tx.json(rows.slice(offset,offset+500))}) AS x(id integer,current text,proposed text)
            WHERE p.id=x.id AND p.slug=x.current RETURNING p.id`;
          changed[kind]+=result.length;
        }
        if(changed[kind]!==rows.length) throw new Error(`Concurrent change in ${table}; whole repair rolled back`);
      }
      return {mode:dryRun?'DRY_RUN':'APPLIED',planHash:plan.planHash,summary:plan.summary,changed,examples:plan.examples};
    });
  } finally { await sql.end({timeout:5}); }
}
async function main() {
  const args=process.argv.slice(2);
  if(args.shift()!=='--database-url-env') throw new Error('Usage: node scripts/import/prodat-repair-slugs.cjs --database-url-env VARIABLE --dry-run | --apply --expected-plan SHA256');
  const variable=args.shift(), mode=args.shift();
  if(!variable || !['--dry-run','--apply'].includes(mode)) throw new Error('Explicit --dry-run or --apply required');
  let expectedPlan;
  if(mode==='--apply') {
    if(args.shift()!=='--expected-plan') throw new Error('--expected-plan required');
    expectedPlan=args.shift();
  }
  if(args.length) throw new Error('Unexpected arguments');
  require('dotenv').config({quiet:true});
  console.log(JSON.stringify(await repairSlugs({databaseUrl:process.env[variable],dryRun:mode==='--dry-run',expectedPlan}),null,2));
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={repairSlugs,buildPlan,initialProvenance,INITIAL_FILES};

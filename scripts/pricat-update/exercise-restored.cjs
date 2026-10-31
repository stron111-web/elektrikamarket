'use strict';
// Fixture-only companion to check-restored: never used by the runtime Dockerfile/service.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Transform}=require('node:stream'),{pipeline}=require('node:stream/promises'),{createHash}=require('node:crypto');
const postgres=require('postgres'),unzipper=require('unzipper');
const {readPricat}=require('../import/pricat.cjs'),{buildAssortmentSnapshot}=require('../storefront/assortment.cjs'),{update}=require('./update.cjs');
const fingerprint=async file=>{const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');};
async function describe(file,source){const docs=[];let rows=0;for await(const _ of readPricat(file,{onMetadata:m=>docs.push(m)}))rows++;assert.equal(docs.length,1);return {source,format:file.endsWith('.zip')?'zip':'xml',path:file,sizeBytes:(await fsp.stat(file)).size,sha256:await fingerprint(file),documentDate:docs[0].DocumentDate,documentNumber:docs[0].DocumentNumber,rows};}
(async()=>{
 assert.equal(process.env.PRICAT_UPDATE_ISOLATED,'1');assert(process.env.PRICAT_UPDATE_FIXTURE_URL);
 const db=postgres(process.env.PRICAT_UPDATE_FIXTURE_URL,{max:1,onnotice:()=>{},connection:{statement_timeout:'60s'}});
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'pricat-restored-'));
 try{
  assert.equal((await db`SELECT count(*)::int n FROM products`)[0].n,148872);
  await db.unsafe('ANALYZE;');
  const initial=await db.begin(tx=>buildAssortmentSnapshot(tx));assert.equal(initial.productCount,125082);
  console.log('Restored-copy initial snapshot '+initial.productCount);
  const sources=await Promise.all([describe('/inputs/pricat1.zip','PRICAT1'),describe('/inputs/pricat2.xml','PRICAT2')]);
  const latest=Math.max(...sources.map(s=>Date.UTC(+s.documentDate.slice(0,4),+s.documentDate.slice(4,6)-1,+s.documentDate.slice(6,8),+s.documentDate.slice(8,10),+s.documentDate.slice(10,12),+s.documentDate.slice(12,14))));
  const now=latest+3600000;
  const cfg={stateDirectory:path.join(dir,'state'),manifestFile:path.join(dir,'pair.json'),databaseUrlFile:path.join(dir,'url'),databaseName:new URL(process.env.PRICAT_UPDATE_FIXTURE_URL).pathname.slice(1),policy:{maxAgeHours:168,maxPairSkewHours:120,maxManifestAgeHours:2,maxFutureMinutes:5,minSourceRecords:1,maxFileBytes:1073741824,maxXmlBytes:1073741824,minFreeBytes:1000000,downloadTimeoutMs:120000,maxSourceDropFraction:.1,maxIssueFraction:.9,maxMissingFraction:.99,maxRemovedFraction:.01,maxChangedPriceFraction:.01,maxStockCellLossFraction:.01,maxPriceChangeFactor:1.01,maxQuantityChangeFactor:1.01}};
  await fsp.writeFile(cfg.databaseUrlFile,process.env.PRICAT_UPDATE_FIXTURE_URL,{mode:0o600});
  cfg.transports={PRICAT1:{directory:'/inputs'},PRICAT2:{directory:'/inputs'}};
  await fsp.writeFile(cfg.manifestFile,JSON.stringify({pairId:'restored-unchanged',generatedAt:new Date(now).toISOString(),sources}),{mode:0o600});
  assert.equal((await update({config:cfg,mode:'publish',now,event:console.log})).status,'UNCHANGED');
  // Controlled test pair: change only ASCII DocumentDate, preserving the original encoding,
  // all supplier rows/prices/quantities and the real normalizer/quarantine path.
  const next=[];
  for(const s of sources){
   const raw=s.documentDate,ms=Date.UTC(+raw.slice(0,4),+raw.slice(4,6)-1,+raw.slice(6,8),+raw.slice(8,10),+raw.slice(10,12),+raw.slice(12,14))+86400000;
   const date=new Date(ms).toISOString().replace(/\D/g,'').slice(0,14);const dest=path.join(dir,s.source+'.xml');
   const input=s.format==='zip'?(await unzipper.Open.file(s.path)).files.find(e=>e.type!=='Directory'&&/\.xml$/i.test(e.path)).stream():fs.createReadStream(s.path);
   let prefix=Buffer.alloc(0),changed=false;
   await pipeline(input,new Transform({transform(b,_e,cb){if(changed){cb(null,b);return;}prefix=Buffer.concat([prefix,b]);if(prefix.length>1048576){cb(Error('Fixture header too long'));return;}const text=prefix.toString('latin1');if(/<DocumentDate>\s*\d{14}\s*<\/DocumentDate>/.test(text)){changed=true;cb(null,Buffer.from(text.replace(/(<DocumentDate>\s*)\d{14}(\s*<\/DocumentDate>)/,(_m,a,z)=>a+date+z),'latin1'));}else cb();},flush(cb){if(!changed)cb(Error('Fixture DocumentDate not found'));else cb();}}),fs.createWriteStream(dest,{mode:0o600,flags:'wx'}));
   next.push(await describe(dest,s.source));
  }
  cfg.transports={PRICAT1:{directory:dir},PRICAT2:{directory:dir}};
  const nextNow=now+86400000;await fsp.writeFile(cfg.manifestFile,JSON.stringify({pairId:'restored-next',generatedAt:new Date(nextNow).toISOString(),sources:next}),{mode:0o600});
  const started=Date.now();const result=await update({config:cfg,mode:'publish',now:nextNow,event:console.log});assert.equal(result.status,'SUCCEEDED');assert.equal(result.count,125082);
  const [diff]=await db`WITH old AS (SELECT to_jsonb(a)-'snapshotId' value FROM assortment_items a WHERE "snapshotId"=${initial.id}), fresh AS (SELECT to_jsonb(a)-'snapshotId' value FROM assortment_items a WHERE "snapshotId"=${result.snapshotId}) SELECT (SELECT count(*)::int FROM (SELECT * FROM old EXCEPT ALL SELECT * FROM fresh) x) missing,(SELECT count(*)::int FROM (SELECT * FROM fresh EXCEPT ALL SELECT * FROM old) x) extra`;
  assert.equal(diff.missing,0);assert.equal(diff.extra,0);
  const report={fixtureOnly:true,products:148872,offers:result.count,missing:diff.missing,extra:diff.extra,comparison:'all snapshot columns including prices, purchasePrice, stocks, UOM and package metadata',initialId:String(initial.id),activeId:result.snapshotId,publicationMs:Date.now()-started,sourceRows:sources.map(s=>({source:s.source,rows:s.rows})),policyIsFixtureOnly:true};
  await fsp.writeFile('/out/restored-result.json',JSON.stringify(report,null,2));console.log('RESTORED_FULL_EQUIVALENCE '+JSON.stringify(report));
 }finally{await db.end({timeout:5});await fsp.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error('Restored fixture failed '+(e.code||e.name));process.exitCode=1;});

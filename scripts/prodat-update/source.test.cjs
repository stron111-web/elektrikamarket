'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto'),AdmZip=require('adm-zip');
const {checkSource,discover,contentGates,sourceStatus}=require('./source.cjs');const {preflight}=require('./preflight.cjs');const {publishVerified}=require('./publish.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const now=Date.now(),date=new Date(now-86400000).toISOString().slice(0,10).replace(/-/g,'');
const names=['PRODAT_369147_1326897393.zip','PRODAT_369147_1326901642.zip'];
function config(dir){return {version:2,publicationEnabled:false,sourceDirectory:'/allstock/TVER/',host:'service.russvet.ru',port:21021,allowPlaintextForRussvet:true,stateDirectory:dir,credentialsFile:path.join(dir,'auth.json'),policy:{settleSeconds:60,maxModificationSkewSeconds:600,maxAgeHours:240,maxFileBytes:100000,maxXmlBytes:100000,minFreeBytes:1,downloadTimeoutMs:1000,firstPartRecords:100000,minSecondPartRecords:10000,baselineUniqueCodes:150000,maxSourceDropFraction:.1}};}
function fixture(){const stats={accesses:0,downloads:0,verifications:0},bodies=names.map(n=>Buffer.from(n));let entries=names.map((name,i)=>({name,isFile:true,size:bodies[i].length}));
 const factory=()=>({ftp:{},access:async o=>{assert.equal(o.host,'service.russvet.ru');assert.equal(o.port,21021);assert.equal(o.user,'prodat');assert.equal(o.secure,false);stats.accesses++;},list:async d=>{assert.equal(d,'/allstock/TVER/');return entries;},size:async p=>bodies[names.findIndex(n=>p.endsWith(n))].length,lastMod:async()=>new Date(now-600000),downloadTo:async(stream,p)=>{stats.downloads++;stream.end(bodies[names.findIndex(n=>p.endsWith(n))]);},close:()=>{}});
 const verifier=async files=>{stats.verifications++;return {status:'VERIFIED',conflicts:0,invalidRecords:0,categoryConflicts:0,uniqueSenderPrdCode:150000,identicalDuplicates:0,parts:files.map((f,i)=>({name:f.name,sha256:f.sha256,xmlBytes:100,records:i?50000:100000,document:{DocumentDate:date,documentDate:date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8)+'T00:00:00.000Z'}}))};};
 return {stats,factory,verifier,setEntries:x=>{entries=x;}};
}
async function temporary(work){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prodat-source-'));try{await fs.writeFile(path.join(dir,'auth.json'),JSON.stringify({username:'prodat',password:'fixture-secret'}),{mode:0o600});await work(config(dir));}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('a complete pair is downloaded and verified once; unchanged metadata never downloads or parses again',async()=>temporary(async c=>{
 const f=fixture();const first=await checkSource({config:c,now,clientFactory:f.factory,verifier:f.verifier});assert.equal(first.status,'VERIFIED');assert.equal(first.downloadedFiles,2);
 const second=await checkSource({config:c,now:now+1000,clientFactory:f.factory,verifier:f.verifier});assert.equal(second.status,'UNCHANGED_VERIFIED');assert.equal(second.downloadedFiles,0);assert.equal(f.stats.downloads,2);assert.equal(f.stats.verifications,1);assert.equal((await sourceStatus(c)).publicationEnabled,false);
}));
test('missing or ambiguous parts and source movement are rejected before a candidate is accepted',async()=>temporary(async c=>{
 const f=fixture();f.setEntries([{name:names[0],isFile:true}]);await assert.rejects(checkSource({config:c,now,clientFactory:f.factory,verifier:f.verifier}),e=>e.code==='EXACT_TWO_PRODAT_PARTS_REQUIRED');assert.equal(f.stats.downloads,0);
 f.setEntries([...names.map(name=>({name,isFile:true})),{name:'PRODAT_369147_9999999999.zip',isFile:true}]);await assert.rejects(checkSource({config:c,now,clientFactory:f.factory,verifier:f.verifier}),e=>e.code==='EXACT_TWO_PRODAT_PARTS_REQUIRED');
}));
test('failed content is retained as rejected and unchanged rejected bytes are not reprocessed',async()=>temporary(async c=>{
 const f=fixture(),bad=async files=>({...await f.verifier(files),status:'REJECTED',conflicts:1});
 await assert.rejects(checkSource({config:c,now,clientFactory:f.factory,verifier:bad}),e=>e.code==='SOURCE_CONTENT_REJECTED');
 const repeat=await checkSource({config:c,now:now+1000,clientFactory:f.factory,verifier:bad});assert.equal(repeat.status,'UNCHANGED_REJECTED');assert.equal(f.stats.downloads,2);assert.equal(f.stats.verifications,1);
}));
test('generation, record-count and code-loss gates refuse mixed or partially advanced pairs',async()=>temporary(async c=>{
 const f=fixture(),v=await f.verifier(names.map((name,i)=>({name,sha256:String(i).repeat(64)})));
 for(const change of [x=>x.parts[1].document.DocumentDate='20200101',x=>x.parts[0].records=99999,x=>x.uniqueSenderPrdCode=100000,x=>x.parts[0].xmlBytes=100001]){const n=structuredClone(v);change(n);assert.throws(()=>contentGates(n,c,null,now));}
 assert.throws(()=>contentGates(v,c,v,now),e=>e.code==='DOCUMENT_GENERATION_MUST_ADVANCE');
 const next=structuredClone(v);const nextDate=new Date(now+86400000).toISOString().slice(0,10).replace(/-/g,'');for(const p of next.parts){p.document.DocumentDate=nextDate;p.document.documentDate=nextDate.slice(0,4)+'-'+nextDate.slice(4,6)+'-'+nextDate.slice(6,8)+'T00:00:00.000Z';}next.parts[0].name='PRODAT_369147_1999999999.zip';next.parts[0].sha256='f'.repeat(64);
 assert.throws(()=>contentGates(next,c,v,now+2*86400000),e=>e.code==='BOTH_PRODAT_PARTS_MUST_ADVANCE');
}));
test('uncertain-publication marker and host limits stop checks; transport errors do not expose credentials',async()=>temporary(async c=>{
 const f=fixture();await fs.writeFile(path.join(c.stateDirectory,'needs-review.json'),'{}',{mode:0o600});await assert.rejects(checkSource({config:c,now,clientFactory:f.factory,verifier:f.verifier}),e=>e.code==='PUBLICATION_NEEDS_REVIEW');assert.equal(f.stats.accesses,0);await fs.unlink(path.join(c.stateDirectory,'needs-review.json'));
 await assert.rejects(checkSource({config:c,now,clientFactory:()=>({ftp:{},access:async()=>{throw new Error('fixture-secret postgres://password');},close:()=>{}}),verifier:f.verifier}),e=>e.code==='PRODAT_CHECK_FAILED');
 for(const name of ['source-state.json','events.ndjson']){const text=await fs.readFile(path.join(c.stateDirectory,name),'utf8');assert.ok(!text.includes('fixture-secret'));assert.ok(!text.includes('postgres://'));}
 await assert.rejects(discover(f.factory(),{...c,policy:{...c.policy,settleSeconds:1000000}},now),e=>e.code==='SOURCE_UNSETTLED_OR_STALE');
}));
test('publication is disabled before any connection or source read',async()=>{
 await assert.rejects(publishVerified({config:{publicationEnabled:false},files:[],verification:null}),e=>e.code==='PUBLICATION_DISABLED');
});
test('real streaming preflight deduplicates identical records and rejects conflicting characteristics',async()=>temporary(async c=>{
 const record=name=>'<DocDetail><SenderPrdCode>001</SenderPrdCode><ProductName>'+name+'</ProductName></DocDetail>';
 const make=async(i,name)=>{const zip=new AdmZip();zip.addFile(names[i].replace('.zip','.xml'),Buffer.from('<Document><DocType>PRODAT</DocType><SenderGln>4607166859990</SenderGln><ReceiverGln>4607081908611</ReceiverGln><DocumentNumber>'+names[i].match(/_(\d+)\.zip/)[1]+'</DocumentNumber><DocumentDate>'+date+'</DocumentDate>'+record(name)+'</Document>'));const file=path.join(c.stateDirectory,names[i]);await fs.writeFile(file,zip.toBuffer());return file;};
 const a=await make(0,'A'),b=await make(1,'A');const identical=await preflight([a,b]);assert.equal(identical.status,'VERIFIED');assert.equal(identical.uniqueSenderPrdCode,1);assert.equal(identical.identicalDuplicates,1);
 await make(1,'B');const conflicting=await preflight([a,b]);assert.equal(conflicting.status,'REJECTED');assert.equal(conflicting.conflicts,1);
}));
test('bootstrap adoption requires an exact prior remote receipt, not just a matching filename',async()=>temporary(async c=>{
 const f=fixture(),bootstrap=path.join(c.stateDirectory,'bootstrap');await fs.mkdir(bootstrap,{mode:0o700});
 const files=[];for(const name of names){const body=Buffer.from(name),file=path.join(bootstrap,name);await fs.writeFile(file,body,{mode:0o600});files.push({path:file,name,sha256:sha(body)});}
 const proof=await f.verifier(files);f.stats.verifications=0;const proofFile=path.join(bootstrap,'proof.json');await fs.writeFile(proofFile,JSON.stringify(proof),{mode:0o600});
 const approved=names.map((name,i)=>({name,sha256:files[i].sha256,sizeBytes:Buffer.byteLength(name),modified:new Date(now-600000).toISOString()}));
 const first=await checkSource({config:{...c,bootstrapDirectory:bootstrap,bootstrapVerificationFile:proofFile,bootstrapApproved:approved},now,clientFactory:f.factory,verifier:f.verifier});assert.equal(first.adoptedVerifiedBootstrap,true);assert.equal(f.stats.downloads,0);assert.equal(f.stats.verifications,0);
}));
test('a stale bootstrap receipt cannot replace current FTP bytes',async()=>temporary(async c=>{
 const f=fixture();const approved=names.map(name=>({name,sizeBytes:Buffer.byteLength(name),modified:new Date(now-700000).toISOString(),sha256:'0'.repeat(64)}));
 const result=await checkSource({config:{...c,bootstrapDirectory:c.stateDirectory,bootstrapVerificationFile:path.join(c.stateDirectory,'must-not-be-read.json'),bootstrapApproved:approved},now,clientFactory:f.factory,verifier:f.verifier});assert.equal(result.adoptedVerifiedBootstrap,false);assert.equal(f.stats.downloads,2);assert.equal(f.stats.verifications,1);
}));

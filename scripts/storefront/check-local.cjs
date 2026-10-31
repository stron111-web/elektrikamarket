'use strict';
// All mutable resources are newly created local Docker fixtures, never the user's DB/VPS.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process'),{pipeline}=require('node:stream/promises');
const root=path.resolve(__dirname,'../..'),archive=path.resolve(process.argv[2]||'');
const image=process.argv[3]||'elektrikamarket-storefront:assortment-check';
const nodeImage='node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c';
const id='em-assortment-'+crypto.randomBytes(5).toString('hex'),resources=[];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),id+'-')),password=crypto.randomBytes(32).toString('base64url'),roPassword=crypto.randomBytes(32).toString('base64url');
const dbName='elektrikamarket_test_20261029t010219z_2761a73c';
let stage='initial';
function start(args,env={}){
 const p=spawn('docker',args,{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,...env}}),out=[],err=[];
 p.stdout.on('data',b=>out.push(b));p.stderr.on('data',b=>err.push(b));p.stdin.on('error',()=>{});
 const done=new Promise((resolve,reject)=>{p.on('error',()=>reject(Error('Docker could not start at '+stage)));p.on('close',code=>{
  let message=Buffer.concat(err).toString();for(const s of [password,roPassword])message=message.replaceAll(s,'[redacted]');
  if(code===0)resolve(Buffer.concat(out).toString().trim());else reject(Error(stage+' exit '+code+': '+message.slice(0,3500)+' '+Buffer.concat(out).toString().replaceAll(password,'[redacted]').replaceAll(roPassword,'[redacted]').slice(-4500)));
 });});done.catch(()=>{});return {p,done};
}
async function run(args,input='',env={}){const r=start(args,env);r.p.stdin.end(input);return r.done;}
const put=(name,s)=>fs.writeFileSync(path.join(temp,name),s,{mode:0o600});
const pg=(s,database=dbName)=>run(['exec','-i',id+'-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','fixture_admin','-d',database],s);
async function wait(check){for(let i=0;i<60;i++){if(await check())return;await new Promise(r=>setTimeout(r,1000));}throw Error('Readiness timeout at '+stage);}
(async()=>{try{
 assert(fs.statSync(archive).isFile());const expected=fs.readFileSync(path.join(path.dirname(archive),'SHA256SUMS'),'utf8').split('\n').find(l=>l.endsWith('  database.dump')).slice(0,64);
 const sha=crypto.createHash('sha256');for await(const b of fs.createReadStream(archive))sha.update(b);assert.equal(sha.digest('hex'),expected);
 if(process.platform==='win32'){const sid=execFileSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8'}).match(/S-1-5-[0-9-]+/)[0];execFileSync('icacls',[temp,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{stdio:'ignore'});}
 stage='fixture-create';await run(['network','create',id]);resources.push(['network',id]);
 await run(['volume','create',id+'-data']);resources.push(['volume',id+'-data']);
 await run(['run','-d','--name',id+'-db','--network',id,'--network-alias','postgres','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_DB=postgres','-e','POSTGRES_PASSWORD','--mount','type=volume,source='+id+'-data,target=/var/lib/postgresql/data','postgres:17'],'',{POSTGRES_PASSWORD:password});resources.push(['container',id+'-db']);
 await wait(async()=>{try{await run(['exec',id+'-db','pg_isready','-U','fixture_admin','-d','postgres']);return true;}catch{return false;}});
 const admin='postgresql://fixture_admin:'+password+'@postgres:5432/postgres';

 fs.mkdirSync(path.join(temp,'bin'));
 for(const ref of ['1d35206','a5d73f9'])put('legacy-'+ref+'.cjs',execFileSync('git',['show',ref+':scripts/import/prodat-import.cjs'],{cwd:root,encoding:'utf8'}));
 put('git-show.cjs',"const fs=require('fs');const a=process.argv.slice(2);if(a.length!==2||a[0]!=='show'||!['1d35206:scripts/import/prodat-import.cjs','a5d73f9:scripts/import/prodat-import.cjs'].includes(a[1]))process.exit(2);process.stdout.write(fs.readFileSync('/checks/legacy-'+a[1].split(':')[0]+'.cjs'));");
 fs.writeFileSync(path.join(temp,'bin/git'),'#!/bin/sh\nexec /usr/local/bin/node /checks/git-show.cjs "$@"\n',{mode:0o700});
 stage='all-tests';const tests=fs.readdirSync(path.join(root,'scripts/import')).filter(n=>n.endsWith('.test.cjs')).map(n=>'scripts/import/'+n);
 const testOutput=await run(['run','--rm','--network',id,'--mount','type=bind,source='+root+',target=/work,readonly','--workdir','/work','--mount','type=bind,source='+temp+',target=/checks,readonly','-e','PATH=/checks/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','-e','PRODAT_TEST_ADMIN_URL','-e','PRICAT_TEST_ADMIN_URL','-e','ASSORTMENT_TEST_ADMIN_URL',nodeImage,'node','--test','--test-reporter=tap',...tests,'scripts/storefront/assortment.test.cjs'],'',{PRODAT_TEST_ADMIN_URL:admin,PRICAT_TEST_ADMIN_URL:admin,ASSORTMENT_TEST_ADMIN_URL:admin});
 console.log(testOutput);
 stage='restore-copy';await pg('CREATE DATABASE "'+dbName+'";','postgres');
 const restore=start(['exec','-i',id+'-db','pg_restore','-U','fixture_admin','-d',dbName,'--no-owner','--no-acl','--single-transaction']);
 await Promise.all([pipeline(fs.createReadStream(archive),restore.p.stdin),restore.done]);
 await pg(fs.readFileSync(path.join(root,'prisma/migrations/20261030000000_assortment_snapshot/migration.sql'),'utf8'));
 await pg('ANALYZE;');
 put('legacy-data.ts',execFileSync('git',['show','6540963:web/lib/data.ts'],{cwd:root,encoding:'utf8'}));
 const target=admin.replace('/postgres','/'+dbName);
 stage='real-equivalence-benchmark';
 console.log(await run(['run','--rm','--network',id,'--mount','type=bind,source='+root+',target=/work,readonly','--mount','type=bind,source='+temp+',target=/checks,readonly','--workdir','/work','-e','ASSORTMENT_COPY_URL',nodeImage,'node','scripts/storefront/benchmark-copy.cjs'],'',{ASSORTMENT_COPY_URL:target}));
 stage='readonly-grants';await pg(fs.readFileSync(path.join(root,'deploy/storefront/readonly-role.sql'),'utf8'));
 await pg(fs.readFileSync(path.join(root,'deploy/storefront/snapshot-grants.sql'),'utf8'));
 await pg("SET password_encryption='scram-sha-256'; ALTER ROLE storefront_test_ro PASSWORD '"+roPassword+"';");
 put('database_url','postgresql://storefront_test_ro:'+roPassword+'@postgres:5432/'+dbName+'\n');
 stage='web-start';await run(['run','-d','--name',id+'-web','--network',id,'-e','STOREFRONT_DIAGNOSTICS=1','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--tmpfs','/app/web/.next/cache:rw,noexec,nosuid,size=64m,uid=1000,gid=1000','--mount','type=bind,source='+path.join(temp,'database_url')+',target=/run/secrets/storefront_database_url,readonly',image]);resources.push(['container',id+'-web']);
 await wait(async()=>(await run(['inspect','--format','{{.State.Health.Status}}',id+'-web']))==='healthy');
 stage='http-smoke';const smoke=fs.readFileSync(path.join(root,'web/tests/smoke.cjs'),'utf8')
  .replace("const postgres = require('postgres');","const postgres = require('node:module').createRequire('/app/web/server.js')('postgres');")
  .replace(/^require\('dotenv'\).*$/m,'').replace(/^const \{ connectionUrl \}.*$/m,'const connectionUrl=v=>v;')
  .replace("require('../../scripts/import/pricat-store.cjs')","require('/app/scripts/import/pricat-store.cjs')");
 console.log(await run(['exec','-i',id+'-web','node'],"process.env.DATABASE_URL=require('fs').readFileSync('/run/secrets/storefront_database_url','utf8').trim();\n"+smoke));
 for(const name of [id+'-db',id+'-web'])assert.equal(await run(['inspect','--format','{{json .HostConfig.PortBindings}}',name]),'{}');
 console.log('PASS isolated copied-data tests, benchmark, read-only HTTP smoke; no published host ports');
}finally{
 stage='fixture-cleanup';for(const[k,n]of resources.reverse())await run(k==='container'?['rm','-f',n]:[k,'rm',n]);
 for(const n of ['database_url','legacy-data.ts','legacy-1d35206.cjs','legacy-a5d73f9.cjs','git-show.cjs','bin/git']){const f=path.join(temp,n);if(fs.existsSync(f))fs.unlinkSync(f);}if(fs.existsSync(path.join(temp,'bin')))fs.rmdirSync(path.join(temp,'bin'));fs.rmdirSync(temp);
}})().catch(e=>{console.error(e.message);process.exitCode=1;});

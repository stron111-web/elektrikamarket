'use strict';
// Local-only fixture. No connection to the user's running database or VPS.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {pipeline}=require('node:stream/promises');
const root=path.resolve(__dirname,'../..'),archive=path.resolve(process.argv[2]||'');
const image=process.argv[3]||'elektrikamarket-storefront:local-check',caddyImage=process.env.CADDY_TEST_IMAGE||'caddy@sha256:5e5286cb37d44086d651a5363f05f43a692ce4d649d88fb1bd844579f45fa9e8';
const id='em-check-'+crypto.randomBytes(5).toString('hex'),dbName='elektrikamarket_test_20261029t010219z_2761a73c';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),id+'-')),resources=[];
const secret=()=>crypto.randomBytes(32).toString('base64url');
const adminPassword=secret(),rolePassword=secret(),authPassword=secret();
let stage='archive';
function start(args,env={}){
 const p=spawn('docker',args,{env:{...process.env,...env},windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks=[],errors=[];
 p.stdout.on('data',b=>chunks.push(b));p.stderr.on('data',b=>errors.push(b));p.stdin.on('error',()=>{});
 const done=new Promise((resolve,reject)=>{p.on('error',()=>reject(new Error('Could not start Docker')));p.on('close',code=>code===0?resolve(Buffer.concat(chunks).toString().trim()):reject(new Error('Docker operation failed at '+stage+', exit='+code+' '+Buffer.concat(errors).toString().replaceAll(adminPassword,'[redacted]').replaceAll(rolePassword,'[redacted]').replaceAll(authPassword,'[redacted]').slice(0,1200))));});
 done.catch(()=>{});return{p,done};
}
async function run(args,input='',env={}){const s=start(args,env);s.p.stdin.end(input);return s.done;}
function put(name,value){fs.writeFileSync(path.join(temp,name),value,{mode:0o600});}
async function pg(input){return run(['exec','-i',id+'-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','fixture_admin','-d',dbName],input);}
async function waitReady(check){for(let i=0;i<60;i++){if(await check())return;await new Promise(r=>setTimeout(r,1000));}throw new Error('Readiness timed out at '+stage);}
(async()=>{try{
 assert(fs.statSync(archive).isFile(),'Archive is required');
 const expected=fs.readFileSync(path.join(path.dirname(archive),'SHA256SUMS'),'utf8').split('\n').find(l=>l.endsWith('  database.dump'))?.slice(0,64);
 const hash=crypto.createHash('sha256');for await(const b of fs.createReadStream(archive))hash.update(b);assert.equal(hash.digest('hex'),expected,'Archive checksum');
 if(process.platform==='win32'){
  const sid=execFileSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8'}).match(/S-1-5-[0-9-]+/)[0];
  execFileSync('icacls',[temp,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{stdio:'ignore'});
 }
 stage='fixture-create';
 await run(['network','create',id]);resources.push(['network',id]);
 await run(['volume','create',id+'-data']);resources.push(['volume',id+'-data']);
 await run(['run','-d','--name',id+'-db','--network',id,'--network-alias','postgres','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_DB='+dbName,'-e','POSTGRES_PASSWORD','--mount','type=volume,source='+id+'-data,target=/var/lib/postgresql/data','postgres:17'],'',{POSTGRES_PASSWORD:adminPassword});resources.push(['container',id+'-db']);
 await waitReady(async()=>{try{await run(['exec',id+'-db','pg_isready','-h','127.0.0.1','-U','fixture_admin','-d',dbName]);return true;}catch{return false;}});
 stage='fixture-restore';console.log('Restoring archive into isolated local fixture');
 const restore=start(['exec','-i',id+'-db','pg_restore','-U','fixture_admin','-d',dbName,'--no-owner','--no-acl','--single-transaction']);
 await Promise.all([pipeline(fs.createReadStream(archive),restore.p.stdin),restore.done]);await pg('ANALYZE;');
 stage='readonly-role';await pg(fs.readFileSync(path.join(__dirname,'readonly-role.sql'),'utf8'));
 await pg("SET password_encryption='scram-sha-256'; ALTER ROLE storefront_test_ro PASSWORD '"+rolePassword+"';");
 const before=await pg('SELECT count(*) FROM products;');assert.equal(before,'148872');
 put('database_url','postgresql://storefront_test_ro:'+rolePassword+'@postgres:5432/'+dbName+'\n');put('auth_password',authPassword);
 stage='caddy-image';try{await run(['image','inspect',caddyImage]);}catch{await run(['pull',caddyImage]);}
 const authHash=await run(['run','--rm','-i',caddyImage,'caddy','hash-password'],authPassword+'\n');assert.match(authHash,/^\$2[aby]\$/);
 put('basic_auth.caddy','tester '+authHash+'\n');
 put('Caddyfile',fs.readFileSync(path.join(__dirname,'Caddyfile'),'utf8').replace('  header {','  tls internal\n  header {'));
 stage='compose-validation';await run(['compose','-f',path.join(__dirname,'compose.yaml'),'config','--quiet'],'',{STOREFRONT_IMAGE:image,CADDY_IMAGE:caddyImage,STOREFRONT_SECRET_DIR:temp,POSTGRES_NETWORK:id});
 stage='start-web';
 await run(['run','-d','--name',id+'-web','--network',id,'--network-alias','web','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=768m','--cpus=1.5','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--tmpfs','/app/web/.next/cache:rw,noexec,nosuid,size=64m,uid=1000,gid=1000','--mount','type=bind,source='+path.join(temp,'database_url')+',target=/run/secrets/storefront_database_url,readonly','--mount','type=bind,source='+temp+',target=/checks,readonly',image]);resources.push(['container',id+'-web']);
 await waitReady(async()=>(await run(['inspect','--format','{{.State.Health.Status}}',id+'-web']))==='healthy');
 stage='start-caddy';
 await run(['run','-d','--name',id+'-caddy','--network',id,'--network-alias','caddy','-e','STOREFRONT_HOST=caddy:8443','--mount','type=bind,source='+path.join(temp,'Caddyfile')+',target=/etc/caddy/Caddyfile,readonly','--mount','type=bind,source='+path.join(temp,'basic_auth.caddy')+',target=/run/secrets/storefront_basic_auth,readonly','--tmpfs','/data','--tmpfs','/config',caddyImage]);resources.push(['container',id+'-caddy']);
 await waitReady(async()=>{try{await run(['exec',id+'-caddy','test','-f','/data/caddy/pki/authorities/local/root.crt']);return true;}catch{return false;}});
 put('caddy-ca.crt',await run(['exec',id+'-caddy','cat','/data/caddy/pki/authorities/local/root.crt']));
 const prefix="const fs=require('node:fs');process.env.DATABASE_URL=fs.readFileSync('/run/secrets/storefront_database_url','utf8').trim();process.env.STOREFRONT_TEST_URL='https://caddy:8443';const auth='Basic '+Buffer.from('tester:'+fs.readFileSync('/checks/auth_password','utf8')).toString('base64');\n";
 let smoke=fs.readFileSync(path.join(root,'web/tests/smoke.cjs'),'utf8')
  .replace("const postgres = require('postgres');","const postgres = require('node:module').createRequire('/app/web/server.js')('postgres');")
  .replace(/^require\('dotenv'\).*$/m,'').replace(/^const \{ connectionUrl \}.*$/m,"const connectionUrl=value=>value;")
  .replace("require('../../scripts/import/pricat-store.cjs')","require('/app/scripts/import/pricat-store.cjs')")
  .replace('fetch(base + url)','fetch(base + url,{headers:{Authorization:auth}})');
 put('smoke.cjs',prefix+smoke);put('security.cjs',fs.readFileSync(path.join(__dirname,'security-smoke.cjs'),'utf8'));
 stage='security-checks';console.log(await run(['exec','-e','NODE_EXTRA_CA_CERTS=/checks/caddy-ca.crt',id+'-web','node','/checks/security.cjs']));
 stage='catalog-smoke';console.log(await run(['exec','-e','NODE_EXTRA_CA_CERTS=/checks/caddy-ca.crt',id+'-web','node','/checks/smoke.cjs']));
 assert.equal(await pg('SELECT count(*) FROM products;'),before);
 for(const name of [id+'-db',id+'-web',id+'-caddy'])assert.equal(await run(['inspect','--format','{{json .HostConfig.PortBindings}}',name]),'{}');
 console.log('PASS no published host ports; fixture product count unchanged\nPASS local storefront integration');
}finally{
 stage='fixture-cleanup';
 for(const[kind,name]of resources.reverse())await run(kind==='container'?['rm','-f',name]:[kind,'rm',name]);
 for(const name of ['database_url','auth_password','basic_auth.caddy','Caddyfile','caddy-ca.crt','smoke.cjs','security.cjs']){const file=path.join(temp,name);if(fs.existsSync(file))fs.unlinkSync(file);}
 fs.rmdirSync(temp);
}})().catch(error=>{console.error(error.message);process.exitCode=1;});

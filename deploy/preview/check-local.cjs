'use strict';
// Full integration uses only newly created local Docker resources and a private archive COPY.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process'),{pipeline}=require('node:stream/promises');
const root=path.resolve(__dirname,'../..'),archive=path.resolve(process.argv[2]||'');
const image=process.argv[3]||'elektrikamarket-preview:local-check';
const caddyImage='caddy@sha256:5e5286cb37d44086d651a5363f05f43a692ce4d649d88fb1bd844579f45fa9e8';
const nodeImage='node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c';
const id='em-preview-'+crypto.randomBytes(5).toString('hex'),resources=[],redact=[];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),id+'-')),dbName='elektrikamarket_test_20261029t010219z_2761a73c';
const secret=()=>{const value=crypto.randomBytes(32).toString('base64url');redact.push(value);return value;};
const adminPassword=secret(),rolePassword=secret(),previewPassword=secret(),ownerPassword=secret(),developerPassword=secret();let stage='archive';
function start(args,env={}){const p=spawn('docker',args,{env:{...process.env,...env},windowsHide:true,stdio:['pipe','pipe','pipe']}),out=[],err=[];p.stdout.on('data',b=>out.push(b));p.stderr.on('data',b=>err.push(b));p.stdin.on('error',()=>{});const done=new Promise((resolve,reject)=>{p.on('error',()=>reject(Error('Docker launch failed at '+stage)));p.on('close',code=>{let e=Buffer.concat(err).toString();for(const s of redact)e=e.replaceAll(s,'[redacted]');code===0?resolve(Buffer.concat(out).toString().trim()):reject(Error(stage+' exit '+code+': '+e.slice(-2200)));});});done.catch(()=>{});return {p,done};}
async function run(args,input='',env={}){const r=start(args,env);r.p.stdin.end(input);return r.done;}
const put=(n,s)=>fs.writeFileSync(path.join(temp,n),s,{mode:0o600});
const pg=s=>run(['exec','-i',id+'-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','fixture_admin','-d',dbName],s);
const previewEnv={PREVIEW_IMAGE:image,PREVIEW_DATABASE_URL_FILE:path.join(temp,'preview_database_url'),PREVIEW_FRONTEND_NETWORK:id+'-front',PREVIEW_DATABASE_NETWORK:id+'-database',COMPOSE_DISABLE_ENV_FILE:'1'};
const compose=(args)=>run(['compose','--project-name',id,'-f',path.join(__dirname,'compose.yaml'),...args],'',previewEnv);
async function wait(check){for(let n=0;n<60;n++){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('Readiness timeout at '+stage);}
const info=(name,format)=>run(['inspect','--format',format,name]);
const fixtureClient=()=>run(['run','--rm','--network',id+'-front','--mount','type=bind,source='+temp+',target=/checks,readonly','-e','NODE_EXTRA_CA_CERTS=/checks/caddy-ca.crt',nodeImage,'node','/checks/client.cjs']);
(async()=>{try{
 assert(fs.statSync(archive).isFile());const line=fs.readFileSync(path.join(path.dirname(archive),'SHA256SUMS'),'utf8').split('\n').find(l=>l.endsWith('  database.dump'));assert(line);const hash=crypto.createHash('sha256');for await(const b of fs.createReadStream(archive))hash.update(b);assert.equal(hash.digest('hex'),line.slice(0,64));
 if(process.platform==='win32'){const sid=execFileSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8'}).match(/S-1-5-[0-9-]+/)[0];execFileSync('icacls',[temp,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{stdio:'ignore'});}
 stage='fixture-create';for(const suffix of ['front','database']){await run(['network','create',id+'-'+suffix]);resources.push(['network',id+'-'+suffix]);}await run(['volume','create',id+'-data']);resources.push(['volume',id+'-data']);
 await run(['run','-d','--name',id+'-db','--network',id+'-database','--network-alias','postgres','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_DB='+dbName,'-e','POSTGRES_PASSWORD','--mount','type=volume,source='+id+'-data,target=/var/lib/postgresql/data','postgres:17'],'',{POSTGRES_PASSWORD:adminPassword});resources.push(['container',id+'-db']);
 await wait(async()=>{await run(['exec',id+'-db','pg_isready','-h','127.0.0.1','-U','fixture_admin','-d',dbName]);return true;});
 stage='restore-isolated-copy';console.log('SHA verified; restoring only isolated fixture');const restore=start(['exec','-i',id+'-db','pg_restore','-U','fixture_admin','-d',dbName,'--no-owner','--no-acl','--single-transaction']);await Promise.all([pipeline(fs.createReadStream(archive),restore.p.stdin),restore.done]);await pg('ANALYZE;');
 await pg(fs.readFileSync(path.join(root,'deploy/storefront/readonly-role.sql'),'utf8'));await pg("SET password_encryption='scram-sha-256'; ALTER ROLE storefront_test_ro PASSWORD '"+rolePassword+"';");
 await pg(fs.readFileSync(path.join(__dirname,'readonly-role.sql'),'utf8'));await pg("SET password_encryption='scram-sha-256'; ALTER ROLE storefront_preview_ro PASSWORD '"+previewPassword+"';");
 const countBefore=await pg('SELECT count(*) FROM products;');assert.equal(countBefore,'148872');put('database_url','postgresql://storefront_test_ro:'+rolePassword+'@postgres:5432/'+dbName+'\n');put('preview_database_url','postgresql://storefront_preview_ro:'+previewPassword+'@postgres:5432/'+dbName+'\n');put('owner_password',ownerPassword);put('developer_password',developerPassword);
 const hashes=[];for(const [user,password]of [['owner',ownerPassword],['developer',developerPassword]]){const hash=await run(['run','--rm','-i','--network','none',caddyImage,'caddy','hash-password'],password+'\n');assert.match(hash,/^\$2[aby]\$/);redact.push(hash);hashes.push(user+' '+hash);}put('basic_auth.caddy',hashes.join('\n')+'\n');
 const original=fs.readFileSync(path.join(root,'deploy/storefront/Caddyfile'),'utf8').replace('  header {','  tls internal\n  header {');put('Caddyfile',original);
 stage='start-existing-site-fixture';await run(['run','-d','--name',id+'-test','--network',id+'-database','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--tmpfs','/app/web/.next/cache:rw,noexec,nosuid,size=64m,uid=1000,gid=1000','--mount','type=bind,source='+path.join(temp,'database_url')+',target=/run/secrets/storefront_database_url,readonly',image]);resources.push(['container',id+'-test']);await run(['network','connect','--alias','web',id+'-front',id+'-test']);await wait(async()=>(await info(id+'-test','{{.State.Health.Status}}'))==='healthy');
 await run(['run','-d','--name',id+'-caddy','--network',id+'-front','--network-alias','test.elektro-24.ru','--network-alias','preview.elektro-24.ru','-e','STOREFRONT_HOST=test.elektro-24.ru:8443','--mount','type=bind,source='+path.join(temp,'Caddyfile')+',target=/etc/caddy/Caddyfile,readonly','--mount','type=bind,source='+path.join(temp,'basic_auth.caddy')+',target=/run/secrets/storefront_basic_auth,readonly',caddyImage]);resources.push(['container',id+'-caddy']);
 await wait(async()=>{put('caddy-ca.crt',await run(['exec',id+'-caddy','cat','/data/caddy/pki/authorities/local/root.crt']));return true;});
 const testIdentity=await info(id+'-test','{{.Id}} {{.State.StartedAt}}'),caddyIdentity=await info(id+'-caddy','{{.Id}} {{.State.StartedAt}}');
 stage='preview-compose';await compose(['config','--quiet']);resources.push(['compose',null]);await compose(['up','-d','--no-deps','--pull','never','--wait','--wait-timeout','120','preview']);
 // Append into the same bind-mounted file: do not replace its inode.
 const fragment=fs.readFileSync(path.join(__dirname,'Caddyfile.preview'),'utf8').replace('preview.elektro-24.ru {','preview.elektro-24.ru:8443 {\n  tls internal');fs.appendFileSync(path.join(temp,'Caddyfile'),'\n'+fragment);
 stage='caddy-graceful-reload';await run(['exec',id+'-caddy','caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']);await run(['kill','--signal=USR1',id+'-caddy']);
 put('client.cjs',fs.readFileSync(path.join(__dirname,'tests/client.cjs'),'utf8'));await new Promise(r=>setTimeout(r,1000));stage='tls-auth-catalog';console.log(await fixtureClient());
 stage='database-privilege-check';const rights=await run(['exec','-i','-e','PGPASSWORD',id+'-db','psql','-h','127.0.0.1','-X','-qAt','-v','ON_ERROR_STOP=1','-U','storefront_preview_ro','-d',dbName],"BEGIN READ ONLY; SELECT count(*) FROM products; SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'); COMMIT;",{PGPASSWORD:previewPassword});assert.equal(rights,'148872\n0');
 let denied=false;try{await run(['exec','-i','-e','PGPASSWORD',id+'-db','psql','-h','127.0.0.1','-X','-qAt','-v','ON_ERROR_STOP=1','-U','storefront_preview_ro','-d',dbName],'SET default_transaction_read_only=off; UPDATE products SET name=name WHERE false;',{PGPASSWORD:previewPassword});}catch{denied=true;}assert(denied);
 const originalImage=await info((await compose(['ps','-q','preview'])).trim(),'{{.Image}}');
 stage='preview-update';const image2=id+'-second:check';await run(['build','-f',path.join(root,'web/Dockerfile'),'--label','org.elektrikamarket.preview-fixture=second','-t',image2,root]);resources.push(['image',image2]);previewEnv.PREVIEW_IMAGE=image2;await compose(['up','-d','--no-deps','--pull','never','--wait','--wait-timeout','120','preview']);assert.notEqual(await info((await compose(['ps','-q','preview'])).trim(),'{{.Image}}'),originalImage);
 stage='preview-rollback';previewEnv.PREVIEW_IMAGE=image;await compose(['up','-d','--no-deps','--pull','never','--wait','--wait-timeout','120','preview']);assert.equal(await info((await compose(['ps','-q','preview'])).trim(),'{{.Image}}'),originalImage);console.log(await fixtureClient());
 assert.equal(await info(id+'-test','{{.Id}} {{.State.StartedAt}}'),testIdentity);assert.equal(await info(id+'-caddy','{{.Id}} {{.State.StartedAt}}'),caddyIdentity);assert.equal(await pg('SELECT count(*) FROM products;'),countBefore);
 for(const name of [id+'-db',id+'-test',id+'-caddy',(await compose(['ps','-q','preview'])).trim()])assert.equal(await info(name,'{{json .HostConfig.PortBindings}}'),'{}');
 console.log('PASS preview-only update/rollback, unchanged test/Caddy identities, read-only ACL, no published host ports');
}finally{
 stage='fixture-cleanup';// Stop/remove only resources this invocation created, never down/prune.
 // Remove preview before its image and external networks.
 if(resources.some(r=>r[0]==='compose')){await compose(['rm','--stop','--force','preview']);}
 for(const [kind,name]of resources.reverse()){if(kind==='compose')continue;await run(kind==='container'?['rm','-f',name]:[kind,'rm',name]);}
 for(const name of fs.readdirSync(temp)){assert.equal(path.dirname(path.resolve(temp,name)),temp);fs.unlinkSync(path.join(temp,name));}fs.rmdirSync(temp);
}})().catch(e=>{console.error(e.message);process.exitCode=1;});

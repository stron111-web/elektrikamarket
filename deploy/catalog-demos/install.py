#!/usr/bin/env python3
"""First install of the isolated demo. Never recreates any existing shop service."""
import datetime,json,os,pathlib,re,subprocess,sys,time,urllib.request,urllib.error
os.umask(0o077)
base=pathlib.Path('/home/shopadmin/elektrikamarket-catalog-demos')
release=pathlib.Path(sys.argv[1]);image=sys.argv[2]
assert sys.argv[3:] in ([],['--update'])
updating=sys.argv[3:]==['--update']
assert release.parent==base/'releases' and re.fullmatch('[a-f0-9]{7,40}',release.name)
assert re.fullmatch('sha256:[a-f0-9]{64}',image)
WEB='elektrikamarket-catalog-demos-web';GATE='elektrikamarket-catalog-demos-gateway';NET='elektrikamarket-catalog-demos-frontend'
existing=['elektrikamarket-storefront-web-1','elektrikamarket-preview-preview-1','elektrikamarket-storefront-caddy-1','elektrikamarket-deploy-postgres-1']
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name],text=True))[0]
def frame():return {name:{'id':(r:=inspect(name))['Id'],'image':r['Image'],'startedAt':r['State']['StartedAt']} for name in existing}
before=frame();cron=subprocess.check_output(['crontab','-l'],text=True)
if updating:
 assert (base/'installation.json').exists(),'No demo installation to update'
 old=[inspect(name) for name in [WEB,GATE]]
 assert all(r['Config']['Labels'].get('elektrikamarket.scope')=='catalog-demos' for r in old),'Only demo containers may be replaced'
 network=json.loads(subprocess.check_output(['docker','network','inspect',NET],text=True))[0]
 assert network['Labels'].get('elektrikamarket.scope')=='catalog-demos'
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 (base/('rollback-containers-'+stamp+'.json')).write_text(json.dumps(old,indent=2)+'\n')
else:
 assert not (base/'installation.json').exists(),'Use explicit --update for an existing demo, never a second parallel install'
 for name in [WEB,GATE]:assert subprocess.run(['docker','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
 assert subprocess.run(['docker','network','inspect',NET],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
ports=subprocess.check_output(['ss','-ltnH'],text=True)
if not updating:assert not re.search(r':(?:8443|18081)\s',ports),'Demo ports are in use'
assert subprocess.check_output(['docker','image','inspect',image,'--format','{{.Id}}'],text=True).strip()==image
cert=pathlib.Path('/var/lib/docker/volumes/elektrikamarket-storefront_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/test.elektro-24.ru')
auth='/home/shopadmin/elektrikamarket-storefront-secrets/basic_auth.caddy'
secret='/home/shopadmin/elektrikamarket-storefront-secrets/database_url'
gateway=inspect('elektrikamarket-storefront-caddy-1')['Image']
base.mkdir(mode=0o700,exist_ok=True)
if updating:
 baseline=json.loads((base/'baseline.json').read_text());assert baseline['containers']==before and baseline['crontab']==cron
else:(base/'baseline.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'containers':before,'crontab':cron},indent=2)+'\n')
program=r'''
const fs=require('fs'),postgres=require('postgres'),assert=require('assert/strict');(async()=>{const u=new URL(fs.readFileSync('/run/secrets/storefront_database_url','utf8').trim());assert.equal(decodeURIComponent(u.username),'storefront_test_ro');u.searchParams.delete('schema');const db=postgres(u.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:true}});try{await db.begin('read only',async tx=>{const [role]=await tx`SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;assert(!role.rolsuper&&!role.rolcreatedb&&!role.rolcreaterole);const writes=await tx`SELECT tablename FROM pg_tables WHERE schemaname='public' AND (has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT') OR has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'UPDATE') OR has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'DELETE'))`;assert.equal(writes.length,0);const [snapshot]=await tx`SELECT id,"productCount" FROM assortment_snapshots WHERE active`;console.log(JSON.stringify({role:'storefront_test_ro',writeableTables:0,transactionReadOnly:true,snapshot}));});}finally{await db.end();}})().catch(()=>{console.error('DEMO_READONLY_PREFLIGHT_FAILED');process.exitCode=1;});
'''
proof=subprocess.check_output(['docker','run','--rm','--read-only','--network','elektrikamarket-deploy_default','--entrypoint','node','--mount','type=bind,source='+secret+',target=/run/secrets/storefront_database_url,readonly',image,'-e',program],text=True)
(base/'readonly-proof.json').write_text(proof)
if updating:
 for name in [GATE,WEB]:
  subprocess.run(['docker','stop',name],check=True,stdout=subprocess.DEVNULL)
  subprocess.run(['docker','rm',name],check=True,stdout=subprocess.DEVNULL)
else:subprocess.run(['docker','network','create','--label','elektrikamarket.scope=catalog-demos',NET],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['docker','run','-d','--name',WEB,'--label','elektrikamarket.scope=catalog-demos','--restart','unless-stopped','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','768m','--cpus','1','--pids-limit','128','--network','elektrikamarket-deploy_default','--publish','127.0.0.1:18081:3000','--tmpfs','/tmp:rw,nosuid,noexec,size=64m,uid=1000,gid=1000','--mount','type=bind,source='+secret+',target=/run/secrets/storefront_database_url,readonly',image],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['docker','network','connect',NET,WEB],check=True)
for attempt in range(45):
 try:
  with urllib.request.urlopen('http://127.0.0.1:18081/demo/catalogs',timeout=15) as response:
   assert response.status==200;body=response.read().decode();assert 'Концепция' in body or 'КОНЦЕПЦИЯ' in body
  break
 except Exception:
  if attempt==44:raise
  time.sleep(2)
mounts=['--mount','type=bind,source='+str(release/'deploy/catalog-demos/Caddyfile')+',target=/etc/caddy/Caddyfile,readonly','--mount','type=bind,source='+str(cert)+',target=/run/certs,readonly','--mount','type=bind,source='+auth+',target=/run/secrets/storefront_basic_auth,readonly']
with open(base/('gateway-validation-'+release.name+'.log'),'xb') as log:subprocess.run(['docker','run','--rm','--network',NET]+mounts+[gateway,'caddy','validate','--config','/etc/caddy/Caddyfile'],check=True,stdout=log,stderr=log)
# The stock Caddy binary carries cap_net_bind_service. Its file capability must
# be in the bounding set even when listening on 8443, or exec returns EPERM.
# DAC_OVERRIDE permits reading the existing owner-0600 auth file; all host mounts
# and rootfs remain read-only. No credential copy or original permission change.
subprocess.run(['docker','run','-d','--name',GATE,'--label','elektrikamarket.scope=catalog-demos','--restart','unless-stopped','--read-only','--cap-drop','ALL','--cap-add','NET_BIND_SERVICE','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges','--memory','128m','--cpus','0.5','--pids-limit','128','--network',NET,'--publish','8443:8443','--tmpfs','/data:rw,nosuid,noexec,size=16m','--tmpfs','/config:rw,nosuid,noexec,size=16m','--tmpfs','/tmp:rw,nosuid,noexec,size=16m']+mounts+[gateway],check=True,stdout=subprocess.DEVNULL)
for attempt in range(20):
 try:
  urllib.request.urlopen('https://test.elektro-24.ru:8443/api/health',timeout=5)
  raise AssertionError('Gateway did not require authentication')
 except urllib.error.HTTPError as e:
  assert e.code==401;break
 except urllib.error.URLError:
  if attempt==19:raise
  time.sleep(1)
assert frame()==before,'A pre-existing shop container changed'
assert subprocess.check_output(['crontab','-l'],text=True)==cron,'Cron changed'
result={'status':'ISOLATED_DEMO_INSTALLED','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'image':image,'sourceRevision':release.name,'url':'https://test.elektro-24.ru:8443/demo/catalogs','existingContainersUnchanged':True,'crontabUnchanged':True,'readonlyProof':json.loads(proof),'webContainer':WEB,'gatewayContainer':GATE,'databaseWrites':False}
(base/'installation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

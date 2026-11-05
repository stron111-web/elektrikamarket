#!/usr/bin/env python3
"""Cron-environment smoke: unchanged accepted source must not write PostgreSQL."""
import atexit,base64,datetime,json,os,pathlib,re,subprocess,urllib.request
os.umask(0o077)
base=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')
attempt=json.loads((base/'etim-live-attempt.json').read_text());assert attempt['status']=='SUCCEEDED'
results=pathlib.Path(attempt['results']);activation=json.loads((results/'activation.json').read_text());assert activation['status']=='DAILY_PUBLICATION_ENABLED'
verified=False
@atexit.register
def fail_closed():
 if not verified:
  file=base/'runtime/config.json';config=json.loads(file.read_text());config['publicationEnabled']=False
  pending=file.with_name(file.name+'.smoke-stopped')
  with open(pending,'x') as out:json.dump(config,out,indent=2);out.write('\n');out.flush();os.fsync(out.fileno())
  os.replace(pending,file)
  (results/'smoke-stopped.json').write_text(json.dumps({'status':'STOPPED_PUBLICATION_DISABLED','databaseRestoreAttempted':False})+'\n')
  print('STOPPED_PUBLICATION_DISABLED')
image=activation['image']
network=subprocess.check_output(['bash','-c','source "$1"; printf "%s" "$PRODAT_DATABASE_NETWORK"','-',str(base/'runtime.env')],text=True).strip()
program=r'''
const fs=require('fs'),assert=require('assert/strict'),postgres=require('postgres');
(async()=>{const pre=JSON.parse(fs.readFileSync('/results/preflight.json')),u=new URL(fs.readFileSync('/run/writer-url','utf8').trim());u.searchParams.delete('schema');const db=postgres(u.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:true,timezone:'UTC',application_name:'prodat-rollout-readonly-final'}});try{const r=await db.begin('isolation level repeatable read read only',async tx=>{const excluded=new Set(['product_features','import_runs','import_files','import_issues']);let business=0;for(const [table,value]of Object.entries(pre.baseline)){if(excluded.has(table))continue;assert(/^[a-z_]+$/.test(table));const actual=(await tx.unsafe(`SELECT count(*)::int rows,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) hash FROM public."${table}" t`))[0];assert.deepEqual(actual,value,table);business++;}const features=(await tx.unsafe('SELECT count(*)::int features,count(DISTINCT "productId")::int products FROM product_features'))[0];assert.deepEqual(features,{features:2083808,products:134836});const duplicates=(await tx.unsafe('SELECT count(*)::int n FROM (SELECT "productId","identityKey" FROM product_features GROUP BY 1,2 HAVING count(*)>1)x'))[0].n;assert.equal(duplicates,0);const active=(await tx.unsafe('SELECT id,"productCount" FROM assortment_snapshots WHERE active'))[0];assert.equal(String(active.id),'8');assert.equal(active.productCount,137359);const audit={};for(const table of ['import_runs','import_files','import_issues'])audit[table]=(await tx.unsafe(`SELECT count(*)::int rows,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) hash FROM ${table} t`))[0];return{status:'READONLY_VERIFIED',businessTablesUnchanged:business,features,duplicates,active,audit};});console.log(JSON.stringify(r));}finally{await db.end({timeout:5});}})().catch(()=>{console.error('READONLY_VERIFICATION_FAILED');process.exitCode=1;});
'''
def readonly(name):
 args=['docker','run','--rm','--read-only','--user','1001:1001','--network',network,'--memory','2g','--cpus','1.5','--entrypoint','node','--mount','type=bind,source='+str(results)+',target=/results,readonly','--mount','type=bind,source=/home/shopadmin/elektrikamarket-pricat/runtime/database_url,target=/run/writer-url,readonly',image,'-e',program]
 r=json.loads(subprocess.check_output(args,text=True));(results/name).write_text(json.dumps(r,indent=2)+'\n');return r
before=readonly('smoke-before.json')
# Run the actual existing runner with cron-like minimal environment, not another launcher.
env={'HOME':'/home/shopadmin','USER':'shopadmin','LOGNAME':'shopadmin','SHELL':'/bin/sh','PATH':'/usr/bin:/bin'}
with open(results/'cron-environment-publish.log','xb') as out:subprocess.run([str(base/'run.sh'),'publish'],env=env,check=True,stdout=out,stderr=out)
lines=[json.loads(line) for line in (results/'cron-environment-publish.log').read_text().splitlines() if line.strip()]
assert lines[-1]['status']=='UNCHANGED' and lines[-1]['createdProducts']==lines[-1]['updatedProducts']==lines[-1]['newSaleOffers']==0
state=json.loads((base/'state/source-state.json').read_text());assert state['lastCheck']['status']=='UNCHANGED_VERIFIED' and state['lastCheck']['downloadedFiles']==0
after=readonly('smoke-after.json');assert before==after,'Cron smoke changed database'
assert subprocess.check_output(['systemctl','is-active','cron'],text=True).strip()=='active'
cron=subprocess.check_output(['crontab','-l'],text=True)
assert sum('elektrikamarket-prodat/run.sh ' in line and not line.startswith('#') for line in cron.splitlines())==1
assert '0 23 * * * '+str(base)+'/run.sh publish >> '+str(base)+'/scheduler.log 2>&1' in cron
for p in [base/'state/needs-review.json',base/'state/source.lock',pathlib.Path('/home/shopadmin/elektrikamarket-pricat/state/ftp/needs-review.json'),pathlib.Path('/home/shopadmin/elektrikamarket-pricat/state/needs-review.json')]:assert not p.exists()
text=pathlib.Path('/home/shopadmin/elektrikamarket-storefront-secrets/owner-access.txt').read_text()
def field(pattern):
 m=re.search(r'(?im)^\s*(?:'+pattern+r')\s*[:=]\s*(.+)$',text);assert m
 return m.group(1).strip().strip(chr(96))
auth=base64.b64encode((field('username|user|login|логин')+':'+field('password|pass|пароль')).encode()).decode()
https=[]
for site in ['test','preview']:
 for route in ['/api/health','/catalog?q=82229','/product/svetilnik-amber-51-3-04-komtekh-ch917005']:
  req=urllib.request.Request('https://'+site+'.elektro-24.ru'+route,headers={'Authorization':'Basic '+auth})
  with urllib.request.urlopen(req,timeout=45) as response:
   body=response.read().decode();assert response.status==200
   if route.startswith('/catalog'):assert '82229' in body
   https.append({'site':site,'route':route,'status':response.status})
now=datetime.datetime.now(datetime.timezone.utc);nextRun=now.replace(hour=23,minute=0,second=0,microsecond=0)
if nextRun<=now:nextRun+=datetime.timedelta(days=1)
result={'status':'AUTOMATIC_PUBLICATION_VERIFIED','at':now.isoformat(),'publicationEnabled':True,'cron':'0 23 * * *','unchangedSourcePublication':lines[-1],'businessTablesUnchanged':after['businessTablesUnchanged'],'features':after['features'],'duplicates':after['duplicates'],'active':after['active'],'cronActive':True,'blockingMarkers':False,'https':https,'nextRunUTC':nextRun.isoformat(),'nextRunSamara':nextRun.astimezone(datetime.timezone(datetime.timedelta(hours=4))).isoformat(),'actualCronFiringObserved':False}
(results/'rollout-final.json').write_text(json.dumps(result,indent=2)+'\n');verified=True;print(json.dumps(result))

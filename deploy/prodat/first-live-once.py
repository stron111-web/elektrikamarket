#!/usr/bin/env python3
"""Owner-authorized one-shot launcher. No retries, no publication schedule."""
import datetime,fcntl,json,os,pathlib,re,shutil,subprocess,sys
os.umask(0o077)
base=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')
backup=base/'rehearsal-20261104T204257Z'
mode=sys.argv[1] if len(sys.argv)==2 else ''
assert mode in ['--prepare-only','--publish-once']
job=base/'first-live-attempt.json'
locks=[]
for file in [base/'first-live.lock',base/'check.lock',pathlib.Path('/home/shopadmin/elektrikamarket-pricat/update.lock')]:
 handle=open(file,'a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
assert not job.exists(), 'A first-live attempt already exists: never repeat blindly'
assert (backup/'backup-validation.json').exists(), 'Fresh verified backup is required'
config_file=base/'runtime/config.json';config=json.loads(config_file.read_text())
assert config['publicationEnabled'] is False and config['sourceDirectory']=='/allstock/TVER/'
writer=base/'runtime/database_url';assert not writer.exists()
def env_value(file,key):
 value=subprocess.check_output(['bash','-c','source "$1"; printf "%s" "${!2}"','-',str(file),key],text=True).strip()
 return value
image=env_value(base/'runtime.env','PRODAT_IMAGE');assert re.fullmatch('sha256:[a-f0-9]{64}',image)
network=env_value(pathlib.Path('/home/shopadmin/elektrikamarket-pricat/runtime.env'),'PRICAT_NETWORK');assert re.fullmatch('[A-Za-z0-9_.-]+',network)
def mount(src,dst,readonly=True):return ['--mount','type=bind,source='+str(src)+',target='+dst+(',readonly' if readonly else '')]
def docker(name):return ['docker','run','--rm','--init','--name',name,'--pull','never','--user','1001:1001','--network',network,'--memory','2g','--cpus','1.5','--pids-limit','128','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,noexec,size=1g,uid=1001,gid=1001']
def run(command,log):
 with open(base/log,'ab') as out:subprocess.run(command,stdout=out,stderr=out,check=True)
def json_file(file,value):
 tmp=file.with_name(file.name+'.pending');
 with open(tmp,'x') as out:json.dump(value,out,indent=2);out.write('\n');out.flush();os.fsync(out.fileno())
 os.replace(tmp,file)
# Same checked runtime and mounts as run.sh, under BOTH host locks for the
# complete preflight/publication chain. Nothing reimplements product logic.
common=mount(config_file,'/run/config.json')+mount(base/'runtime/ftp-credentials.json','/run/ftp/credentials.json')+mount(base/'state','/prodat-state',False)
source=pathlib.Path((base/'runtime/bootstrap-path').read_text().strip());assert str(source).startswith(str(base/'research')+'/')
common+=mount(source,'/bootstrap')
run(docker('elektrikamarket-prodat-first-check')+common+[image,'--config','/run/config.json','--mode','check'],'first-live-source-check.log')
ready=docker('elektrikamarket-prodat-first-readiness')+['--entrypoint','node']+mount(base/'build-preparation/deploy/prodat/readiness.cjs','/work/deploy/prodat/readiness.cjs')+mount(config_file,'/run/prodat-config.json')+mount(base/'state','/prodat-state')+mount(backup,'/backup')+mount(base/'rehearsal-20261104T185439Z/source-fingerprint.json','/baseline-fingerprint.json')+mount(base/'runtime-proof.json','/runtime-proof.json')+mount('/home/shopadmin/elektrikamarket-pricat/state','/pricat-state')+mount('/home/shopadmin/elektrikamarket-storefront-secrets/database_url','/run/readonly-database-url')+[image,'/work/deploy/prodat/readiness.cjs']
with open(base/'first-live-readiness.json','wb') as out:subprocess.run(ready,stdout=out,check=True)
r=json.loads((base/'first-live-readiness.json').read_text());assert r['status']=='READY_FOR_OWNER_REVIEW'
assert r['live']['snapshotId']=='6' and r['live']['saleOffers']==113285 and r['live']['products']==148872
assert r['live']['pairHashes']=={'PRICAT1':'72749137813f564ef6fc4c63d71692c8e93f5c90439eafe24ddadb99add26e75','PRICAT2':'c62f5ae8b6b04368fc2ad92e67f0b7e97026569393355916099dd8916bcfbea4'}
assert r['expectedCreatedProducts']==31794 and r['expectedUpdatedProducts']==30146 and r['priorRehearsalNewSaleOffers']==24009
run(docker('elektrikamarket-prodat-first-writer-check')+['--entrypoint','node']+mount(base/'build-preparation/deploy/prodat/writer-preflight.cjs','/work/deploy/prodat/writer-preflight.cjs')+mount('/home/shopadmin/elektrikamarket-pricat/runtime/database_url','/run/writer-url')+[image,'/work/deploy/prodat/writer-preflight.cjs'],'first-live-writer-preflight.log')
if mode=='--prepare-only':print(json.dumps({'status':'FIRST_LIVE_PREPARED','liveWrites':False,'backup':r['backup'],'hostLocksVerified':True}));sys.exit(0)
# Persist authorization consumption BEFORE the sole publish invocation.
json_file(job,{'status':'AUTHORIZED_ONCE','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'backup':r['backup'],'expectedCreated':31794,'expectedUpdated':30146,'expectedNewSaleOffers':24009})
original=config.copy()
try:
 with open('/home/shopadmin/elektrikamarket-pricat/runtime/database_url','rb') as src,open(writer,'xb') as dst:shutil.copyfileobj(src,dst);dst.flush();os.fsync(dst.fileno())
 os.chmod(writer,0o600)
 config['publicationEnabled']=True;json_file(config_file,config)
 command=docker('elektrikamarket-prodat-publish')+common+mount(writer,'/run/config/database_url')+mount('/home/shopadmin/elektrikamarket-pricat/state','/pricat-state',False)+[image,'--config','/run/config.json','--mode','publish']
 run(command,'first-live-publication.ndjson')
 result=json.loads((base/'state/last-publication.json').read_text())
 assert result['status']=='SUCCEEDED' and result['createdProducts']==31794 and result['updatedProducts']==30146 and result['newSaleOffers']==24009 and result['afterSaleOffers']==137294
 assert result['existingSaleOffersChanged']==0 and result['protectedDataUnchanged'] is True and result['pricat']['zeroedStocks']==0 and result['pricat']['zeroedPositiveStocks']==0
 json_file(job,{'status':'SUCCEEDED','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'prodatRunId':result['prodat']['runId'],'pricatRunId':result['pricat']['runId'],'snapshotId':result['afterSnapshotId'],'createdProducts':31794,'updatedProducts':30146,'newSaleOffers':24009,'saleOffers':137294})
 print(json.dumps(json.loads(job.read_text())))
except Exception as error:
 json_file(job,{'status':'STOPPED_REVIEW_REQUIRED','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'errorType':type(error).__name__,'retryAllowed':False})
 print(json.dumps({'status':'STOPPED_REVIEW_REQUIRED','errorType':type(error).__name__}),file=sys.stderr);raise SystemExit(1)
finally:
 # Regardless of result, keep DAILY CHECK ONLY and close one-time write access.
 json_file(config_file,original)
 if writer.exists():writer.unlink()

#!/usr/bin/env python3
"""Owner-approved ETIM-only once; no cron or permanent runtime changes here."""
import datetime,fcntl,hashlib,json,os,pathlib,re,shutil,subprocess,sys
os.umask(0o077)
base=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')
operator=base/'etim-rollout-51187be'
image='sha256:d4672eaace5ccdb70da1d9c27c66407be11c8bf6f145c7f2ac49d6685fc31d43'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
job=base/'etim-live-attempt.json'
def save(file,value):
 tmp=file.with_name(file.name+'.pending')
 with open(tmp,'x') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.replace(tmp,file)
def event(status,**values):print(json.dumps({'status':status,**values}),flush=True)
def env_value(file,key):return subprocess.check_output(['bash','-c','source "$1"; printf "%s" "${!2}"','-',str(file),key],text=True).strip()
def run(args,log):
 with open(log,'ab') as f:subprocess.run(args,check=True,stdout=f,stderr=f)
def mount(src,dst,ro=True):return ['--mount','type=bind,source='+str(src)+',target='+dst+(',readonly' if ro else '')]
locks=[];started=False;markerFiles=[];results=None
try:
 for file in [base/'etim-live.lock',base/'check.lock',pathlib.Path('/home/shopadmin/elektrikamarket-pricat/update.lock')]:
  h=open(file,'a');fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(h)
 assert not job.exists(),'A live ETIM attempt exists; never repeat blindly'
 assert json.loads((base/'runtime/config.json').read_text())['publicationEnabled'] is False
 assert not (base/'runtime/database_url').exists()
 for file in [base/'state/needs-review.json',base/'state/source.lock',pathlib.Path('/home/shopadmin/elektrikamarket-pricat/state/ftp/needs-review.json'),pathlib.Path('/home/shopadmin/elektrikamarket-pricat/state/needs-review.json')]:assert not file.exists(),'Blocking marker exists'
 assert shutil.disk_usage(base).free>15*1024**3
 network=env_value(pathlib.Path('/home/shopadmin/elektrikamarket-pricat/runtime.env'),'PRICAT_NETWORK');assert re.fullmatch('[A-Za-z0-9_.-]+',network)
 results=base/('etim-live-'+stamp);results.mkdir(mode=0o700)
 rollback=results/'rollback';rollback.mkdir(mode=0o700)
 for src,dest in [(base/'runtime/config.json','config.json'),(base/'runtime.env','runtime.env'),(base/'run.sh','run.sh'),(base/'install-check-schedule.py','install-check-schedule.py'),(base/'state/last-publication.json','last-publication.json'),(base/'state/source-state.json','source-state.json')]:shutil.copy2(src,rollback/dest);os.chmod(rollback/dest,0o600)
 (rollback/'crontab.txt').write_text(subprocess.check_output(['crontab','-l'],text=True))
 # Source check is the existing checker under both existing host locks.
 old=env_value(base/'runtime.env','PRODAT_IMAGE');assert re.fullmatch('sha256:[a-f0-9]{64}',old)
 sourcecmd=['docker','run','--rm','--read-only','--user','1001:1001','--network','bridge']+mount(base/'runtime/config.json','/run/config.json')+mount(base/'runtime/ftp-credentials.json','/run/ftp/credentials.json')+mount(base/'state','/prodat-state',False)
 bootstrap=pathlib.Path((base/'runtime/bootstrap-path').read_text().strip());assert str(bootstrap).startswith(str(base/'research')+'/')
 run(sourcecmd+mount(bootstrap,'/bootstrap')+[old,'--config','/run/config.json','--mode','check'],results/'source-check.log')
 state=json.loads((base/'state/source-state.json').read_text());assert state['lastCheck']['status']=='UNCHANGED_VERIFIED' and state['lastCheck']['downloadedFiles']==0
 proof=json.loads((base/'etim-preparation-20261105/results/prepared-runtime.json').read_text());assert proof['image']==image
 program="const fs=require('fs'),c=require('crypto');const p=JSON.parse(fs.readFileSync('/proof','utf8'));for(const [f,h]of Object.entries(p.hashes))if(c.createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==h)throw Error('RUNTIME_HASH_MISMATCH');console.log('RUNTIME_51187BE_VERIFIED');"
 run(['docker','run','--rm','--read-only','--network','none','--entrypoint','node']+mount(base/'etim-preparation-20261105/results/prepared-runtime.json','/proof')+[image,'-e',program],results/'runtime-verification.log')
 event('SOURCE_AND_RUNTIME_VERIFIED',results=str(results))
 # Hold the same PRODAT/PRICAT locks across fresh backup, restore and backfill.
 run(['python3',str(operator/'backup-rehearse.py')],results/'backup.log')
 backup=pathlib.Path((base/'rehearsal-latest-path').read_text().strip());assert backup.parent==base
 backupProof=json.loads((backup/'backup-validation.json').read_text());assert backupProof['status']=='RESTORE_VERIFIED'
 assert hashlib.sha256((backup/'database.dump').read_bytes()).hexdigest()==backupProof['sha256']
 event('FRESH_BACKUP_RESTORED',archive=backupProof['archive'],tables=backupProof['tablesVerified'])
 args=['docker','run','--rm','--init','--read-only','--user','1001:1001','--network',network,'--cpus','1.5','--memory','2g','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint','node']
 args+=mount(operator/'etim-live-audit.cjs','/work/deploy/prodat/etim-live-audit.cjs')+mount('/home/shopadmin/elektrikamarket-pricat/runtime/database_url','/run/writer-url')+mount('/home/shopadmin/elektrikamarket-pricat/state','/pricat-state')+mount(base/'state','/prodat-state')+mount(backup,'/backup')+mount(base/'rehearsal-20261105T111235Z','/trial')+mount(results,'/results',False)+[image,'/work/deploy/prodat/etim-live-audit.cjs']
 run(args+['preflight'],results/'preflight.log');assert json.loads((results/'preflight.json').read_text())['status']=='ETIM_LIVE_PREFLIGHT_VERIFIED'
 event('LIVE_PREFLIGHT_VERIFIED')
 save(job,{'status':'AUTHORIZED_ONCE','commit':'51187bee892b3c841484a13504b461221c8ae208','results':str(results),'backup':backupProof,'retryAllowed':False});started=True
 for file in [base/'state/needs-review.json',pathlib.Path('/home/shopadmin/elektrikamarket-pricat/state/ftp/needs-review.json')]:
  assert not file.exists();save(file,{'phase':'ETIM_ONLY_PENDING','operation':str(results),'at':datetime.datetime.now(datetime.timezone.utc).isoformat()});markerFiles.append(file)
 event('ETIM_ONLY_STARTED')
 run(args+['write'],results/'publication.log')
 r=json.loads((results/'live-etim-result.json').read_text());assert r['status']=='LIVE_ETIM_VERIFIED'
 for file in markerFiles:assert json.loads(file.read_text())['operation']==str(results)
 for file in markerFiles:file.unlink()
 save(job,{'status':'SUCCEEDED','at':r['at'],'results':str(results),'runId':r['runId'],'features':r['features'],'duplicates':r['duplicates'],'pair':r['pair'],'backup':backupProof,'retryAllowed':False})
 subprocess.run(['docker','stop',backupProof['fixtureContainer']],check=True,stdout=subprocess.DEVNULL)
 event('LIVE_ETIM_VERIFIED',runId=r['runId'],features=r['features'],snapshotId=r['pair']['id'],results=str(results))
except Exception as e:
 if started:save(job,{'status':'STOPPED_REVIEW_REQUIRED','results':str(results),'errorType':type(e).__name__,'retryAllowed':False})
 event('STOPPED_BEFORE_NEXT_STAGE',errorType=type(e).__name__,started=started,results=str(results) if results else None)
 raise SystemExit(1)

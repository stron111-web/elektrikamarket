#!/usr/bin/env python3
"""Enable the existing daily runner only after the approved live ETIM report."""
import atexit,datetime,fcntl,importlib.util,json,os,pathlib,re,shutil,subprocess
os.umask(0o077)
base=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')
operator=base/'etim-rollout-51187be'
image='sha256:d4672eaace5ccdb70da1d9c27c66407be11c8bf6f145c7f2ac49d6685fc31d43'
def save(file,data):
 temp=file.with_name(file.name+'.pending')
 with open(temp,'x') as out:out.write(data);out.flush();os.fsync(out.fileno())
 os.replace(temp,file)
def json_save(file,data):save(file,json.dumps(data,indent=2)+'\n')
activation_started=False
activation_verified=False
@atexit.register
def fail_closed():
 if activation_started and not activation_verified:
  config['publicationEnabled']=False;json_save(configfile,config)
  json_save(results/'activation.json',{'status':'STOPPED_PUBLICATION_DISABLED','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'databaseRestoreAttempted':False})
  print('STOPPED_PUBLICATION_DISABLED')
def env_value(file,key):return subprocess.check_output(['bash','-c','source "$1"; printf "%s" "${!2}"','-',str(file),key],text=True).strip()
locks=[]
for file in [base/'check.lock',pathlib.Path('/home/shopadmin/elektrikamarket-pricat/update.lock')]:
 handle=open(file,'a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
attempt=json.loads((base/'etim-live-attempt.json').read_text());assert attempt['status']=='SUCCEEDED'
results=pathlib.Path(attempt['results']);assert results.parent==base
report=json.loads((results/'live-etim-result.json').read_text())
assert report['status']=='LIVE_ETIM_VERIFIED' and report['features']['features']==2083808 and report['duplicates']==0
assert len(report['unchangedTables'])==15 and all(v['unchanged'] for v in report['unchangedTables'].values())
backup=attempt['backup'];assert backup['status']=='RESTORE_VERIFIED' and backup['tablesVerified']==19
assert (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(backup['at'])).total_seconds()<7200
assert shutil.disk_usage(base).free>10*1024**3
for file in [base/'state/needs-review.json',base/'state/source.lock',pathlib.Path('/home/shopadmin/elektrikamarket-pricat/state/ftp/needs-review.json'),pathlib.Path('/home/shopadmin/elektrikamarket-pricat/state/needs-review.json')]:assert not file.exists()
configfile=base/'runtime/config.json';config=json.loads(configfile.read_text())
assert config['publicationEnabled'] is False and config['sourceDirectory']=='/allstock/TVER/'
assert not (base/'runtime/database_url').exists()
assert not (results/'activation.json').exists(),'Activation already attempted; review instead of repeating'
assert subprocess.check_output(['docker','image','inspect',image,'--format','{{.Id}}'],text=True).strip()==image
old=env_value(base/'runtime.env','PRODAT_IMAGE');assert re.fullmatch('sha256:[a-f0-9]{64}',old)
network=env_value(pathlib.Path('/home/shopadmin/elektrikamarket-pricat/runtime.env'),'PRICAT_NETWORK');assert re.fullmatch('[A-Za-z0-9_.-]+',network)
spec=importlib.util.spec_from_file_location('schedule',operator/'install-check-schedule.py');schedule=importlib.util.module_from_spec(spec);spec.loader.exec_module(schedule)
oldcron=subprocess.check_output(['crontab','-l'],text=True)
assert oldcron==(results/'rollback/crontab.txt').read_text()
schedule.replace_schedule(oldcron,'publish') # Validate without installing.
assert subprocess.check_output(['date','+%z'],text=True).strip()=='+0000'
subprocess.run(['python3',str(operator/'test_schedule.py')],check=True)
tag='elektrikamarket-prodat-update:rollback-pre-etim-20261105'
existing=subprocess.run(['docker','image','inspect',tag,'--format','{{.Id}}'],text=True,capture_output=True)
assert existing.returncode!=0 or existing.stdout.strip()==old
subprocess.run(['docker','tag',old,tag],check=True)
json_save(results/'activation.json',{'status':'ACTIVATING','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'image':image,'oldImage':old,'rollbackImageTag':tag,'rollbackDirectory':str(results/'rollback')})
activation_started=True
with open('/home/shopadmin/elektrikamarket-pricat/runtime/database_url','rb') as src,open(base/'runtime/database_url','xb') as dst:shutil.copyfileobj(src,dst);dst.flush();os.fsync(dst.fileno())
os.chmod(base/'runtime/database_url',0o600)
save(base/'runtime.env','PRODAT_IMAGE='+image+'\nPRODAT_DATABASE_NETWORK='+network+'\n')
config['publicationEnabled']=True;json_save(configfile,config)
shutil.copyfile(operator/'install-check-schedule.py',base/'install-check-schedule.py');os.chmod(base/'install-check-schedule.py',0o700)
with open(results/'schedule-install.log','xb') as out:subprocess.run(['python3',str(base/'install-check-schedule.py'),'--publish'],check=True,stdout=out,stderr=out)
assert subprocess.check_output(['systemctl','is-active','cron'],text=True).strip()=='active'
assert schedule.pricat_lines(subprocess.check_output(['crontab','-l'],text=True))==schedule.pricat_lines(oldcron)
json_save(results/'activation.json',{'status':'DAILY_PUBLICATION_ENABLED','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'image':image,'oldImage':old,'rollbackImageTag':tag,'rollbackDirectory':str(results/'rollback'),'serverCron':'0 23 * * *','ownerSchedule':'03:00 Europe/Samara daily','pricatCronUnchanged':True})
activation_verified=True
print(json.dumps({'status':'DAILY_PUBLICATION_ENABLED','serverCron':'0 23 * * *','ownerSchedule':'03:00 Europe/Samara daily','image':image,'results':str(results)}))

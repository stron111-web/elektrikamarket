#!/usr/bin/env python3
"""Replace the one PRODAT cron entry; explicit --publish after approval."""
import datetime,json,os,pathlib,re,stat,subprocess,sys
BASE=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')
LEGACY='elektrikamarket PRODAT source check only'
CURRENT='elektrikamarket PRODAT daily update'
def pricat_lines(text):
 return [line for line in text.splitlines() if 'elektrikamarket-pricat/' in line and not line.lstrip().startswith('#')]
def replace_schedule(old,mode):
 assert mode in ('check','publish')
 outside=old;found=0
 for label in (LEGACY,CURRENT):
  start='# BEGIN '+label;end='# END '+label
  assert outside.count(start)==outside.count(end) and outside.count(start)<=1,'Ambiguous schedule block'
  if start in outside:
   found+=1;a=outside.index(start);b=outside.index(end,a)+len(end)
   if b<len(outside) and outside[b]=='\n':b+=1
   jobs=[line for line in outside[a:b].splitlines() if line.strip() and not line.lstrip().startswith('#')]
   assert len(jobs)==1 and re.fullmatch(r'\d+ \d+ \* \* \* /home/shopadmin/elektrikamarket-prodat/run\.sh (check|publish) >> /home/shopadmin/elektrikamarket-prodat/scheduler\.log 2>&1',jobs[0]),'Unexpected managed cron content'
   outside=outside[:a]+outside[b:]
 assert found==1 or (found==0 and mode=='check'),'Exactly one existing PRODAT schedule is required for publish'
 assert not any('elektrikamarket-prodat' in line and line.strip() and not line.lstrip().startswith('#') for line in outside.splitlines()),'Unexpected PRODAT cron requires review'
 job='0 23 * * * '+str(BASE)+'/run.sh '+mode+' >> '+str(BASE)+'/scheduler.log 2>&1'
 new=outside+('' if outside.endswith('\n') else '\n')+'# BEGIN '+CURRENT+'\n'+job+'\n# END '+CURRENT+'\n'
 assert pricat_lines(old)==pricat_lines(new) and len(pricat_lines(old))==1,'PRICAT schedule must remain identical'
 return new
def main():
 os.umask(0o077)
 assert sys.argv[1:] in ([],['--publish']),'Only --publish or default check is supported'
 mode='publish' if sys.argv[1:] else 'check'
 config=json.loads((BASE/'runtime/config.json').read_text())
 assert config.get('sourceDirectory')=='/allstock/TVER/','Only Tver is approved'
 assert config.get('publicationEnabled') is (mode=='publish'),'Configuration and requested mode must agree'
 secret=BASE/'runtime/database_url'
 if mode=='publish':
  assert secret.is_file() and not secret.is_symlink() and stat.S_IMODE(secret.stat().st_mode)==0o600,'Writer secret must be private 0600'
  assert not any(p.exists() for p in (BASE/'state/needs-review.json',BASE/'state/source.lock',pathlib.Path('/home/shopadmin/elektrikamarket-pricat/state/ftp/needs-review.json'))),'Blocking marker exists'
  runtime=(BASE/'runtime.env').read_text()
  assert re.search(r'^PRODAT_IMAGE=sha256:[a-f0-9]{64}$',runtime,re.M)
  assert re.search(r'^PRODAT_DATABASE_NETWORK=[A-Za-z0-9_.-]+$',runtime,re.M)
 else:assert not secret.exists(),'Check preparation must not provision writer access'
 assert subprocess.check_output(['date','+%z'],text=True).strip()=='+0000','Schedule requires server UTC'
 log=BASE/'scheduler.log';assert not log.is_symlink()
 log.touch(mode=0o600,exist_ok=True);os.chmod(log,0o600)
 result=subprocess.run(['crontab','-l'],capture_output=True,text=True)
 assert result.returncode==0,'Existing crontab must be readable'
 old=result.stdout;new=replace_schedule(old,mode)
 if old!=new:
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
  backup=BASE/('crontab-before-'+mode+'-'+stamp+'.txt');backup.write_text(old);os.chmod(backup,0o600)
  subprocess.run(['crontab','-'],input=new,text=True,check=True)
 assert subprocess.check_output(['crontab','-l'],text=True)==new
 print(json.dumps({'status':'DAILY_'+mode.upper()+'_READY','changed':old!=new,'serverCron':'0 23 * * *','ownerSchedule':'03:00 Europe/Samara daily','publicationScheduled':mode=='publish','publicationEnabled':config['publicationEnabled'],'pricatScheduleUnchanged':True}))
if __name__=='__main__':main()

#!/usr/bin/env python3
"""Install only the daily PRODAT source check; preserve all unrelated cron jobs."""
import datetime,json,os,pathlib,subprocess,sys
os.umask(0o077)
base=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')
config=json.loads((base/'runtime/config.json').read_text())
assert config.get('publicationEnabled') is False, 'Publication must stay disabled during preparation'
assert config.get('sourceDirectory')=='/allstock/TVER/', 'Only Tver is approved'
assert not (base/'runtime/database_url').exists(), 'Do not provision writer access during preparation'
assert subprocess.check_output(['date','+%z'],text=True).strip()=='+0000', 'Schedule requires server UTC'
log=base/'scheduler.log'
assert not log.is_symlink(), 'Scheduler log must be a regular private file'
log.touch(mode=0o600,exist_ok=True);os.chmod(log,0o600)
start='# BEGIN elektrikamarket PRODAT source check only'
end='# END elektrikamarket PRODAT source check only'
job='0 23 * * * /home/shopadmin/elektrikamarket-prodat/run.sh check >> /home/shopadmin/elektrikamarket-prodat/scheduler.log 2>&1'
result=subprocess.run(['crontab','-l'],capture_output=True,text=True)
assert result.returncode==0, 'Existing PRICAT crontab is required; never replace a missing/unreadable crontab'
old=result.stdout
assert old.count(start)==old.count(end) and old.count(start)<=1, 'Ambiguous schedule block'
if start in old:
 a=old.index(start);b=old.index(end,a)+len(end)
 if b<len(old) and old[b]=='\n':b+=1
 outside=old[:a]+old[b:]
else:outside=old
assert not any('elektrikamarket-prodat' in line and line.strip() and not line.lstrip().startswith('#') for line in outside.splitlines()), 'Unexpected PRODAT cron requires review'
new=outside+('' if outside.endswith('\n') else '\n')+start+'\n'+job+'\n'+end+'\n'
pricat=lambda s:[line for line in s.splitlines() if 'elektrikamarket-pricat/' in line and not line.lstrip().startswith('#')]
assert pricat(old)==pricat(new) and len(pricat(old))==1, 'PRICAT schedule must remain identical'
if old!=new:
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 backup=base/('crontab-before-check-'+stamp+'.txt');backup.write_text(old);os.chmod(backup,0o600)
 subprocess.run(['crontab','-'],input=new,text=True,check=True)
assert subprocess.check_output(['crontab','-l'],text=True)==new
print(json.dumps({'status':'DAILY_CHECK_READY','changed':old!=new,'serverSchedule':'23:00 UTC daily','ownerSchedule':'03:00 Europe/Samara daily','publicationScheduled':False,'publicationEnabled':False,'pricatScheduleUnchanged':True}))

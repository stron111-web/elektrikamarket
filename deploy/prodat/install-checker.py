#!/usr/bin/env python3
"""Install source checking only; never install a database credential or publication cron."""
import json,pathlib,os,subprocess,shutil,datetime
os.umask(0o077)
base=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')
src=base/'build-preparation'
runtime=base/'runtime';runtime.mkdir(mode=0o700,exist_ok=True)
state=base/'state';state.mkdir(mode=0o700,exist_ok=True)
assert not (state/'needs-review.json').exists()
assert not (runtime/'database_url').exists(), 'Unexpected PRODAT writer secret: inspect before proceeding'
rollback=base/('checker-before-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));rollback.mkdir(mode=0o700)
for f in [base/'run.sh',base/'runtime.env',runtime/'config.json']:
 if f.exists(): shutil.copy2(f,rollback/f.name)
bootstrap=pathlib.Path((base/'research/tver-latest-path').read_text().strip())
assert str(bootstrap).startswith(str(base/'research')+'/')
proof=json.loads((bootstrap/'preflight-tver-full.json').read_text())
receipt=json.loads((bootstrap/'comparison.json').read_text())['tverFiles']
config=json.loads((src/'deploy/prodat/config.example.json').read_text(encoding='utf-8-sig'))
config.update(bootstrapDirectory='/bootstrap',bootstrapVerificationFile='/bootstrap/preflight-tver-full.json',bootstrapApproved=[{'name':p['name'],'sha256':p['sha256'],**next(r['remote'] for r in receipt if r['name']==p['name'])} for p in proof['parts']])
config['initialExpectedChanges']={'sourceHashes':[p['sha256'] for p in proof['parts']],'beforeProducts':148872,'createdProducts':31794,'updatedProducts':30146}
assert config['publicationEnabled'] is False
(runtime/'config.json').write_text(json.dumps(config,indent=2)+'\n');os.chmod(runtime/'config.json',0o600)
(runtime/'bootstrap-path').write_text(str(bootstrap)+'\n');os.chmod(runtime/'bootstrap-path',0o600)
image=subprocess.check_output(['docker','image','inspect','elektrikamarket-prodat-update:prepared-20261104','--format','{{.Id}}'],text=True).strip()
assert image.startswith('sha256:') and len(image)==71
(base/'runtime.env').write_text('PRODAT_IMAGE='+image+'\n');os.chmod(base/'runtime.env',0o600)
(base/'run.sh').write_text((src/'deploy/prodat/run.sh').read_text(encoding='utf-8-sig').replace('\r\n','\n'));os.chmod(base/'run.sh',0o700)
print(json.dumps({'status':'CHECKER_INSTALLED','publicationEnabled':False,'writerCredentialInstalled':False,'image':image,'rollbackDirectory':str(rollback)}))

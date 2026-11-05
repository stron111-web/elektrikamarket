#!/usr/bin/env python3
"""Test-only launcher; refuses any PostgreSQL container with networking or ports."""
import pathlib,json,subprocess,sys,os
os.umask(0o077)
root=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')
prepared=root/'etim-preparation-20261105'
latest=pathlib.Path((root/'rehearsal-latest-path').read_text().strip())
assert latest.parent==root and latest.name.startswith('rehearsal-')
backup=json.loads((latest/'backup-validation.json').read_text())
assert backup['status']=='RESTORE_VERIFIED' and backup['liveWrites'] is False
fixture=backup['fixtureContainer'];assert fixture.startswith('elektrikamarket-prodat-rehearsal-')
info=json.loads(subprocess.check_output(['docker','inspect',fixture]))[0]
assert info['State']['Running'] and info['HostConfig']['NetworkMode']=='none' and not info['NetworkSettings'].get('Ports')
env=dict(line.split('=',1) for line in (root/'runtime.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
image=env['PRODAT_IMAGE'].strip("'\"");assert image.startswith('sha256:')
mode=sys.argv[1];assert mode in ['tests','full']
results=prepared/'results';results.mkdir(mode=0o700,exist_ok=True)
args=['docker','run','--rm','--read-only','--user','1001:1001','--network','container:'+fixture,'--cpus','1.5','--memory','2g','--tmpfs','/tmp:rw,nosuid,size=2g,uid=1001,gid=1001,mode=1777','--entrypoint','node']
for source,target,readonly in [(prepared/'scripts/import','/work/scripts/import',True),(prepared/'scripts/prodat-update','/work/scripts/prodat-update',True),(prepared/'scripts/storefront','/work/scripts/storefront',True),(prepared/'prisma/migrations','/work/prisma/migrations',True),(prepared/'etim-rehearse.cjs','/work/deploy/prodat/etim-rehearse.cjs',True),(root/'state','/prodat-state',True),(results,'/results',False),(root/'prodat-legacy-fixtures','/legacy',True)]:
 assert source.exists(),str(source)
 args+=['--mount','type=bind,source='+str(source)+',target='+target+(',readonly' if readonly else '')]
fixture_url='postgresql://fixture_admin@127.0.0.1/prodat_rehearsal'
for key in ['PRODAT_TEST_ADMIN_URL','PRICAT_TEST_ADMIN_URL','ASSORTMENT_TEST_ADMIN_URL','PRODAT_REHEARSAL_DATABASE_URL']:args+=['-e',key+'='+fixture_url]
args+=['-e','PRICAT_TEST_ISOLATED=1','-e','PRODAT_LEGACY_FIXTURES=/legacy',image]
if mode=='full':args+=['/work/deploy/prodat/etim-rehearse.cjs']
else:args+=['--test','--test-concurrency=1']+['/work/'+str(p.relative_to(prepared)) for folder in ['scripts/import','scripts/prodat-update','scripts/storefront'] for p in sorted((prepared/folder).glob('*.test.cjs'))]
with open(results/(mode+'.log'),'wb') as log:
 p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT)
print(json.dumps({'mode':mode,'exitCode':p.returncode,'log':str(results/(mode+'.log'))}))
raise SystemExit(p.returncode)

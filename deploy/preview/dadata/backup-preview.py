#!/usr/bin/python3 -I
"""Owner-only backup before the security image update. Does not restart services."""
import datetime,hashlib,json,os
from pathlib import Path
import runpy,sys

SOURCE=Path(__file__).resolve().parent

def main():
    if os.geteuid()!=0 or sys.argv[1:]:raise ValueError('root_without_arguments_required')
    os.umask(0o077)
    manifest=json.loads((SOURCE/'manifest.json').read_text())
    if set(manifest)!= {'manager.py','bootstrap.py','load-dadata-secret.cjs','policy.json','backup-preview.py'}:raise ValueError('manifest_mismatch')
    for name,expected in manifest.items():
        if hashlib.sha256((SOURCE/name).read_bytes()).hexdigest()!=expected:raise ValueError('package_checksum_mismatch')
    n=runpy.run_path(str(SOURCE/'manager.py'),run_name='dadata_backup')
    with (n['STATE']/'deploy.lock').open('a') as lock:
        n['fcntl'].flock(lock,n['fcntl'].LOCK_EX|n['fcntl'].LOCK_NB)
        h=n['helper']();current=h.saved()['current'];h.prepare(current,pull=False)
        c=json.loads(h.run(['/usr/bin/docker','inspect','--format','{{json .State.Running}}','elektrikamarket-preview-preview-1']))
        if c is not True:raise ValueError('preview_not_running')
        data=n['DATA'];data.mkdir(mode=0o700,exist_ok=True);n['trusted'](data,True)
        folder=data/('before-security-image-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));folder.mkdir(mode=0o700)
        for file in [n['CONFIG']/'compose.yaml',n['STATE']/'images.json',n['CONFIG']/'load-cdek-secret.cjs',n['CONFIG']/'load-shop-secret.cjs']:
            n['trusted'](file);n['atomic'](folder/file.name,file.read_bytes())
        n['atomic'](folder/'baseline.json',{'image':current,'otherContainers':n['frame']()})
        print(json.dumps({'backup':str(folder),'image':current,'servicesChanged':False,'credentialsCopied':False}))

if __name__=='__main__':
    try:main()
    except (Exception,KeyboardInterrupt) as error:
        safe=str(error) if type(error) is ValueError and str(error).replace('_','').isalnum() else type(error).__name__
        print(json.dumps({'backedUp':False,'reason':safe}),file=sys.stderr);sys.exit(1)

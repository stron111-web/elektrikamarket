#!/usr/bin/python3 -I
"""Owner installs public helper/logging policy only. Never reads or asks for DaData keys."""
import datetime,hashlib,json,os
from pathlib import Path
import runpy,stat,subprocess,sys

SOURCE=Path(__file__).resolve().parent
DEST=Path('/usr/local/libexec/elektrikamarket-preview-dadata')
ENTRY=Path('/usr/local/sbin/elektrikamarket-preview-dadata')
LOGGING=Path('/etc/sudoers.d/elektrikamarket-preview-dadata-logging')

def write(path,data,mode):
    with path.open('wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    os.chown(path,0,0);os.chmod(path,mode)

def main():
    if os.geteuid()!=0 or sys.argv[1:]:raise ValueError('root_without_arguments_required')
    os.umask(0o077)
    manifest=json.loads((SOURCE/'manifest.json').read_text())
    if set(manifest)!= {'manager.py','bootstrap.py','load-dadata-secret.cjs','policy.json'}:raise ValueError('manifest_mismatch')
    for name,expected in manifest.items():
        if hashlib.sha256((SOURCE/name).read_bytes()).hexdigest()!=expected:raise ValueError('package_checksum_mismatch')
    if DEST.exists() or ENTRY.exists() or LOGGING.exists():raise ValueError('helper_already_installed_owner_review_required')
    namespace=runpy.run_path(str(SOURCE/'manager.py'),run_name='dadata_bootstrap')
    with (namespace['STATE']/'deploy.lock').open('a') as lock:
        namespace['fcntl'].flock(lock,namespace['fcntl'].LOCK_EX|namespace['fcntl'].LOCK_NB)
        h=namespace['helper']();current=namespace['safe_image'](h)
        # Refuse to install against the old browser-secret-exporting image.
        protected=namespace['protected']();containers=namespace['frame']()
        cron=namespace['run'](['/usr/bin/crontab','-u','shopadmin','-l'])
        data=namespace['DATA'];data.mkdir(mode=0o700,exist_ok=True);namespace['trusted'](data,True)
        before=data/('helper-installation-backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));before.mkdir(mode=0o700)
        namespace['atomic'](before/'compose.yaml',(namespace['CONFIG']/'compose.yaml').read_bytes())
        namespace['atomic'](before/'baseline.json',{'protected':protected,'containers':containers})
        wrapper=b'#!/bin/sh\nexec /usr/bin/python3 -I /usr/local/libexec/elektrikamarket-preview-dadata/manager.py "$@"\n'
        # No new sudo permission or NOPASSWD grant. Only suppress credential input logging.
        policy=b'Defaults!/usr/local/sbin/elektrikamarket-preview-dadata !log_input, !log_output\n'
        candidate=before/'sudoers-logging';write(candidate,policy,0o440)
        result=subprocess.run(['/usr/sbin/visudo','-cf',str(candidate)],capture_output=True)
        if result.returncode:raise ValueError('logging_policy_invalid')
        try:
            DEST.mkdir(mode=0o755);os.chmod(DEST,0o755)
            for name in ['manager.py','load-dadata-secret.cjs','policy.json']:write(DEST/name,(SOURCE/name).read_bytes(),0o644)
            write(ENTRY,wrapper,0o755);write(LOGGING,policy,0o440)
            namespace['confirm_unchanged'](protected,containers,cron)
        except Exception:
            LOGGING.unlink(missing_ok=True);ENTRY.unlink(missing_ok=True)
            if DEST.exists():
                for name in ['manager.py','load-dadata-secret.cjs','policy.json']:(DEST/name).unlink(missing_ok=True)
                DEST.rmdir()
            raise
        print(json.dumps({'prepared':True,'runtimeChanged':False,'revision':current['revision'],
            'cdekUnchanged':True,'sudoPermissionsGranted':False}))

if __name__=='__main__':
    try:main()
    except (Exception,KeyboardInterrupt) as error:
        safe=str(error) if type(error) is ValueError and str(error).replace('_','').isalnum() else type(error).__name__
        print(json.dumps({'prepared':False,'reason':safe}),file=sys.stderr);sys.exit(1)

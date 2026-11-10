#!/usr/bin/python3 -I
"""Owner-only DaData setup. All image changes go through the installed Preview deployer."""
import datetime,fcntl,getpass,hashlib,inspect,json,os
from pathlib import Path
import re,resource,runpy,signal,stat,subprocess,sys,tempfile,urllib.request

ROOT=Path(__file__).resolve().parent
CONFIG=Path('/etc/elektrikamarket-preview')
STATE=Path('/var/lib/elektrikamarket-preview')
DATA=STATE/'dadata'
ACTIVE=CONFIG/'dadata-credentials.json'
LOADER=CONFIG/'load-dadata-secret.cjs'
FIELDS={'DADATA_API_KEY','DADATA_SECRET_KEY'}
CDEK=[CONFIG/'cdek-credentials.json',CONFIG/'load-cdek-secret.cjs',Path('/usr/local/sbin/elektrikamarket-preview-cdek'),Path('/usr/local/libexec/elektrikamarket-preview-cdek-entry'),Path('/etc/sudoers.d/cdekpreview'),Path('/etc/ssh/authorized_keys/cdekpreview')]

def require(ok,reason):
    if not ok:raise ValueError(reason)

def trusted(path,directory=False):
    s=path.lstat()
    require((stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)) and s.st_uid==0 and not s.st_mode&0o022,'untrusted_root_file')

def atomic(path,data,runtime=False,public=False):
    raw=data if isinstance(data,bytes) else (json.dumps(data)+'\n').encode()
    fd,name=tempfile.mkstemp(prefix='.dadata-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as f:
            f.write(raw);f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),0o400 if runtime else 0o644 if public else 0o600)
            os.fchown(f.fileno(),1000 if runtime else 0,1000 if runtime else 0)
        os.replace(name,path)
        directory=os.open(path.parent,os.O_DIRECTORY|os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:Path(name).unlink(missing_ok=True)

def pair(value):
    require(isinstance(value,dict) and set(value)==FIELDS,'invalid_pair')
    require(all(isinstance(value[k],str) and re.fullmatch(r'[\x21-\x7e]{1,512}',value[k]) for k in FIELDS),'invalid_pair')
    return value

def read_pair():
    s=ACTIVE.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid==1000 and s.st_mode&0o777==0o400,'unsafe_secret_file')
    return pair(json.loads(ACTIVE.read_text()))

def run(args,env=None,input=None,timeout=90):
    r=subprocess.run(args,input=input,capture_output=True,text=True,env=env,timeout=timeout)
    require(r.returncode==0,'command_failed_'+Path(args[0]).name)
    return r.stdout.strip()

def helper():
    file=Path('/usr/local/sbin/elektrikamarket-preview');trusted(file);trusted(CONFIG,True);trusted(STATE,True)
    trusted(CONFIG/'compose.yaml')
    h=runpy.run_path(str(file),run_name='dadata_existing_deployer')['Deployer']()
    require('force_recreate' in inspect.signature(h.start).parameters,'existing_deployer_needs_owner_review')
    return h

def exec_node(h,program,input=None,preload=False):
    args=['/usr/bin/docker','exec','-i','elektrikamarket-preview-preview-1','node']
    if preload:args+=['--require','/run/preview-dadata/load-dadata-secret.cjs']
    return run(args+['-e',program],h.environment,input)

def safe_image(h):
    current=h.saved()['current'];require(bool(current),'no_current_preview')
    h.prepare(current,pull=False)
    policy=json.loads((ROOT/'policy.json').read_text())
    require(all(re.fullmatch('[a-f0-9]{40}',policy[k]) for k in ['securityCommit','featureBase']),'invalid_policy_commits')
    ref='ghcr.io/stron111-web/elektrikamarket-preview@'+current['digest']
    image=json.loads(h.run(['/usr/bin/docker','image','inspect',ref]))[0]
    c=json.loads(h.run(['/usr/bin/docker','inspect','elektrikamarket-preview-preview-1']))[0]
    require(c['Image']==image['Id'] and c['Config']['Labels']['org.opencontainers.image.revision']==current['revision'],'running_image_mismatch')
    require(c['State']['Running'] and c['State'].get('Health',{}).get('Status')=='healthy','preview_not_healthy')
    marker=json.loads(exec_node(h,"console.log(require('node:fs').readFileSync('/app/preview-security.json','utf8'))"))
    require(marker.get('policy')=='preview-no-browser-secret-export-v1' and marker.get('dadataFeatureBase')==policy['featureBase'],'unsafe_image_marker')
    # Public commit metadata only. No credentials are sent to GitHub.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    url='https://api.github.com/repos/stron111-web/elektrikamarket/compare/'+policy['securityCommit']+'...'+current['revision']
    request=urllib.request.Request(url,headers={'Accept':'application/vnd.github+json','User-Agent':'Preview-DaData-preflight'})
    with opener.open(request,timeout=20) as response:comparison=json.load(response)
    require(comparison.get('status') in ['identical','ahead'] and comparison.get('behind_by')==0,'image_missing_security_commit')
    result=json.loads(exec_node(h,"(async()=>{const results=[];for(const method of ['GET','POST']){const r=await fetch('http://127.0.0.1:3000/admin/keys',{method,headers:{RSC:'1'}});results.push(r.status);}console.log(JSON.stringify(results));})().catch(()=>process.exit(1));"))
    require(result==[404,404],'browser_secret_route_not_blocked')
    return current

def protected():
    values={}
    for p in CDEK+[Path('/usr/local/sbin/elektrikamarket-preview'),STATE/'images.json']:
        require(p.is_file() and not p.is_symlink(),'missing_protected_file')
        values[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
    return values

def frame():
    ids=run(['/usr/bin/docker','ps','-aq']).split()
    rows=json.loads(run(['/usr/bin/docker','inspect',*ids]))
    return {r['Name']:{'id':r['Id'],'image':r['Image'],'startedAt':r['State']['StartedAt']} for r in rows
        if r['Name']!='/elektrikamarket-preview-preview-1' and
        ((r['Config'].get('Labels') or {}).get('com.docker.compose.project') or r['Name'].startswith('/elektrikamarket-catalog-demos-'))}

def attach(compose):
    c=json.loads(json.dumps(compose))
    require(set(c['services'])=={'preview'},'unexpected_services')
    p=c['services']['preview']
    require(not p.get('ports') and p.get('user')=='1000:1000' and p.get('read_only') is True,'unsafe_preview_service')
    require(isinstance(p['command'],list) and p['command'][0]=='node' and p['command'][-1]=='/app/start.cjs','unexpected_command')
    require('/run/preview-cdek/load-cdek-secret.cjs' in p['command'],'cdek_preload_missing')
    require(not (FIELDS & set(p['environment'])),'inline_dadata_secret_forbidden')
    p['environment']['DADATA_CREDENTIALS_FILE']='/run/secrets/preview_dadata_credentials'
    if 'preview_dadata_credentials' not in p['secrets']:p['secrets'].append('preview_dadata_credentials')
    c['secrets']['preview_dadata_credentials']={'file':str(ACTIVE)}
    volume=str(LOADER)+':/run/preview-dadata/load-dadata-secret.cjs:ro'
    if volume not in p['volumes']:p['volumes'].append(volume)
    if '/run/preview-dadata/load-dadata-secret.cjs' not in p['command']:
        p['command']=[p['command'][0],'--require','/run/preview-dadata/load-dadata-secret.cjs',*p['command'][1:]]
    return c

def check_keys(h,value=None):
    if value is not None:
        program="let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{s+=c;if(s.length>4096)process.exit(1)});process.stdin.on('end',async()=>{try{const p=JSON.parse(s),v=await require('/app/preview-dadata/dadata-core.cjs').validatePair({apiKey:p.DADATA_API_KEY,secretKey:p.DADATA_SECRET_KEY});console.log(JSON.stringify(v));}catch{console.log('{\"accepted\":false}')}});"
        result=json.loads(exec_node(h,program,json.dumps(pair(value))))
    else:
        program="require('/app/preview-dadata/dadata-probe.cjs');"
        result=json.loads(exec_node(h,program,preload=True))
    require(set(result)<= {'accepted','fields','reason'},'unexpected_probe_result')
    return result

def restore_files(backup):
    atomic(CONFIG/'compose.yaml',(backup/'compose.yaml').read_bytes())
    for target,name,runtime in [(ACTIVE,'credentials.json',True),(LOADER,'loader.cjs',False)]:
        if (backup/name).exists():atomic(target,(backup/name).read_bytes(),runtime,public=target==LOADER)
        else:target.unlink(missing_ok=True)

def snapshot(guards,containers,cron):
    b=DATA/('backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir(mode=0o700)
    atomic(b/'compose.yaml',(CONFIG/'compose.yaml').read_bytes())
    for file,name in [(ACTIVE,'credentials.json'),(LOADER,'loader.cjs')]:
        if file.exists():atomic(b/name,file.read_bytes())
    atomic(b/'baseline.json',{'protected':guards,'containers':containers,'cron':hashlib.sha256(cron.encode()).hexdigest()})
    return b

def confirm_unchanged(guards,containers,cron):
    require(protected()==guards,'cdek_or_image_state_changed')
    require(frame()==containers,'non_preview_container_changed')
    require(run(['/usr/bin/crontab','-u','shopadmin','-l'])==cron,'cron_changed')

def set_keys(value):
    h=helper()
    with (STATE/'deploy.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);current=safe_image(h)
        validation=check_keys(h,value)
        require(validation.get('accepted') is True,'dadata_keys_or_lookup_rejected')
        guards,containers,cron=protected(),frame(),run(['/usr/bin/crontab','-u','shopadmin','-l'])
        old_config=json.loads((CONFIG/'compose.yaml').read_text());new_config=attach(old_config)
        if ACTIVE.exists() and read_pair()==value and new_config==old_config:
            result=check_keys(h);require(result.get('accepted') is True,'runtime_lookup_failed');return {'applied':True,'unchanged':True,**result}
        backup=snapshot(guards,containers,cron)
        try:
            atomic(ACTIVE,value,runtime=True);atomic(LOADER,(ROOT/'load-dadata-secret.cjs').read_bytes(),public=True)
            atomic(CONFIG/'compose.yaml',new_config)
            h.start(current,force_recreate=True);h.verify(current);safe_image(h)
            result=check_keys(h);require(result.get('accepted') is True,'runtime_lookup_failed')
            confirm_unchanged(guards,containers,cron)
            record={'applied':True,**result,'revision':current['revision'],'backup':str(backup),
                'composeSha256':hashlib.sha256((CONFIG/'compose.yaml').read_bytes()).hexdigest(),
                'cdekUnchanged':True,'otherContainersUnchanged':True,'imageStateUnchanged':True}
            atomic(DATA/'last-success.json',record)
        except Exception:
            # Restore only DaData/Compose. CDEK settings, image references and databases stay untouched.
            try:restore_files(backup);h.start(current,force_recreate=True);h.verify(current);confirm_unchanged(guards,containers,cron)
            except Exception:raise ValueError('rollback_needs_owner_review') from None
            raise ValueError('previous_preview_settings_restored') from None
        return record

def rollback():
    h=helper()
    with (STATE/'deploy.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);current=safe_image(h)
        saved=json.loads((DATA/'last-success.json').read_text());backup=Path(saved['backup']).resolve()
        require(backup.is_relative_to(DATA) and backup.name.startswith('backup-'),'unsafe_backup_path');trusted(backup,True)
        require(hashlib.sha256((CONFIG/'compose.yaml').read_bytes()).hexdigest()==saved['composeSha256'],'later_configuration_changes_need_review')
        guards,containers,cron=protected(),frame(),run(['/usr/bin/crontab','-u','shopadmin','-l'])
        forward=snapshot(guards,containers,cron)
        try:restore_files(backup);h.start(current,force_recreate=True);h.verify(current);confirm_unchanged(guards,containers,cron)
        except Exception:
            try:restore_files(forward);h.start(current,force_recreate=True);h.verify(current)
            except Exception:raise ValueError('rollback_needs_owner_review') from None
            raise ValueError('rollback_failed_current_settings_restored') from None
        return {'rolledBack':True,'revision':current['revision'],'cdekUnchanged':True,'otherContainersUnchanged':True,'safeImageRetained':True}

def main():
    require(os.geteuid()==0 and sys.argv[1:] in [['set'],['verify'],['status'],['rollback']],'owner_command_required')
    os.umask(0o077);resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    os.environ.clear();os.environ.update(PATH='/usr/sbin:/usr/bin:/sbin:/bin',LANG='C.UTF-8',HOME=str(DATA),TERM='dumb')
    trusted(ROOT,True);trusted(ROOT/'policy.json');trusted(DATA,True)
    mode=sys.argv[1]
    with (DATA/'session.lock').open('a') as session:
        fcntl.flock(session,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if mode=='set':
            require(sys.stdin.isatty() and sys.stdout.isatty(),'interactive_tty_required')
            # Refuse to request keys until the safe image is already deployed.
            with (STATE/'deploy.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);safe_image(helper())
            signal.signal(signal.SIGALRM,lambda *_: (_ for _ in ()).throw(TimeoutError()));signal.alarm(600)
            value=pair({'DADATA_API_KEY':getpass.getpass('DADATA_API_KEY (hidden): ').strip(),
                        'DADATA_SECRET_KEY':getpass.getpass('DADATA_SECRET_KEY (hidden): ').strip()})
            signal.alarm(0);result=set_keys(value)
        elif mode=='verify':
            with (STATE/'deploy.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);h=helper();safe_image(h);result=check_keys(h)
        elif mode=='rollback':result=rollback()
        else:result={'configured':ACTIVE.exists(),'last':json.loads((DATA/'last-success.json').read_text()) if (DATA/'last-success.json').exists() else None}
        print(json.dumps(result),flush=True)

if __name__=='__main__':
    try:main()
    except (Exception,KeyboardInterrupt) as error:
        # Only our fixed error tags are printable. Never exception bodies from HTTP/tools.
        tag=str(error) if type(error) is ValueError and re.fullmatch('[a-zA-Z0-9_]+',str(error)) else type(error).__name__
        print(json.dumps({'ok':False,'reason':tag}),file=sys.stderr);sys.exit(1)

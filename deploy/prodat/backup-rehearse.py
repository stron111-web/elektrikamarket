#!/usr/bin/env python3
"""Read a consistent live snapshot, back it up, restore ONLY into an isolated container."""
import hashlib,json,os,pathlib,re,subprocess,time,sys,datetime
os.umask(0o077)
LIVE='elektrikamarket-deploy-postgres-1'
DATABASE='elektrikamarket_test_20261029t010219z_2761a73c'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
root=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')/('rehearsal-'+stamp)
root.mkdir(mode=0o700)
(root.parent/'rehearsal-latest-path').write_text(str(root)+'\n')
container='elektrikamarket-prodat-rehearsal-'+stamp.lower()
volume=container+'-data'
def run(args,**kwargs):
    return subprocess.run(args,check=True,timeout=900,**kwargs)
def psql_command(target,db=DATABASE):
    if target==LIVE:
        return ['docker','exec', '-i',target,'sh','-c','exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d '+db]
    assert target==container
    return ['docker','exec','-i',target,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','fixture_admin','-d',db]
log=open(root/'private-backup.log','wb')
parent=subprocess.Popen(psql_command(LIVE),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,bufsize=1)
def ask(sql):
    parent.stdin.write(sql+';\n');parent.stdin.flush()
    line=parent.stdout.readline()
    if not line: raise RuntimeError('snapshot psql closed')
    return line.strip()
def fingerprint_sql(schema,table):
    ident='"'+schema.replace('"','""')+'"."'+table.replace('"','""')+'"'
    label=(schema+'.'+table).replace("'","''")
    return "SELECT json_build_object('table','"+label+"','rows',count(*),'hash',md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),''))) FROM "+ident+' t'
try:
    parent.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL idle_in_transaction_session_timeout='15min'; SET LOCAL statement_timeout='10min';\n");parent.stdin.flush()
    snapshot=ask('SELECT pg_export_snapshot()')
    assert re.fullmatch(r'[0-9a-fA-F-]+',snapshot)
    tables=json.loads(ask("SELECT coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename) ORDER BY schemaname,tablename),'[]'::json) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"))
    seq_sql="SELECT coalesce(json_agg(json_build_object('schema',schemaname,'sequence',sequencename,'last',last_value) ORDER BY schemaname,sequencename),'[]'::json) FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema')"
    sequences=json.loads(ask(seq_sql))
    source=[json.loads(ask(fingerprint_sql(t['schema'],t['table']))) for t in tables]
    (root/'source-fingerprint.json').write_text(json.dumps(source,indent=2)+'\n')
    archive=root/'database.dump'
    with open(archive,'xb') as output:
        run(['docker','exec',LIVE,'sh','-c','exec pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" -d '+DATABASE+' --snapshot "$1"','backup',snapshot],stdout=output,stderr=log)
    assert sequences==json.loads(ask(seq_sql)),'Sequences changed during backup; retry a fresh snapshot'
    parent.stdin.write('ROLLBACK;\n\\q\n');parent.stdin.flush();assert parent.wait(timeout=20)==0
    with open(archive,'rb') as stream:
        run(['docker','exec','-i',LIVE,'pg_restore','--list'],stdin=stream,stdout=log,stderr=log)
    image=subprocess.check_output(['docker','inspect',LIVE,'--format','{{.Image}}'],text=True).strip()
    assert re.fullmatch('sha256:[0-9a-f]{64}',image)
    run(['docker','volume','create','--label','elektrikamarket.scope=prodat-rehearsal',volume],stdout=log,stderr=log)
    run(['docker','run','-d','--name',container,'--label','elektrikamarket.scope=prodat-rehearsal','--network','none','--memory','1g','--cpus','1','--pids-limit','128','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_DB=prodat_rehearsal','-e','POSTGRES_HOST_AUTH_METHOD=trust','--mount','type=volume,src='+volume+',dst=/var/lib/postgresql/data',image],stdout=log,stderr=log)
    for attempt in range(60):
        # pg_isready also accepts the temporary server used by the official
        # image during initdb. Wait until PID 1 is the FINAL postgres server,
        # otherwise pg_restore can race its intentional initialization stop.
        readiness='test "$(cat /proc/1/comm)" = postgres && pg_isready -U fixture_admin -d prodat_rehearsal'
        if subprocess.run(['docker','exec',container,'sh','-c',readiness],stdout=log,stderr=log).returncode==0:break
        time.sleep(1)
    else: raise RuntimeError('Fixture PostgreSQL not ready')
    with open(archive,'rb') as stream:
        run(['docker','exec','-i',container,'pg_restore','-U','fixture_admin','-d','prodat_rehearsal','--no-owner','--no-acl','--exit-on-error','--single-transaction'],stdin=stream,stdout=log,stderr=log)
    restored=[]
    for t in tables:
        sql="SET timezone='UTC'; "+fingerprint_sql(t['schema'],t['table'])+';'
        p=run(psql_command(container,'prodat_rehearsal'),input=sql.encode(),stdout=subprocess.PIPE,stderr=log)
        restored.append(json.loads(p.stdout.decode().strip()))
    (root/'restored-fingerprint.json').write_text(json.dumps(restored,indent=2)+'\n')
    assert source==restored,'Restored table fingerprints differ'
    digest=hashlib.sha256()
    with open(archive,'rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    result={'status':'RESTORE_VERIFIED','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'archive':str(archive),'sha256':digest.hexdigest(),'bytes':archive.stat().st_size,'tablesVerified':len(source),'fixtureContainer':container,'fixtureVolume':volume,'fixtureDatabase':'prodat_rehearsal','postgresImage':image,'network':'none','publishedPorts':False,'liveWrites':False}
    (root/'backup-validation.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
except Exception as error:
    print(json.dumps({'status':'BACKUP_OR_RESTORE_FAILED','root':str(root),'errorType':type(error).__name__}),file=sys.stderr)
    raise SystemExit(1)
finally:
    if parent.poll() is None:
        try:parent.stdin.write('ROLLBACK;\n\\q\n');parent.stdin.flush();parent.wait(timeout=15)
        except Exception:parent.terminate()
    log.close()

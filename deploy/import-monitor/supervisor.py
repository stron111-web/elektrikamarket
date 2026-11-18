#!/usr/bin/env python3
"""Control exactly one newly labelled container; never SIGKILL, never remove a lock."""
import argparse
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
import uuid
from monitor import atomic, private_json, iso

FAILURE_STATE = None


def inspect(cid):
    return json.loads(subprocess.check_output(['/usr/bin/docker', 'inspect', cid], stderr=subprocess.DEVNULL))[0]


def limits(config):
    p = config['runtimeLimits']
    if any(not isinstance(p.get(k), int) or p[k] <= 0 for k in ['maxRunMs', 'stallMs', 'terminateGraceMs']):
        raise ValueError('EXPLICIT_RUNTIME_LIMITS')
    return p


def progress(old, record, now):
    if record.get('status') != 'PROGRESS':
        return old
    fields = {k: record[k] for k in ['phase', 'source', 'records', 'rows', 'bytes', 'updatedRecords'] if k in record}
    signature = json.dumps(fields, sort_keys=True)
    if signature != old.get('signature'):
        return {**old, 'signature': signature, 'lastProgressAt': iso(now), 'progress': fields}
    return old


def main():
    global FAILURE_STATE
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--state-directory', required=True)
    parser.add_argument('--job', required=True, choices=['PRICAT', 'PRODAT'])
    parser.add_argument('command', nargs=argparse.REMAINDER)
    a = parser.parse_args()
    command = a.command[1:] if a.command[:1] == ['--'] else a.command
    if command[:2] != ['/usr/bin/docker', 'run'] or '--rm' in command or '-v' in command:
        raise ValueError('EXPLICIT_DOCKER_RUN_REQUIRED')
    if '--name' not in command or '--detach' in command or '-d' in command:
        raise ValueError('FIXED_CONTAINER_NAME_REQUIRED')
    name = command[command.index('--name') + 1]
    if not re.fullmatch('elektrikamarket-' + a.job.lower() + r'-[a-z0-9-]+', name):
        raise ValueError('CONTAINER_NAME_SCOPE')
    c = private_json(a.config)
    p = limits(c)
    root = Path(a.state_directory)
    folder = root / 'supervisor'
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    if (root / 'needs-review.json').exists():
        raise ValueError('PUBLICATION_NEEDS_REVIEW')
    state_file = folder / 'latest.json'
    FAILURE_STATE = (root, state_file)
    prior = private_json(state_file) if state_file.exists() else {}
    run_id = uuid.uuid4().hex
    start = time.time()
    monotonic_start = time.monotonic()
    live = {'id': run_id, 'job': a.job, 'status': 'RUNNING', 'startedAt': iso(start),
            'lastProgressAt': iso(start), 'lastHeartbeatAt': iso(start),
            'lastSuccessfulCheckAt': prior.get('lastSuccessfulCheckAt'), 'lastErrorAt': prior.get('lastErrorAt')}
    atomic(state_file, live)
    command = command[:2] + ['--detach', '--label', 'elektrikamarket.supervised=' + run_id] + command[2:]
    try:
        cid = subprocess.check_output(command, stderr=subprocess.PIPE, text=True).strip()
    except subprocess.CalledProcessError:
        live.update(status='FAILED', lastErrorAt=iso(time.time()), code='CONTAINER_START_FAILED')
        atomic(state_file, live)
        print(json.dumps({'status': 'FAILED', 'code': 'CONTAINER_START_FAILED'}))
        return 1
    if not re.fullmatch('[0-9a-f]{64}', cid):
        raise ValueError('CONTAINER_ID_REQUIRED')
    live['containerId'] = cid
    atomic(state_file, live)
    controller_term = []
    def requested(_signum, _frame):
        controller_term.append(True)
    signal.signal(signal.SIGTERM, requested)
    signal.signal(signal.SIGINT, requested)
    follower = subprocess.Popen(['/usr/bin/docker', 'logs', '--follow', cid], stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, bufsize=0)
    selector = selectors.DefaultSelector()
    selector.register(follower.stdout, selectors.EVENT_READ)
    pending = b''
    reason = None
    term_at = None
    last_progress = time.monotonic()
    last_signature = None
    stopped = None
    log_path = folder / (run_id + '.log')
    with os.fdopen(os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as log:
        while True:
            for key, _ in selector.select(timeout=1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if chunk:
                    log.write(chunk)
                    log.flush()
                    pending += chunk
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        try:
                            record = json.loads(line)
                        except (ValueError, UnicodeError):
                            continue
                        if record.get('status') in ['ABORTING','STOPPED'] and re.fullmatch('[A-Z_]{5,80}',str(record.get('code',''))):
                            live['workerErrorCode'] = record['code']
                        # Normalize legacy PRODAT once; an identical event must not
                        # alternate signatures and masquerade as real progress.
                        meaningful = record
                        if a.job == 'PRODAT' and record.get('status') != 'HEARTBEAT':
                            if record.get('phase') or record.get('status'):
                                meaningful = {**record, 'status': 'PROGRESS',
                                    'phase': record.get('phase') or record['status']}
                                if 'processedRecords' in record:
                                    meaningful['records'] = record['processedRecords']
                        live = progress(live, meaningful, time.time())
                        if live.get('signature') != last_signature:
                            last_signature = live.get('signature')
                            last_progress = time.monotonic()
                elif follower.poll() is not None:
                    selector.unregister(key.fileobj)
            x = inspect(cid)
            if x['Id'] != cid or x['Config']['Labels'].get('elektrikamarket.supervised') != run_id:
                raise ValueError('CONTAINER_IDENTITY_CHANGED')
            if not x['State']['Running']:
                stopped = x['State']
                break
            now = time.monotonic()
            if reason is None:
                if controller_term:
                    reason = 'JOB_SIGTERM'
                elif now - monotonic_start > p['maxRunMs'] / 1000:
                    reason = 'JOB_DEADLINE'
                elif now - last_progress > p['stallMs'] / 1000:
                    reason = 'NO_PROGRESS'
                if reason:
                    subprocess.run(['/usr/bin/docker', 'kill', '--signal', 'TERM', cid], check=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    term_at = now
                    live['terminationReason'] = reason
            elif now - term_at > p['terminateGraceMs'] / 1000 + 15:
                live.update(status='NEEDS_REVIEW', code='TERM_NOT_CONFIRMED', lastErrorAt=iso(time.time()))
                atomic(root / 'needs-review.json', {'status': 'TERM_NOT_CONFIRMED', 'containerId': cid, 'job': a.job})
                break  # No SIGKILL, lock removal or blind retry.
            live['lastHeartbeatAt'] = iso(time.time())
            atomic(state_file, live)
        if stopped is not None:
            log.seek(0);log.truncate(0)
            subprocess.run(['/usr/bin/docker','logs',cid],stdout=log,stderr=subprocess.STDOUT,check=True)
        elif pending:
            log.write(pending)
        log.flush()
        os.fsync(log.fileno())
    selector.close()
    # Terminate only the local Docker log follower, never the importer with SIGKILL.
    if follower.poll() is None:
        follower.terminate()
    try:
        follower.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    if stopped is not None:
        atomic(folder / (run_id + '-container.json'), {'containerId': cid, 'state': stopped})
        ok = stopped['ExitCode'] == 0 and reason is None
        live.update(status='SUCCEEDED' if ok else 'FAILED', exitCode=stopped['ExitCode'], finishedAt=iso(time.time()))
        live['lastSuccessfulCheckAt' if ok else 'lastErrorAt'] = iso(time.time())
        if not c.get('retainCompletedContainer', False):
            subprocess.run(['/usr/bin/docker', 'rm', cid], check=True, stdout=subprocess.DEVNULL)
    atomic(state_file, live)
    print(json.dumps({k: live.get(k) for k in ['status', 'job', 'exitCode', 'terminationReason', 'code']}))
    return 0 if live['status'] == 'SUCCEEDED' else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        if FAILURE_STATE:
            try:
                root,state_path=FAILURE_STATE
                live=private_json(state_path)
                if live.get('status')=='RUNNING':
                    live.update(status='NEEDS_REVIEW',lastErrorAt=iso(time.time()),code='SUPERVISOR_FAILED')
                    atomic(state_path,live)
                    atomic(root/'needs-review.json',{'status':'SUPERVISOR_FAILED','containerId':live.get('containerId')})
            except Exception:
                pass
        print(json.dumps({'status': 'SUPERVISOR_FAILED'}))
        sys.exit(1)

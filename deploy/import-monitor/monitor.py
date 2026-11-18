#!/usr/bin/env python3
"""Independent read-only observer + private durable SMTP outbox. Never imports data."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
import stat
import time
import uuid
from email.message import EmailMessage

SENDER = 'info@elektrikamarket.ru'
RECIPIENT = 'stron1@mail.ru'
SUCCESS = {'NO_REMOTE_CHANGE', 'UNCHANGED_VERIFIED', 'CHECKED', 'SUCCEEDED', 'UNCHANGED'}


def private_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as f:
        s = os.fstat(f.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
            raise ValueError('PRIVATE_FILE_REQUIRED')
        return json.load(f)


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.parent.is_symlink():
        raise ValueError('SYMLINK_DIRECTORY')
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def stamp(value):
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, AttributeError):
        return None


def iso(now):
    return dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat()


def tail_events(path):
    if not path.exists():
        return []
    with path.open('rb') as f:
        size = os.fstat(f.fileno()).st_size
        offset = max(0, size - 1024 * 1024)
        f.seek(offset)
        lines = f.read().decode('utf-8', errors='replace').splitlines()
    if offset:
        lines = lines[1:]
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def observe(job):
    root = Path(job['stateDirectory'])
    events = tail_events(root / ('ftp/events.ndjson' if job['kind'] == 'PRICAT' else 'events.ndjson'))
    success = [stamp(e.get('at')) for e in events if e.get('status') in SUCCESS]
    errors = [stamp(e.get('at')) for e in events if e.get('status') in {'STOPPED', 'FAILED', 'NEEDS_REVIEW'}]
    state_file = root / 'supervisor/latest.json'
    live = private_json(state_file) if state_file.exists() else {}
    successful = max([x for x in success + [stamp(live.get('lastSuccessfulCheckAt'))] if x is not None], default=None)
    failed = max([x for x in errors + [stamp(live.get('lastErrorAt'))] if x is not None], default=None)
    return {'lastSuccess': successful, 'lastError': failed,
            'needsReview': any(p.exists() for p in [root / 'needs-review.json', root / 'ftp/needs-review.json']),
            'running': live.get('status') == 'RUNNING', 'started': stamp(live.get('startedAt')),
            'progress': stamp(live.get('lastProgressAt'))}


def health(s, now, limits):
    if s['needsReview']:
        return 'PUBLICATION_NEEDS_REVIEW'
    if s['running']:
        if s['started'] is None:
            return 'MISSING_RUNNING_TIMESTAMP'
        if now - s['started'] > limits['maxRunSeconds']:
            return 'JOB_DEADLINE'
        if now - (s['progress'] or s['started']) > limits['stallSeconds']:
            return 'NO_PROGRESS'
    if s['lastError'] is not None and (s['lastSuccess'] is None or s['lastError'] > s['lastSuccess']):
        return 'IMPORT_ERROR'
    if s['lastSuccess'] is None:
        return 'MISSING_CHECK_TIMESTAMP'
    if now - s['lastSuccess'] > limits['intervalSeconds'] + limits['graceSeconds']:
        return 'CHECK_OVERDUE'
    return 'OK'


def transition(state, job, code, now, last_success):
    previous = state.setdefault('incidents', {}).get(job)
    outbox = state.setdefault('outbox', [])
    if code != 'OK':
        if previous and previous['active']:
            previous['code'] = code  # Same incident, even if the symptom changes.
            return
        incident = {'id': uuid.uuid4().hex, 'active': True, 'code': code, 'at': iso(now)}
        state['incidents'][job] = incident
        kind = 'INCIDENT'
    elif previous and previous['active']:
        incident = previous
        incident['active'] = False
        kind = 'RECOVERED'
    else:
        return
    outbox.append({'id': incident['id'] + ':' + kind, 'incidentId': incident['id'],
                   'kind': kind, 'job': job, 'code': incident['code'], 'at': iso(now),
                   'lastSuccessfulCheckAt': iso(last_success) if last_success is not None else None,
                   'status': 'PENDING', 'attempts': 0, 'nextAttemptAt': now})


def message(notice):
    m = EmailMessage()
    m['From'], m['To'] = SENDER, RECIPIENT
    key = hashlib.sha256(notice['id'].encode()).hexdigest()
    m['Message-ID'] = '<' + key + '@elektrikamarket.ru>'
    recovered = notice['kind'] == 'RECOVERED'
    m['Subject'] = 'elektrikamarket: ' + ('восстановлено ' if recovered else 'ошибка ') + notice['job']
    local = dt.datetime.fromisoformat(notice['at']).astimezone(dt.timezone(dt.timedelta(hours=4)))
    m.set_content('Источник: ' + notice['job'] + '\nСостояние: ' + notice['kind'] +
                  '\nПричина: ' + notice['code'] + '\nСамара: ' + local.strftime('%d.%m.%Y %H:%M:%S UTC+4') +
                  '\nПоследняя успешная проверка (UTC): ' + str(notice['lastSuccessfulCheckAt']) +
                  '\nИнцидент: ' + notice['incidentId'] + '\n')
    return m


def deliver_one(state, config, state_path, now, smtp_factory=smtplib.SMTP_SSL):
    # A process crash after SMTP DATA can leave delivery uncertain. Do not auto-resend.
    changed = False
    for n in state.get('outbox', []):
        if n['status'] == 'SENDING':
            n['status'] = 'DELIVERY_UNKNOWN'
            changed = True
    if changed:
        atomic(state_path, state)
    if not config.get('mailEnabled', False):
        return 'MAIL_DISABLED'
    n = next((x for x in state.get('outbox', []) if x['status'] == 'PENDING' and x['nextAttemptAt'] <= now), None)
    if n is None:
        return 'NO_PENDING_MAIL'
    smtp = config['smtp']
    if (smtp['host'], smtp['port'], smtp['username'], smtp['sender'], smtp['recipient']) != (
            'smtp.mail.ru', 465, SENDER, SENDER, RECIPIENT):
        raise ValueError('SMTP_ENDPOINT_OR_ADDRESS')
    password = private_json(smtp['passwordFile'])['password']
    client = None
    data_started = False
    try:
        client = smtp_factory(smtp['host'], smtp['port'], timeout=20, context=ssl.create_default_context())
        client.set_debuglevel(0)
        client.login(SENDER, password)
        n['status'] = 'SENDING'
        n['attempts'] += 1
        atomic(state_path, state)  # Durable before any possible SMTP DATA acceptance.
        data_started = True
        refused = client.send_message(message(n), from_addr=SENDER, to_addrs=[RECIPIENT])
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
        n['status'], n['acceptedAt'] = 'SENT', iso(now)
        atomic(state_path, state)
        return 'SMTP_ACCEPTED'
    except Exception as e:
        known_rejection = isinstance(e, (smtplib.SMTPAuthenticationError, smtplib.SMTPRecipientsRefused,
                                         smtplib.SMTPSenderRefused, smtplib.SMTPDataError))
        n['status'] = 'DELIVERY_UNKNOWN' if data_started and not known_rejection else 'PENDING'
        n['nextAttemptAt'] = now + 900
        # Never retain exception text: it could include authentication/server data.
        n['errorCode'] = 'SMTP_DELIVERY_UNKNOWN' if n['status'] == 'DELIVERY_UNKNOWN' else 'SMTP_FAILED'
        atomic(state_path, state)
        return n['errorCode']
    finally:
        password = None
        if client is not None:
            try:
                client.close()
            except Exception:
                pass


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args()
    c = private_json(args.config)
    if set(c['jobs']) != {'PRICAT', 'PRODAT'}:
        raise ValueError('EXPLICIT_JOBS_REQUIRED')
    root = Path(c['monitorDirectory'])
    if args.status:
        s = private_json(root / 'state.json') if (root / 'state.json').exists() else {}
        print(json.dumps({'mailEnabled': c.get('mailEnabled', False), 'incidents': s.get('incidents', {}),
                          'outbox': [{k: n.get(k) for k in ['job', 'kind', 'status', 'at', 'acceptedAt', 'errorCode']}
                                     for n in s.get('outbox', [])]}))
        return
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(root / 'monitor.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        print(json.dumps({'status': 'MONITOR_ALREADY_RUNNING'}))
        return
    try:
        state_path = root / 'state.json'
        s = private_json(state_path) if state_path.exists() else {'version': 1}
        now = time.time()
        for name, job in c['jobs'].items():
            try:
                if any(type(job.get(k)) is not int or job[k] <= 0 for k in
                       ['intervalSeconds', 'graceSeconds', 'maxRunSeconds', 'stallSeconds']):
                    raise ValueError('EXPLICIT_JOB_LIMITS')
                o = observe(job)
                previous = s.setdefault('observations', {}).get(name, {})
                # Persist successful checks independently of log rotation and a new run.
                for key in ['lastSuccess', 'lastError']:
                    o[key] = max((v for v in [o[key], previous.get(key)] if v is not None), default=None)
                s['observations'][name] = {k: o[k] for k in ['lastSuccess', 'lastError']}
                code = health(o, now, job)
            except Exception:
                o, code = {'lastSuccess': None}, 'STATUS_READ_FAILED'
            transition(s, name, code, now, o['lastSuccess'])
        atomic(state_path, s)
        status = deliver_one(s, c, state_path, now)
        print(json.dumps({'status': status, 'activeIncidents': sum(x['active'] for x in s.get('incidents', {}).values())}))
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'status': 'MONITOR_FAILED'}))
        raise SystemExit(1)

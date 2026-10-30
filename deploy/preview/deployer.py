#!/usr/bin/python3 -I
"""One owner-installed command: stdin COMMIT DIGEST, or owner-only rollback."""
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile

CONFIG = Path('/etc/elektrikamarket-preview')
STATE = Path('/var/lib/elektrikamarket-preview')
IMAGE = 'ghcr.io/stron111-web/elektrikamarket-preview'
REPOSITORY = 'https://github.com/stron111-web/elektrikamarket'
BRANCH = 'refs/heads/preview/friend'
HOST = 'https://preview.elektro-24.ru'


def record(revision, digest):
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision, re.ASCII):
        raise ValueError('Invalid preview commit')
    if not isinstance(digest, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest, re.ASCII):
        raise ValueError('Immutable preview digest required')
    return {'revision': revision, 'digest': digest}


def request(value):
    match = re.fullmatch(rb'([0-9a-f]{40}) (sha256:[0-9a-f]{64})\n?', value, re.ASCII)
    if not match:
        raise ValueError('Only COMMIT DIGEST on stdin is accepted')
    return record(*(v.decode('ascii') for v in match.groups()))


def protected(path, directory=False):
    info = path.lstat()
    expected = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    if not expected or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError('Deployment policy must be root-owned and not writable by others')


class Deployer:
    def __init__(self, config=CONFIG, state=STATE):
        self.config, self.state, self.stage = config, state, 'preflight'
        self.environment = {
            'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8',
            'HOME': str(state), 'XDG_CONFIG_HOME': str(state / 'xdg'),
            'DOCKER_HOST': 'unix:///var/run/docker.sock', 'DOCKER_CONFIG': str(state / 'docker'),
            'COMPOSE_DISABLE_ENV_FILE': '1', 'GIT_TERMINAL_PROMPT': '0', 'GIT_CONFIG_NOSYSTEM': '1',
            'PREVIEW_DATABASE_URL_FILE': str(config / 'database_url'),
            'PREVIEW_FRONTEND_NETWORK': 'elektrikamarket-storefront_frontend',
            'PREVIEW_DATABASE_NETWORK': 'elektrikamarket-deploy_default',
        }

    def run(self, args, timeout=30):
        result = subprocess.run(args, cwd=self.config, env=self.environment,
                                capture_output=True, text=True, timeout=timeout, check=False)
        if result.returncode:
            raise RuntimeError('Command failed at ' + self.stage)
        return result.stdout.strip()  # Never print command output, HTML or runtime secrets.

    def saved(self):
        path = self.state / 'images.json'
        value = json.loads(path.read_text()) if path.exists() else {'current': None, 'previous': None}
        if not isinstance(value, dict) or set(value) != {'current', 'previous'}:
            raise ValueError('Invalid image references; owner review required')
        for item in value.values():
            if item is not None:
                if not isinstance(item, dict) or set(item) != {'revision', 'digest'}:
                    raise ValueError('Invalid image reference')
                record(**item)
        return value

    def save(self, current, previous):
        with tempfile.NamedTemporaryFile(mode='w', dir=self.state, delete=False) as stream:
            temporary = Path(stream.name)
            try:
                json.dump({'current': current, 'previous': previous}, stream)
                stream.flush()
                os.fsync(stream.fileno())
                os.replace(temporary, self.state / 'images.json')
            finally:
                temporary.unlink(missing_ok=True)

    def compose(self, item, *args):
        self.environment['PREVIEW_IMAGE'] = IMAGE + '@' + record(**item)['digest']
        return self.run(['/usr/bin/docker', 'compose', '--project-name', 'elektrikamarket-preview',
                         '--env-file', '/dev/null', '-f', str(self.config / 'compose.yaml'), *args], timeout=180)

    def head(self):
        self.stage = 'preview-branch-check'
        fields = self.run(['/usr/bin/git', '-c', 'credential.helper=', 'ls-remote', '--exit-code', '--refs', REPOSITORY + '.git', BRANCH]).split()
        if len(fields) != 2 or fields[1] != BRANCH:
            raise ValueError('Could not verify preview/friend')
        return fields[0]

    def prepare(self, item, pull=True):
        image = IMAGE + '@' + record(**item)['digest']
        self.stage = 'image-pull'
        if pull:
            self.run(['/usr/bin/docker', 'pull', image], timeout=180)
        self.stage = 'image-identity'
        labels = json.loads(self.run(['/usr/bin/docker', 'image', 'inspect', '--format', '{{json .Config.Labels}}', image]))
        expected = {'org.opencontainers.image.revision': item['revision'],
                    'org.opencontainers.image.source': REPOSITORY, 'org.opencontainers.image.ref.name': BRANCH}
        if not isinstance(labels, dict) or any(labels.get(k) != v for k, v in expected.items()):
            raise ValueError('Unexpected preview image identity')

    def start(self, item):
        self.stage = 'compose-validation'
        self.compose(item, 'config', '--quiet')
        self.stage = 'preview-health'
        self.compose(item, 'up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'preview')

    def verify(self, item):
        self.stage = 'preview-catalog'
        # Internal HTTP bypasses only Caddy's Basic Auth, not PostgreSQL privileges.
        # No owner/developer password copies on the deployer or GitHub are needed.
        self.compose(item, 'exec', '-T', 'preview', 'node', '-e',
                     "fetch('http://127.0.0.1:3000/catalog',{signal:AbortSignal.timeout(45000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))")
        self.stage = 'public-https-auth'
        for route in ['/catalog', '/api/health', '/_next/static/not-a-real-file.js']:
            code = self.run(['/usr/bin/curl', '-q', '--silent', '--show-error', '--proto', '=https',
                             '--max-time', '15', '--output', '/dev/null', '--write-out', '%{http_code}', HOST + route])
            if code != '401':
                raise RuntimeError('Preview must deny anonymous access over valid HTTPS')

    def deploy(self, item):
        record(**item)
        old = self.saved()
        if self.head() != item['revision']:
            raise ValueError('Only the current preview/friend head may deploy')
        self.prepare(item)
        if self.head() != item['revision']:
            raise ValueError('Preview branch advanced during pull')
        try:
            self.start(item)
            self.verify(item)
        except Exception:
            failed_stage = self.stage
            try:
                if old['current']:
                    self.start(old['current'])
                    self.verify(old['current'])
                else:
                    self.compose(item, 'stop', '--timeout', '10', 'preview')
            except Exception:
                raise RuntimeError('Preview failed at ' + failed_stage + '; rollback failed, owner inspection required') from None
            raise RuntimeError('Preview failed at ' + failed_stage + '; previous preview restored or first preview stopped') from None
        self.save(item, old['previous'] if old['current'] == item else old['current'])
        print('Preview deployed and checked: ' + item['revision'])

    def rollback(self):
        old = self.saved()
        if not old['previous']:
            raise ValueError('No previous verified preview exists')
        self.prepare(old['previous'], pull=False)
        self.start(old['previous'])
        self.verify(old['previous'])
        self.save(old['previous'], old['current'])
        print('Preview-only rollback checked')


def main(args):
    if os.geteuid() != 0:
        raise ValueError('This command requires its restricted sudo entry')
    if args not in ([], ['rollback']):
        raise ValueError('No arguments allowed, except owner-only rollback')
    protected(CONFIG, directory=True)
    protected(STATE, directory=True)
    protected(CONFIG / 'compose.yaml')
    item = None
    if not args:
        # A holder of the restricted SSH key cannot leave a privileged reader waiting forever.
        signal.alarm(10)
        item = request(sys.stdin.buffer.read(114))
        signal.alarm(0)
    with (STATE / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        helper = Deployer()
        helper.rollback() if args else helper.deploy(item)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (Exception, KeyboardInterrupt) as error:
        print('Preview operation stopped: ' + (str(error) if isinstance(error, (ValueError, RuntimeError)) else type(error).__name__), file=sys.stderr)
        sys.exit(1)

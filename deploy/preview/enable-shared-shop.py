#!/usr/bin/python3
"""One-time owner/root configuration update; never used by GitHub Actions."""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

CONFIG = Path('/etc/elektrikamarket-preview')
STATE = Path('/var/lib/elektrikamarket-preview')
SECRETS = Path('/home/shopadmin/elektrikamarket-preview-shop-secrets')
PREVIEW = 'elektrikamarket-preview-preview-1'
PROTECTED = ['elektrikamarket-deploy-postgres-1', 'elektrikamarket-storefront-web-1', 'elektrikamarket-storefront-caddy-1']


def run(args, env=None):
    p = subprocess.run(args, capture_output=True, text=True, env=env, timeout=180)
    if p.returncode:
        raise RuntimeError('Command failed: ' + args[0])
    return p.stdout


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def updated(config):
    """Preserve existing policy, changing only the one preview service."""
    result = json.loads(json.dumps(config))
    if set(result['services']) != {'preview'}:
        raise ValueError('Unexpected Compose services')
    service = result['services']['preview']
    if service.get('ports') or service.get('user') != '1000:1000' or not service.get('read_only'):
        raise ValueError('Unexpected preview isolation policy')
    env = service.setdefault('environment', {})
    if env.get('STOREFRONT_DATABASE_ROLE') != 'storefront_preview_ro' or env.get('DATABASE_URL_FILE') != '/run/secrets/storefront_database_url':
        raise ValueError('Unexpected catalog configuration')
    if 'SHOP_DATABASE_URL' in env or 'SHOP_DATABASE_URL_FILE' in env:
        raise ValueError('SHOP already configured; review instead of overwriting')
    env.update(SHOP_DATABASE_URL_FILE='/run/secrets/preview_shop_database_url',
               PREVIEW_STAFF_BASIC_AUTH='1',
               PREVIEW_STAFF_MAP=json.dumps({'owner': 'owner@preview.invalid', 'developer': 'developer@preview.invalid'}))
    service.setdefault('secrets', []).append({'source': 'preview_shop_database_url', 'target': 'preview_shop_database_url'})
    service.setdefault('volumes', []).append({'type': 'bind', 'source': str(CONFIG / 'load-shop-secret.cjs'),
                                             'target': '/run/preview-shop/load-shop-secret.cjs', 'read_only': True})
    service['command'] = ['node', '--require', '/run/preview-shop/load-shop-secret.cjs', '/app/start.cjs']
    service['image'] = '${PREVIEW_IMAGE:?Immutable preview image required}'  # Preserve future automatic updates.
    result.setdefault('secrets', {})['preview_shop_database_url'] = {'file': str(CONFIG / 'shop_database_url')}
    return result


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run once in an interactive root SSH session; no sudo policy changes needed')
    os.umask(0o077)
    lock = open(STATE / 'deploy.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    before = {n: (inspect(n)['Id'], inspect(n)['State']['StartedAt']) for n in PROTECTED}
    current = inspect(PREVIEW)
    image = current['Config']['Image']
    if not re.fullmatch(r'ghcr.io/stron111-web/elektrikamarket-preview@sha256:[0-9a-f]{64}', image):
        raise ValueError('Unexpected preview image')
    env = {**os.environ, 'PREVIEW_IMAGE': image, 'PREVIEW_DATABASE_URL_FILE': str(CONFIG / 'database_url'),
           'PREVIEW_FRONTEND_NETWORK': 'elektrikamarket-storefront_frontend',
           'PREVIEW_DATABASE_NETWORK': 'elektrikamarket-deploy_default', 'COMPOSE_DISABLE_ENV_FILE': '1'}
    compose = ['docker', 'compose', '--project-name', 'elektrikamarket-preview', '--env-file', '/dev/null', '-f', str(CONFIG / 'compose.yaml')]
    backup = CONFIG / 'before-shared-shop'
    if sys.argv[1:] == ['--rollback']:
        if image != (backup / 'image').read_text().strip():
            raise ValueError('Preview code advanced since setup; review configuration-only rollback instead of reverting developer changes')
        shutil.copyfile(backup / 'compose.yaml', CONFIG / 'compose.yaml')
        env['PREVIEW_IMAGE'] = (backup / 'image').read_text().strip()
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'preview'], env)
        print('Preview configuration rolled back; shop data preserved')
        return
    if sys.argv[1:]:
        raise ValueError('No installation arguments accepted')
    revision = Path(__file__).with_name('expected-revision').read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{40}', revision) or current['Config']['Labels'].get('org.opencontainers.image.revision') != revision:
        raise ValueError('Expected reviewed preview image is not running yet')
    if backup.exists() or (CONFIG / 'shop_database_url').exists():
        raise ValueError('Initial installation already attempted; owner review required')
    config = json.loads(run(compose + ['config', '--format', 'json'], env))
    new_config = updated(config)
    # Read only metadata/URL validation in the existing loader; do not print the secret.
    from urllib.parse import urlsplit, parse_qs
    raw = (SECRETS / 'app_database_url').read_bytes()
    u = urlsplit(raw.decode().strip())
    if (u.hostname, u.port, u.path, u.username, parse_qs(u.query).get('schema')) != ('postgres', 5432, '/elektrikamarket_preview_shop', 'storefront_preview_shop_app', ['shop']):
        raise ValueError('Wrong shop secret target')
    backup.mkdir(mode=0o700)
    shutil.copyfile(CONFIG / 'compose.yaml', backup / 'compose.yaml')
    (backup / 'image').write_text(image + '\n')
    secret = os.open(CONFIG / 'shop_database_url', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    with os.fdopen(secret, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
        os.fchown(stream.fileno(), 1000, 1000)
    shutil.copyfile(Path(__file__).with_name('load-shop-secret.cjs'), CONFIG / 'load-shop-secret.cjs')
    os.chmod(CONFIG / 'load-shop-secret.cjs', 0o444)
    candidate = CONFIG / 'compose.shared-shop.candidate.json'
    candidate.write_text(json.dumps(new_config, indent=2) + '\n')
    run(compose[:-1] + [str(candidate), 'config', '--quiet'], env)
    os.replace(candidate, CONFIG / 'compose.yaml')
    try:
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'preview'], env)
        for user in ['owner', 'developer']:
            args = ['curl', '--silent', '--show-error', '--max-time', '30', '--config', '/home/shopadmin/elektrikamarket-storefront-secrets/' + user + '.curl']
            for route in ['/admin/clients', '/admin/orders', '/catalog']:
                body = run(args + ['--fail', 'https://preview.elektro-24.ru' + route])
                if route.startswith('/admin') and 'admin-nav' not in body:
                    raise RuntimeError('Staff access check failed')
        after = {n: (inspect(n)['Id'], inspect(n)['State']['StartedAt']) for n in PROTECTED}
        if before != after:
            raise RuntimeError('Protected container changed')
    except Exception:
        shutil.copyfile(backup / 'compose.yaml', CONFIG / 'compose.yaml')
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'preview'], env)
        raise RuntimeError('Preview-only configuration rollback completed; shop data preserved')
    print('SHARED_PREVIEW_ENABLED: owner/developer admin access checked; protected containers unchanged')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

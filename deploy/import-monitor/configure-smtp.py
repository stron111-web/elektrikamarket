#!/usr/bin/env python3
"""Owner runs interactively on VPS; never accepts a password through argv/stdin pipe."""
import getpass
import os
import pwd
from pathlib import Path
import sys
import warnings
from monitor import atomic


def main():
    os.umask(0o077)
    warnings.simplefilter('error', getpass.GetPassWarning)
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise ValueError('INTERACTIVE_TTY_REQUIRED')
    if pwd.getpwuid(os.getuid()).pw_name != 'shopadmin':
        raise ValueError('RUN_AS_SHOPADMIN')
    destination = Path('/home/shopadmin/elektrikamarket-import-monitor/private/smtp-password.json')
    if len(sys.argv) != 1:
        raise ValueError('NO_PASSWORD_ARGUMENTS_ALLOWED')
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    parent = destination.parent.lstat()
    if destination.parent.is_symlink() or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError('PRIVATE_DIRECTORY_REQUIRED')
    password = getpass.getpass('VK WorkMail application password (hidden): ')
    again = getpass.getpass('Repeat (hidden): ')
    if password != again or not password or any(ord(c) < 32 or ord(c) == 127 for c in password):
        raise ValueError('PASSWORD_CONFIRMATION_FAILED')
    atomic(destination, {'password': password})
    password = again = None
    print('SMTP_PASSWORD_SAVED_0600; no login or email was attempted')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('SMTP_PASSWORD_NOT_SAVED', file=sys.stderr)
        raise SystemExit(1)

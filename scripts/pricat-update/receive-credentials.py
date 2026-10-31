"""One-time SSH stdin receiver; no credentials in argv or output. Not an FTP job."""
import json
import os
import pathlib
import pwd
import stat
import sys


def private_directory(directory):
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise PermissionError("private directory required")


def prepare(directory):
    private_directory(directory)
    private_directory(directory / "downloads")
    target = directory / "ftp-credentials.json"
    if target.exists() or target.is_symlink():
        raise FileExistsError("credentials already exist; no overwrite")
    return target


def install(directory, payload):
    if len(payload) > 8192:
        raise ValueError("input limit")
    value = json.loads(payload.decode("utf-8"))
    if not isinstance(value, dict) or set(value) != {"username", "password"}:
        raise ValueError("fields")
    for text in value.values():
        if not isinstance(text, str) or not text or len(text) > 4096 or any(c in text for c in "\r\n\0"):
            raise ValueError("credential format")
    target = prepare(directory)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(target, flags, 0o600), "wb") as handle:
        handle.write((json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())
    parent = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
    return target


def main():
    os.umask(0o077)
    info = pathlib.Path(__file__).lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise PermissionError("receiver ownership")
    directory = pathlib.Path(pwd.getpwuid(os.getuid()).pw_dir) / "elektrikamarket-pricat-inputs"
    if sys.argv[1:] == ["--prepare"]:
        prepare(directory)
        print("CREDENTIALS_READY")
    elif not sys.argv[1:]:
        install(directory, sys.stdin.buffer.read(8193))
        print("CREDENTIALS_SAVED")
    else:
        raise ValueError("arguments")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # JSON decoder, filesystem and connection errors must not echo the payload.
        print("CREDENTIALS_NOT_INSTALLED", file=sys.stderr)
        sys.exit(1)

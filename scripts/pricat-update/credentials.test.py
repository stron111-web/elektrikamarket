"""Synthetic credentials only; private temporary directories, never the VPS."""
import importlib.util
import json
import os
import pathlib
import stat
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("receiver", pathlib.Path(__file__).with_name("receive-credentials.py"))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pricat-credential-fixture-")
        self.base = pathlib.Path(self.tmp.name) / "private"
        self.value = {"username": "fixture-user", "password": "fixture Unicode: Тест + quote \" slash \\"}
        self.payload = json.dumps(self.value, ensure_ascii=False).encode("utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_private_utf8_install_and_no_overwrite(self):
        target = receiver.install(self.base, self.payload)
        self.assertEqual(json.loads(target.read_text(encoding="utf-8")), self.value)
        self.assertEqual(stat.S_IMODE(self.base.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.base / "downloads").stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        with self.assertRaises(FileExistsError):
            receiver.install(self.base, b'{"username":"different","password":"synthetic"}')
        self.assertEqual(target.read_bytes(), (json.dumps(self.value, ensure_ascii=False) + "\n").encode("utf-8"))

    def test_reject_public_directory_and_symlink(self):
        self.base.mkdir(mode=0o755)
        with self.assertRaises(PermissionError):
            receiver.install(self.base, self.payload)
        self.base.rmdir()
        self.base.symlink_to(pathlib.Path(self.tmp.name), target_is_directory=True)
        with self.assertRaises(PermissionError):
            receiver.install(self.base, self.payload)

    def test_reject_bad_or_oversized_payload_without_creating_secret(self):
        for payload in [b"invalid fixture", b"x" * 8193, b"{}", b'{"username":"a","password":""}', b'{"username":"a","password":"a\\nb"}']:
            with self.assertRaises((ValueError, UnicodeDecodeError)):
                receiver.install(self.base, payload)
            self.assertFalse((self.base / "ftp-credentials.json").exists())

    def test_refuse_existing_secret_symlink(self):
        receiver.prepare(self.base)
        other = pathlib.Path(self.tmp.name) / "other"
        other.write_text("synthetic sentinel")
        (self.base / "ftp-credentials.json").symlink_to(other)
        with self.assertRaises(FileExistsError):
            receiver.install(self.base, self.payload)
        self.assertEqual(other.read_text(), "synthetic sentinel")


if __name__ == "__main__":
    unittest.main()

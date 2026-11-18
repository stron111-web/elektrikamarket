import json
import os
from pathlib import Path
import smtplib
import tempfile
import unittest
from unittest.mock import patch
import monitor as m
import supervisor as s


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state_path = self.root / 'state.json'
        self.password_path = self.root / 'password.json'
        m.atomic(self.password_path, {'password': 'fixture-only-not-a-real-secret'})
        self.config = {'mailEnabled': True, 'smtp': {'host': 'smtp.mail.ru', 'port': 465,
            'username': m.SENDER, 'sender': m.SENDER, 'recipient': m.RECIPIENT,
            'passwordFile': str(self.password_path)}}
        self.state = {}
        m.transition(self.state, 'PRICAT', 'NO_PROGRESS', 100, 90)

    def client(self, failure=None):
        class Fake:
            sent = 0
            def __init__(self, host, port, timeout, context):
                assert host == 'smtp.mail.ru' and port == 465 and context.check_hostname
                assert timeout == 20
            def set_debuglevel(self, level): assert level == 0
            def login(self, username, password):
                assert username == m.SENDER and password == 'fixture-only-not-a-real-secret'
                if failure == 'auth': raise smtplib.SMTPAuthenticationError(535, b'fixture')
            def send_message(self, message, from_addr, to_addrs):
                Fake.sent += 1
                assert from_addr == m.SENDER and to_addrs == [m.RECIPIENT]
                assert 'fixture-only-not-a-real-secret' not in message.as_string()
                if failure == 'unknown': raise OSError('fixture transport failed after DATA')
                return {}
            def close(self): pass
        return Fake

    def test_private_file_permissions_and_symlink(self):
        self.assertEqual(self.password_path.stat().st_mode & 0o777, 0o600)
        self.password_path.chmod(0o644)
        with self.assertRaises(ValueError): m.private_json(self.password_path)
        link = self.root / 'link'; link.symlink_to(self.password_path)
        with self.assertRaises(OSError): m.private_json(link)

    def test_no_mail_for_unchanged_success(self):
        state = {}
        for _ in range(10): m.transition(state, 'PRICAT', 'OK', 100, 100)
        self.assertEqual(state['outbox'], [])
        for status in ['NO_REMOTE_CHANGE', 'UNCHANGED_VERIFIED']:
            self.assertIn(status, m.SUCCESS)

    def test_one_incident_one_recovery_and_new_incident(self):
        for code in ['IMPORT_ERROR', 'CHECK_OVERDUE', 'NO_PROGRESS']:
            m.transition(self.state, 'PRICAT', code, 101, 90)
        self.assertEqual(len(self.state['outbox']), 1)
        m.transition(self.state, 'PRICAT', 'OK', 102, 102)
        m.transition(self.state, 'PRICAT', 'OK', 103, 103)
        self.assertEqual([x['kind'] for x in self.state['outbox']], ['INCIDENT', 'RECOVERED'])
        m.transition(self.state, 'PRICAT', 'IMPORT_ERROR', 104, 103)
        self.assertEqual(len(self.state['outbox']), 3)

    def test_tls_auth_and_once_only_delivery(self):
        fake = self.client()
        self.assertEqual(m.deliver_one(self.state, self.config, self.state_path, 101, fake), 'SMTP_ACCEPTED')
        self.assertEqual(m.deliver_one(self.state, self.config, self.state_path, 102, fake), 'NO_PENDING_MAIL')
        self.assertEqual(fake.sent, 1)
        self.assertNotIn('fixture-only', self.state_path.read_text())

    def test_auth_error_backoff_without_leaking_exception(self):
        fake = self.client('auth')
        self.assertEqual(m.deliver_one(self.state, self.config, self.state_path, 101, fake), 'SMTP_FAILED')
        self.assertEqual(self.state['outbox'][0]['nextAttemptAt'], 1001)
        self.assertEqual(m.deliver_one(self.state, self.config, self.state_path, 102, fake), 'NO_PENDING_MAIL')
        self.assertNotIn('535', self.state_path.read_text())

    def test_uncertain_delivery_is_not_repeated(self):
        fake = self.client('unknown')
        self.assertEqual(m.deliver_one(self.state, self.config, self.state_path, 101, fake), 'SMTP_DELIVERY_UNKNOWN')
        self.assertEqual(m.deliver_one(self.state, self.config, self.state_path, 2000, fake), 'NO_PENDING_MAIL')
        self.assertEqual(fake.sent, 1)

    def test_crash_after_data_is_not_repeated(self):
        self.state['outbox'][0]['status'] = 'SENDING'
        fake = self.client()
        self.assertEqual(m.deliver_one(self.state, self.config, self.state_path, 2000, fake), 'NO_PENDING_MAIL')
        self.assertEqual(fake.sent, 0)
        self.assertEqual(self.state['outbox'][0]['status'], 'DELIVERY_UNKNOWN')

    def test_disabled_does_not_open_password_or_network(self):
        self.config['mailEnabled'] = False
        self.password_path.unlink()
        with patch.object(m.smtplib, 'SMTP_SSL', side_effect=AssertionError('network')):
            self.assertEqual(m.deliver_one(self.state, self.config, self.state_path, 101), 'MAIL_DISABLED')

    def test_fixed_endpoint_and_recipient(self):
        self.config['smtp']['host'] = 'other.invalid'
        with self.assertRaises(ValueError):
            m.deliver_one(self.state, self.config, self.state_path, 101, self.client())

    def test_health_error_hang_overdue_recovery(self):
        limits = {'maxRunSeconds': 90, 'stallSeconds': 15, 'intervalSeconds': 100, 'graceSeconds': 10}
        state = {'needsReview': False, 'running': False, 'lastSuccess': 100, 'lastError': None}
        self.assertEqual(m.health(state, 101, limits), 'OK')
        self.assertEqual(m.health(state, 211, limits), 'CHECK_OVERDUE')
        self.assertEqual(m.health({**state, 'lastError': 101}, 102, limits), 'IMPORT_ERROR')
        self.assertEqual(m.health({**state, 'running': True, 'started': 100, 'progress': 100}, 116, limits), 'NO_PROGRESS')
        self.assertEqual(m.health({**state, 'running': True, 'started': 1, 'progress': 100}, 116, limits), 'JOB_DEADLINE')
        self.assertEqual(m.health({**state, 'needsReview': True}, 101, limits), 'PUBLICATION_NEEDS_REVIEW')

    def test_controller_repeated_heartbeat_is_not_progress(self):
        old = s.progress({}, {'status': 'PROGRESS', 'phase': 'parse', 'records': 1}, 100)
        same = s.progress(old, {'status': 'PROGRESS', 'phase': 'parse', 'records': 1}, 110)
        self.assertEqual(old['lastProgressAt'], same['lastProgressAt'])
        changed = s.progress(old, {'status': 'PROGRESS', 'phase': 'parse', 'records': 2}, 111)
        self.assertNotEqual(old['lastProgressAt'], changed['lastProgressAt'])


if __name__ == '__main__': unittest.main()

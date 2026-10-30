import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('preview', Path(__file__).resolve().parents[1] / 'deployer.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)
A = preview.record('a'*40, 'sha256:'+'1'*64)
B = preview.record('b'*40, 'sha256:'+'2'*64)
C = preview.record('c'*40, 'sha256:'+'3'*64)


class Safety(unittest.TestCase):
    def test_stdin_only_accepts_commit_and_digest(self):
        value = (B['revision']+' '+B['digest']).encode()
        self.assertEqual(preview.request(value), B)
        self.assertEqual(preview.request(value+b'\n'), B)
        for wrong in [b'', b'rollback', b'bash', b'latest', value+b';id', value+b'\nrollback',
                      value+b'\n\n', b'deploy '+value, value.upper(), value+b' extra']:
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                preview.request(wrong)

    def test_rejects_mutable_or_foreign_image_arguments(self):
        for revision, digest in [('main', A['digest']), (A['revision'], 'latest'),
                                 (A['revision'], 'evil.example/x@'+A['digest']), (None, A['digest'])]:
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                preview.record(revision, digest)

    def test_no_caller_environment_or_test_secret_in_privileged_commands(self):
        with patch.dict(os.environ, {'DOCKER_HOST':'tcp://evil', 'COMPOSE_FILE':'/tmp/evil', 'PYTHONPATH':'/tmp'}):
            helper = preview.Deployer()
        self.assertEqual(helper.environment['DOCKER_HOST'], 'unix:///var/run/docker.sock')
        self.assertNotIn('COMPOSE_FILE', helper.environment)
        self.assertNotIn('PYTHONPATH', helper.environment)
        self.assertEqual(helper.environment['PREVIEW_DATABASE_URL_FILE'], '/etc/elektrikamarket-preview/database_url')
        self.assertNotIn('storefront-secrets', str(helper.environment))

    def test_fixed_project_service_and_no_env_file(self):
        helper = preview.Deployer()
        helper.run = Mock()
        helper.compose(A, 'up', '-d', '--no-deps', 'preview')
        args = helper.run.call_args.args[0]
        self.assertEqual(args[:4], ['/usr/bin/docker','compose','--project-name','elektrikamarket-preview'])
        self.assertIn('/dev/null', args)
        self.assertIn('/etc/elektrikamarket-preview/compose.yaml', args)
        for service in ['web', 'caddy', 'postgres']:
            self.assertNotIn(service, args)

    def test_root_policy_rejects_symlink_and_group_writes(self):
        file = Path('/fixed/policy')
        for mode, uid, accepted in [
            (preview.stat.S_IFREG | 0o644, 0, True),
            (preview.stat.S_IFREG | 0o666, 0, False),
            (preview.stat.S_IFLNK | 0o777, 0, False),
            (preview.stat.S_IFREG | 0o644, 1000, False),
        ]:
            info = Mock(st_mode=mode, st_uid=uid)
            with self.subTest(mode=mode, uid=uid), patch.object(Path, 'lstat', return_value=info):
                if accepted:
                    preview.protected(file)
                else:
                    with self.assertRaises(ValueError):
                        preview.protected(file)

    def test_branch_and_image_identity(self):
        helper = preview.Deployer()
        helper.run = Mock(return_value=B['revision']+'\t'+preview.BRANCH)
        self.assertEqual(helper.head(), B['revision'])
        helper.run.return_value = B['revision']+'\trefs/heads/main'
        with self.assertRaises(ValueError):
            helper.head()
        labels = {'org.opencontainers.image.revision':B['revision'],
                  'org.opencontainers.image.source':preview.REPOSITORY,
                  'org.opencontainers.image.ref.name':preview.BRANCH}
        helper.run.return_value = json.dumps(labels)
        helper.prepare(B)
        for key in labels:
            helper.run.return_value = json.dumps({**labels,key:'wrong'})
            with self.subTest(key=key), self.assertRaises(ValueError):
                helper.prepare(B)

    def test_checks_internal_catalog_and_external_https_401_without_auth_passwords(self):
        helper = preview.Deployer()
        helper.compose = Mock()
        helper.run = Mock(return_value='401')
        helper.verify(B)
        self.assertIn('exec', helper.compose.call_args.args)
        self.assertIn('http://127.0.0.1:3000/catalog', helper.compose.call_args.args[-1])
        for call in helper.run.call_args_list:
            args = call.args[0]
            self.assertTrue(args[-1].startswith(preview.HOST))
            for forbidden in ['--config', '--user', '--insecure']:
                self.assertNotIn(forbidden, args)
        helper.run.return_value = '200'
        with self.assertRaises(RuntimeError):
            helper.verify(B)

    def test_sudo_arguments_do_not_accept_remote_rollback(self):
        with patch.object(preview.os,'geteuid',return_value=0):
            for args in [['deploy','x'], ['bash'], ['rollback','extra']]:
                with self.subTest(args=args), self.assertRaises(ValueError):
                    preview.main(args)


class Deployment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = Path(self.temp.name)
        self.helper = preview.Deployer(path,path)
        self.helper.head = Mock(return_value=B['revision'])
        self.helper.prepare = Mock()
        self.helper.start = Mock()
        self.helper.verify = Mock()
        self.helper.compose = Mock()

    def test_success_and_idempotency_keep_previous(self):
        self.helper.save(A,None)
        self.helper.deploy(B)
        self.assertEqual(self.helper.saved(), {'current':B,'previous':A})
        self.helper.deploy(B)
        self.assertEqual(self.helper.saved(), {'current':B,'previous':A})
        self.assertEqual(sorted(p.name for p in self.helper.state.iterdir()), ['images.json'])

    def test_stale_head_never_starts_or_pulls(self):
        self.helper.head.return_value = C['revision']
        with self.assertRaises(ValueError):
            self.helper.deploy(B)
        self.helper.prepare.assert_not_called()
        self.helper.start.assert_not_called()

    def test_advanced_head_after_pull_never_starts(self):
        self.helper.head.side_effect = [B['revision'],C['revision']]
        with self.assertRaises(ValueError):
            self.helper.deploy(B)
        self.helper.start.assert_not_called()

    def test_registry_failure_preserves_current(self):
        self.helper.save(A,None)
        self.helper.prepare.side_effect = RuntimeError('registry')
        with self.assertRaises(RuntimeError):
            self.helper.deploy(B)
        self.helper.start.assert_not_called()
        self.assertEqual(self.helper.saved()['current'], A)

    def test_failure_restores_cached_verified_preview(self):
        self.helper.save(A,None)
        self.helper.verify.side_effect = [RuntimeError('catalog'),None]
        with self.assertRaisesRegex(RuntimeError,'previous preview restored'):
            self.helper.deploy(B)
        self.assertEqual([c.args for c in self.helper.start.call_args_list], [(B,),(A,)])
        self.assertEqual(self.helper.saved(), {'current':A,'previous':None})

    def test_first_failure_stops_only_preview(self):
        self.helper.verify.side_effect = RuntimeError('catalog')
        with self.assertRaises(RuntimeError):
            self.helper.deploy(B)
        self.helper.compose.assert_called_once_with(B,'stop','--timeout','10','preview')
        self.assertEqual(self.helper.saved()['current'], None)

    def test_failed_rollback_preserves_known_references(self):
        self.helper.save(A,None)
        self.helper.verify.side_effect = RuntimeError('failure')
        with self.assertRaisesRegex(RuntimeError,'rollback failed'):
            self.helper.deploy(B)
        self.assertEqual(self.helper.saved()['current'], A)

    def test_owner_rollback_uses_local_image(self):
        self.helper.save(B,A)
        self.helper.rollback()
        self.helper.prepare.assert_called_once_with(A,pull=False)
        self.assertEqual(self.helper.saved(), {'current':A,'previous':B})

    def test_no_previous_is_not_an_automatic_repair(self):
        with self.assertRaises(ValueError):
            self.helper.rollback()
        self.helper.start.assert_not_called()

    def test_invalid_references_never_start(self):
        (self.helper.state/'images.json').write_text('{"current":{"revision":"main","digest":"latest"},"previous":null}')
        with self.assertRaises(ValueError):
            self.helper.deploy(B)
        self.helper.start.assert_not_called()

    def test_parallel_invocation_is_rejected(self):
        path = self.helper.state
        (path/'compose.yaml').write_text('fixed')
        with (path/'deploy.lock').open('a') as held:
            preview.fcntl.flock(held,preview.fcntl.LOCK_EX|preview.fcntl.LOCK_NB)
            with patch.object(preview,'CONFIG',path),patch.object(preview,'STATE',path), patch.object(preview.os,'geteuid',return_value=0), patch.object(preview,'protected'), \
                 patch.object(preview.sys,'stdin',Mock(buffer=io.BytesIO((B['revision']+' '+B['digest']).encode()))), \
                 patch.object(preview.signal,'alarm'),patch.object(preview,'Deployer') as cls:
                with self.assertRaises(BlockingIOError):
                    preview.main([])
                cls.assert_not_called()


if __name__=='__main__':
    unittest.main()

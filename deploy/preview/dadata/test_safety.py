import ast,importlib.util,json,os
from pathlib import Path
import sys,tempfile,types,unittest
from unittest.mock import Mock,patch

# Tests run on Windows too; production uses Ubuntu's real flock/resource modules.
for name,values in [('fcntl',dict(LOCK_EX=2,LOCK_NB=4,flock=lambda *a:None)),
                    ('resource',dict(RLIMIT_CORE=4,setrlimit=lambda *a:None))]:
    try:__import__(name)
    except ModuleNotFoundError:sys.modules[name]=types.SimpleNamespace(**values)
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('dadata_owner',ROOT/'manager.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PAIR={'DADATA_API_KEY':'fixture-api-never-real','DADATA_SECRET_KEY':'fixture-secret-never-real'}
CURRENT={'revision':'a'*40,'digest':'sha256:'+'1'*64}
def compose():return {'services':{'preview':{'image':'${PREVIEW_IMAGE}', 'user':'1000:1000','read_only':True,
 'environment':{'CDEK_CREDENTIALS_FILE':'/run/secrets/preview_cdek_credentials','EXISTING':'unchanged'},
 'command':['node','--require','/run/preview-cdek/load-cdek-secret.cjs','--require','/run/preview-shop/load-shop-secret.cjs','/app/start.cjs'],
 'secrets':['cdek','db'],'volumes':['/existing:/run/preview-cdek/load-cdek-secret.cjs:ro'],'networks':{'database':{}}}},
 'secrets':{'cdek':{'file':'/fixed/cdek'},'db':{'file':'/fixed/db'}},'networks':{'database':{'external':True}}}

class Safety(unittest.TestCase):
    def test_only_two_dadata_variables_and_bounded_printable_values(self):
        self.assertEqual(m.pair(PAIR),PAIR)
        for value in [dict(PAIR,CDEK_ACCOUNT='forbidden'),dict(PAIR,DADATA_API_KEY='x\ny'),dict(PAIR,DADATA_SECRET_KEY='x'*513),{}]:
            with self.assertRaises(ValueError):m.pair(value)

    def test_attach_preserves_cdek_image_networks_and_is_idempotent(self):
        original=compose();unchanged=json.dumps(original,sort_keys=True);result=m.attach(original)
        self.assertEqual(json.dumps(original,sort_keys=True),unchanged)
        self.assertEqual(result['services']['preview']['image'],original['services']['preview']['image'])
        self.assertEqual(result['services']['preview']['environment']['CDEK_CREDENTIALS_FILE'],original['services']['preview']['environment']['CDEK_CREDENTIALS_FILE'])
        self.assertEqual(result['secrets']['cdek'],original['secrets']['cdek'])
        self.assertEqual(result['networks'],original['networks'])
        self.assertTrue(all(v in result['services']['preview']['volumes'] for v in original['services']['preview']['volumes']))
        self.assertEqual(m.attach(result),result)

    def test_inline_credentials_or_extra_service_rejected(self):
        for change in ['inline','extra','ports']:
            c=compose()
            if change=='inline':c['services']['preview']['environment']['DADATA_API_KEY']='forbidden'
            if change=='extra':c['services']['test']={}
            if change=='ports':c['services']['preview']['ports']=['3000:3000']
            with self.assertRaises(ValueError):m.attach(c)

    def test_unsafe_image_stops_before_hidden_input(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(m,'STATE',Path(folder)),patch.object(m,'DATA',Path(folder)),\
             patch.object(m,'trusted'),patch.object(m.os,'geteuid',return_value=0,create=True),\
             patch.object(m.sys,'argv',['manager','set']),patch.object(m.sys,'stdin',Mock(isatty=lambda:True)),\
             patch.object(m.sys,'stdout',Mock(isatty=lambda:True)),patch.object(m,'helper'),\
             patch.object(m,'safe_image',side_effect=ValueError('unsafe_image')),patch.object(m.getpass,'getpass') as read,\
             patch.dict(os.environ,{},clear=False):
            with self.assertRaisesRegex(ValueError,'unsafe_image'):m.main()
            read.assert_not_called()

    def test_rejected_keys_never_change_config_or_restart(self):
        h=Mock()
        with tempfile.TemporaryDirectory() as folder,patch.object(m,'STATE',Path(folder)),patch.object(m,'helper',return_value=h),\
             patch.object(m,'safe_image',return_value=CURRENT),patch.object(m,'check_keys',return_value={'accepted':False}),patch.object(m,'atomic') as write:
            with self.assertRaisesRegex(ValueError,'dadata_keys_or_lookup_rejected'):m.set_keys(PAIR)
            write.assert_not_called();h.start.assert_not_called()

    def test_failed_refresh_restores_only_settings_using_same_current_image(self):
        h=Mock();h.start.side_effect=[RuntimeError('failure'),None]
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'compose.yaml').write_text(json.dumps(compose()))
            with patch.object(m,'STATE',root),patch.object(m,'CONFIG',root),patch.object(m,'ACTIVE',root/'keys.json'),\
                 patch.object(m,'LOADER',root/'loader.cjs'),patch.object(m,'helper',return_value=h),\
                 patch.object(m,'safe_image',return_value=CURRENT),patch.object(m,'check_keys',return_value={'accepted':True}),\
                 patch.object(m,'protected',return_value={}),patch.object(m,'frame',return_value={}),patch.object(m,'run',return_value='fixture-cron'),\
                 patch.object(m,'snapshot',return_value=root/'backup'),patch.object(m,'atomic') as write,\
                 patch.object(m,'restore_files') as restore,patch.object(m,'confirm_unchanged'):
                with self.assertRaisesRegex(ValueError,'previous_preview_settings_restored'):m.set_keys(PAIR)
                restore.assert_called_once_with(root/'backup')
                self.assertEqual(h.start.call_count,2)
                for call in h.start.call_args_list:self.assertEqual(call.args,(CURRENT,));self.assertEqual(call.kwargs,{'force_recreate':True})
                h.save.assert_not_called()
                targets={call.args[0] for call in write.call_args_list}
                self.assertEqual(targets,{root/'keys.json',root/'loader.cjs',root/'compose.yaml'})
                loader=next(c for c in write.call_args_list if c.args[0]==root/'loader.cjs')
                self.assertTrue(loader.kwargs['public'])

    def test_partial_file_write_failure_also_restores_previous_settings(self):
        h=Mock()
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'compose.yaml').write_text(json.dumps(compose()))
            with patch.object(m,'STATE',root),patch.object(m,'CONFIG',root),patch.object(m,'ACTIVE',root/'keys.json'),\
                 patch.object(m,'LOADER',root/'loader.cjs'),patch.object(m,'helper',return_value=h),\
                 patch.object(m,'safe_image',return_value=CURRENT),patch.object(m,'check_keys',return_value={'accepted':True}),\
                 patch.object(m,'protected',return_value={}),patch.object(m,'frame',return_value={}),patch.object(m,'run',return_value='fixture-cron'),\
                 patch.object(m,'snapshot',return_value=root/'backup'),patch.object(m,'atomic',side_effect=[None,OSError('fixture disk failure')]),\
                 patch.object(m,'restore_files') as restore,patch.object(m,'confirm_unchanged'):
                with self.assertRaisesRegex(ValueError,'previous_preview_settings_restored'):m.set_keys(PAIR)
                restore.assert_called_once_with(root/'backup');h.start.assert_called_once_with(CURRENT,force_recreate=True)
                h.save.assert_not_called()

    def test_bootstrap_adds_logging_defaults_without_sudo_permission_or_service_start(self):
        tree=ast.parse((ROOT/'bootstrap.py').read_text())
        value=next(n.value.value for n in ast.walk(tree) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='policy' for t in n.targets))
        self.assertIn(b'!log_input, !log_output',value);self.assertNotIn(b'NOPASSWD',value);self.assertNotIn(b'ALL=',value)
        self.assertFalse(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ['start','deploy','rollback'] for n in ast.walk(tree)))

if __name__=='__main__':unittest.main()

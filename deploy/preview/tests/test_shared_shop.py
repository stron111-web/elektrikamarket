import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('shared_shop', Path(__file__).parents[1] / 'enable-shared-shop.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SharedShopPolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = {'services': {'preview': {'image': 'old', 'user': '1000:1000', 'read_only': True,
                      'cap_drop': ['ALL'], 'mem_limit': '512m', 'networks': {'database': {}, 'frontend': {}},
                      'environment': {'STOREFRONT_DATABASE_ROLE': 'storefront_preview_ro',
                                      'DATABASE_URL_FILE': '/run/secrets/storefront_database_url'},
                      'secrets': [{'source': 'storefront_database_url', 'target': 'storefront_database_url'}]}},
                       'secrets': {'storefront_database_url': {'file': '/etc/catalog'}},
                       'networks': {'database': {'external': True}, 'frontend': {'external': True}}}

    def test_only_preview_gets_app_secret_and_future_image_placeholder(self):
        original = copy.deepcopy(self.config)
        result = module.updated(self.config)
        self.assertEqual(self.config, original)
        service = result['services']['preview']
        self.assertIn('${PREVIEW_IMAGE', service['image'])
        self.assertEqual(result['networks'], original['networks'])
        self.assertEqual(result['secrets']['storefront_database_url'], original['secrets']['storefront_database_url'])
        for key in ['user', 'read_only', 'cap_drop', 'mem_limit', 'networks']:
            self.assertEqual(service[key], original['services']['preview'][key])
        self.assertNotIn('SHOP_DATABASE_URL', service['environment'])
        self.assertNotIn('migration_database_url', str(result))
        self.assertEqual(service['environment']['PREVIEW_STAFF_BASIC_AUTH'], '1')

    def test_refuses_exposed_port_or_different_role_or_extra_service(self):
        for kind in ['port', 'role', 'service']:
            config = copy.deepcopy(self.config)
            if kind == 'port':
                config['services']['preview']['ports'] = ['3000:3000']
            elif kind == 'role':
                config['services']['preview']['environment']['STOREFRONT_DATABASE_ROLE'] = 'storefront_test_ro'
            else:
                config['services']['postgres'] = {}
            with self.assertRaises(ValueError):
                module.updated(config)

    def test_no_second_initial_install(self):
        with self.assertRaises(ValueError):
            module.updated(module.updated(self.config))

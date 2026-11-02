"""Offline credential validation tests. No real keys, network, files or services."""
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec=importlib.util.spec_from_file_location('installer',Path(__file__).resolve().parents[1]/'install-openai-admin-key-test.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)

class InstallerTests(unittest.TestCase):
    def test_bad_format_never_sends(self):
        with patch.object(installer.urllib.request,'build_opener',side_effect=AssertionError('Network forbidden')):
            for key in ('','too-short','a'*20+'\nsecret'):
                with self.assertRaises(ValueError):installer.validate_key(key)

    def test_success_only_reads_costs(self):
        class Opener:
            def open(self,request,timeout):
                self_check.assertEqual(request.get_method(),'GET')
                self_check.assertTrue(request.full_url.startswith('https://api.openai.com/v1/organization/costs?'))
                self_check.assertEqual(timeout,15)
                return io.BytesIO(b'{"data":[],"has_more":false}')
        self_check=self
        with patch.object(installer.urllib.request,'build_opener',return_value=Opener()):installer.validate_key('synthetic-test-key-not-real')

    def test_rejected_key_error_has_no_provider_body(self):
        class Opener:
            def open(self,*args,**kwargs):raise urllib.error.HTTPError('https://api.openai.com',403,'synthetic-sensitive-detail',{},io.BytesIO(b'secret'))
        with patch.object(installer.urllib.request,'build_opener',return_value=Opener()):
            with self.assertRaisesRegex(ValueError,'HTTP 403') as result:installer.validate_key('synthetic-test-key-not-real')
            self.assertNotIn('sensitive',str(result.exception));self.assertNotIn('secret',str(result.exception))

    def test_wrong_pc_fails_before_service_access(self):
        with patch.object(installer.socket,'gethostname',return_value='slr'),patch.object(installer.subprocess,'check_output',side_effect=AssertionError('No service inspection')):
            with self.assertRaisesRegex(ValueError,'TEST-only'):installer.main()

if __name__=='__main__':unittest.main()

"""Production transaction pure guards only: no service/GPU/database mutations."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('private_activation',Path(__file__).resolve().parents[1]/'scripts/deploy/activate-private-media-prod.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class Guards(unittest.TestCase):
    def test_root_config_protects_keys_without_mutating_native_configuration(self):
        original={'python':'/usr/bin/python3','transports':{'rtx3090':{'identityFile':'/operator/key','knownHostsFile':'/operator/hosts'}}}
        result=module.controller_config(original,Path('/root-owned/controller'))
        self.assertEqual(result['transports']['rtx3090']['identityFile'],'/root-owned/controller/keys/rtx3090.key')
        self.assertEqual(original['transports']['rtx3090']['identityFile'],'/operator/key')
    def test_only_explicit_media_settings_may_change(self):
        before={'OTG_ENV':'prod','PORT':'3000','AUTH_SECRET':'fixture-not-a-secret','OTG_OWNER_APPROVAL':'unchanged','ADMIN_ROLE':'unchanged'}
        flags={key:'fixture' for key in module.FEATURE_KEYS}
        after={**before,**flags};module.preserve_environment(before,after,flags)
        for key in ('AUTH_SECRET','OTG_OWNER_APPROVAL','ADMIN_ROLE'):
            with self.assertRaises(RuntimeError):module.preserve_environment(before,{**after,key:'modified'},flags)
        with self.assertRaises(RuntimeError):module.preserve_environment(before,{**after,'AUTH_REQUIRE_CHECKBOX':'1'},flags)
        with self.assertRaises(RuntimeError):module.preserve_environment(before,{**after,'OTG_ENV':'test'},flags)

    def test_active_and_unknown_jobs_are_never_reconciled_or_deleted(self):
        for status in ('queued','running','unknown',None):
            with self.subTest(status=status),tempfile.TemporaryDirectory() as directory:
                data=Path(directory);queue=data/'media-gpu-queue/queue.sqlite';queue.parent.mkdir()
                with sqlite3.connect(queue) as db:db.execute('CREATE TABLE media_jobs(status TEXT)');db.execute('INSERT INTO media_jobs VALUES(?)',(status,))
                with self.assertRaises(RuntimeError):module.extra_idle(data,{'runtime':{'script':str(data/'authority/helper.py')}})
                with sqlite3.connect(queue) as db:self.assertEqual(db.execute('SELECT status FROM media_jobs').fetchone()[0],status)

    def test_shared_authority_blocks_activation_without_changing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            data=Path(directory);authority=data/'authority';authority.mkdir();ledger=authority/'admission.sqlite'
            with sqlite3.connect(ledger) as db:db.execute('CREATE TABLE grants(token INTEGER)');db.execute('INSERT INTO grants VALUES(123)')
            with self.assertRaises(RuntimeError):module.extra_idle(data,{'runtime':{'script':str(authority/'helper.py')}})
            with sqlite3.connect(ledger) as db:self.assertEqual(db.execute('SELECT token FROM grants').fetchone()[0],123)

    def test_pending_release_blocks_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            data=Path(directory);queue=data/'media-gpu-queue/queue.sqlite';queue.parent.mkdir()
            with sqlite3.connect(queue) as db:db.execute('CREATE TABLE media_jobs(status TEXT,admissionToken INTEGER)');db.execute("INSERT INTO media_jobs VALUES('completed',123)")
            with self.assertRaises(RuntimeError):module.extra_idle(data,{'runtime':{'script':str(data/'helper.py')}})

    def test_idle_ledger_and_completed_jobs_are_allowed(self):
        with tempfile.TemporaryDirectory() as directory:
            data=Path(directory);ledger=data/'admission.sqlite'
            with sqlite3.connect(ledger) as db:db.execute('CREATE TABLE grants(token INTEGER)')
            module.extra_idle(data,{'runtime':{'script':str(data/'helper.py')}})


if __name__=='__main__':unittest.main()

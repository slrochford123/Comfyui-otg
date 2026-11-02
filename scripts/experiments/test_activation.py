"""Offline checks only: never call a real service, change a live pointer or submit work."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('lab_activation',Path(__file__).with_name('activate-test.py'))
activation=importlib.util.module_from_spec(spec);spec.loader.exec_module(activation)

class ExperimentActivationTests(unittest.TestCase):
    def test_refuses_nonroot_before_reading_plan(self):
        with patch.object(activation.os,'geteuid',return_value=1000),patch.object(activation,'command',side_effect=AssertionError('No service calls')):
            with self.assertRaisesRegex(ValueError,'sudo'):activation.main()

    def test_refuses_other_host_even_as_root(self):
        with patch.object(activation.os,'geteuid',return_value=0),patch.object(activation.socket,'gethostname',return_value='slr'),patch.object(activation,'command',side_effect=AssertionError('No service calls')):
            with self.assertRaisesRegex(ValueError,'shawn'):activation.main()

    def test_stale_pointer_never_restarts_service(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);test=root/'test';releases=test/'releases';releases.mkdir(parents=True)
            previous=releases/'test3001-old';candidate=releases/'test3001-new';unexpected=releases/'test3001-other'
            for item in (previous,candidate,unexpected):item.mkdir()
            (test/'current').symlink_to(unexpected)
            (root/'activation-plan.json').write_text(json.dumps({'candidate':str(candidate),'previous':str(previous),'files':[],'helpers':[]}))
            with patch.object(activation,'ROOT',root),patch.object(activation,'TEST',test),patch.object(activation,'verify_plan'),patch.object(activation.os,'geteuid',return_value=0),patch.object(activation.socket,'gethostname',return_value='shawn'),patch.object(activation.sys,'argv',['activate-test.py']),patch.object(activation,'command',side_effect=AssertionError('No service calls')):
                with self.assertRaisesRegex(ValueError,'pointer changed'):activation.main()
            self.assertEqual((test/'current').resolve(),unexpected)

    def test_modified_file_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);test=root/'test';releases=test/'releases';releases.mkdir(parents=True)
            previous=releases/'test3001-old';candidate=releases/'test3001-new';previous.mkdir();candidate.mkdir()
            item=candidate/'server.js';item.write_text('original');checksum=activation.digest(item);item.write_text('changed')
            plan={'candidate':str(candidate),'previous':str(previous),'files':[{'file':'server.js','sha256':checksum}],'helpers':[]}
            with patch.object(activation,'ROOT',root),patch.object(activation,'TEST',test):
                with self.assertRaisesRegex(ValueError,'Pinned file changed'):activation.verify_plan(plan)

    def test_prod_boundary_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);prod=root/'prod-build';prod.mkdir()
            plan={'candidate':str(prod),'previous':str(prod),'files':[],'helpers':[]}
            with self.assertRaisesRegex(ValueError,'TEST release boundary'):activation.verify_plan(plan)

    def test_superseded_candidate_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);candidate=root/'test3001-new';candidate.mkdir()
            (candidate/'DO_NOT_ACTIVATE').write_text('Superseded')
            with self.assertRaisesRegex(ValueError,'superseded'):
                activation.verify_plan({'candidate':str(candidate)})

if __name__=='__main__':unittest.main()

"""Offline activation refusal tests. Never calls a real service or worker."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('activation',Path(__file__).with_name('activate-test.py'))
activation=importlib.util.module_from_spec(spec); spec.loader.exec_module(activation)

class ActivationGuards(unittest.TestCase):
    def test_busy_worker_refuses(self):
        with patch.object(activation,'fetch',return_value={'queue_running':[[1,'job']],'queue_pending':[]}):
            with self.assertRaisesRegex(RuntimeError,'busy'): activation.idle()

    def test_missing_queue_shape_refuses(self):
        with patch.object(activation,'fetch',return_value={'queue_pending':[]}):
            with self.assertRaisesRegex(RuntimeError,'unverified'): activation.idle()

    def test_unavailable_worker_is_not_assumed_idle(self):
        with patch.object(activation,'fetch',side_effect=OSError('offline')):
            with self.assertRaises(OSError): activation.idle()

    def test_root_permission_required_before_mutation(self):
        self.invoke(check_only=False)

    def test_check_only_never_starts_or_stops_services(self):
        self.invoke(check_only=True)

    def invoke(self,check_only):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); test=root/'test'; releases=test/'releases'; releases.mkdir(parents=True)
            previous=releases/'test3001-old'; candidate=releases/'test3001-new'; previous.mkdir(); candidate.mkdir()
            (test/'current').symlink_to(previous)
            (root/'test-activation-plan.json').write_text(json.dumps({'candidate':str(candidate),'previous':str(previous),'buildId':'fixture'}))
            with patch.object(activation,'ROOT',root),patch.object(activation,'TEST',test),patch.object(activation,'verify_files'),\
                 patch.object(activation.socket,'gethostname',return_value='shawn'),patch.object(activation.os,'geteuid',return_value=1000),\
                 patch.object(activation,'service_environment'),patch.object(activation,'cpu_health'),patch.object(activation,'idle'),\
                 patch.object(activation,'run',side_effect=AssertionError('Unexpected service command')),\
                 patch.object(activation.sys,'argv',['activate-test.py']+(['--check-only'] if check_only else [])),contextlib.redirect_stdout(io.StringIO()):
                if check_only: activation.main()
                else:
                    with self.assertRaisesRegex(RuntimeError,'sudo required'): activation.main()
            self.assertEqual((test/'current').resolve(),previous)

    def test_command_errors_do_not_echo_private_output(self):
        with self.assertRaises(RuntimeError) as result:
            activation.run(['/usr/bin/python3','-c','import sys; print("PRIVATE-CREDENTIAL",file=sys.stderr); sys.exit(1)'])
        self.assertNotIn('PRIVATE-CREDENTIAL',str(result.exception))

if __name__=='__main__': unittest.main()

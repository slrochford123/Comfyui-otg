"""Exercise the generated sudo-only preflight, without sudo or service changes."""
import ast
import inspect
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


class AdmissionPreflight(unittest.TestCase):
    def exercise(self, euid, busy=False, returncode=0):
        source = Path(__file__).resolve().parents[1] / 'scripts/deploy/stage-private-media-test.py'
        tree = ast.parse(source.read_text())
        # This literal is exactly the code injected into the owner's activator.
        template = next(node.value for node in ast.walk(tree)
                        if isinstance(node, ast.Constant) and isinstance(node.value, str)
                        and node.value.startswith('def shared_idle():'))
        shared = ast.parse(template).body[0]
        calls = []
        def run(args, **kwargs):
            # A generic mock would conceal invalid Popen keyword arguments.
            popen_kwargs = {key: value for key, value in kwargs.items()
                            if key not in ('input', 'capture_output', 'timeout', 'check')}
            inspect.signature(subprocess.Popen).bind(args, **popen_kwargs)
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, returncode, json.dumps({'ok': True, 'busy': busy}).encode(), b'')
        def fail(message):
            raise RuntimeError(message)
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'authority.json'
            config.write_text(json.dumps({'sshOptions': [], 'target': 'fixture@host', 'script': '/fixture/admission.py'}))
            namespace = {'json': json, 'os': os, 'subprocess': subprocess, 'ADMISSION': config, 'fail': fail}
            exec(compile(ast.Module(body=[shared], type_ignores=[]), str(source), 'exec'), namespace)
            with patch.object(os, 'geteuid', return_value=euid), patch.object(subprocess, 'run', side_effect=run):
                if busy or returncode:
                    with self.assertRaises(RuntimeError): namespace['shared_idle']()
                else:
                    namespace['shared_idle']()
        return calls

    def test_sudo_branch_uses_valid_python_credentials_and_drops_supplementary_groups(self):
        calls = self.exercise(0)
        self.assertEqual(len(calls), 2)
        for _, kwargs in calls:
            self.assertEqual((kwargs['user'], kwargs['group'], kwargs['extra_groups']), (1000, 1000, ()))
            self.assertNotIn('uid', kwargs)
            self.assertNotIn('gid', kwargs)

    def test_nonroot_branch_does_not_change_credentials(self):
        for _, kwargs in self.exercise(1000):
            self.assertFalse({'user', 'group', 'extra_groups'} & kwargs.keys())

    def test_busy_authority_still_refuses(self):
        self.assertEqual(len(self.exercise(0, busy=True)), 1)

    def test_failed_transport_still_refuses(self):
        self.assertEqual(len(self.exercise(0, returncode=255)), 1)


if __name__ == '__main__':
    unittest.main()

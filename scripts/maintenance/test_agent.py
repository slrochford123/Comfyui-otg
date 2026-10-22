import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('new_agent', Path(__file__).with_name('agent.py'))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

class MaintenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        agent.TARGET = '3090'; agent.ENVIRONMENT = 'prod'
        agent.TOKEN = 'synthetic-prod-token-with-no-runtime-access'
        cls.server = agent.http.server.ThreadingHTTPServer(('127.0.0.1', 0), agent.Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close()
    def setUp(self):
        agent.REQUESTS.clear()
    def request(self, changes=None, token=None):
        body = dict(environment='prod', target='3090', action='status', requestId='00000000-0000-4000-8000-000000000001')
        body.update(changes or {})
        headers = {'Content-Type': 'application/json'}
        if token is not None: headers['Authorization'] = 'Bearer ' + token
        req = Request(f'http://127.0.0.1:{self.server.server_port}/maintenance', data=json.dumps(body).encode(), headers=headers)
        try:
            with urlopen(req) as r: return r.status, json.load(r)
        except HTTPError as e: return e.code, json.load(e)
    def test_missing_auth(self): self.assertEqual(self.request()[0], 401)
    def test_invalid_auth(self): self.assertEqual(self.request(token='invalid')[0], 401)
    def test_test_token_cannot_authenticate_prod(self):
        self.assertEqual(self.request(token='synthetic-test-token-with-no-runtime-access')[0], 401)
    def test_wrong_environment_denied_even_with_valid_token(self):
        self.assertEqual(self.request({'environment': 'test'}, agent.TOKEN)[0], 403)
    def test_wrong_target_denied(self): self.assertEqual(self.request({'target': '5060ti'}, agent.TOKEN)[0], 403)
    def test_unknown_action_rejected(self): self.assertEqual(self.request({'action': 'shell'}, agent.TOKEN)[0], 400)
    def test_extra_service_rejected(self): self.assertEqual(self.request({'service': 'arbitrary'}, agent.TOKEN)[0], 400)
    def test_success_echoes_verified_identity_only(self):
        with patch.object(agent, 'operate', return_value=(200, {'ok': True, 'status': {'host': 'qa'}})):
            code, body = self.request(token=agent.TOKEN)
            self.assertEqual(code, 200); self.assertEqual(body['target'], '3090'); self.assertEqual(body['environment'], 'prod')
            self.assertNotIn(agent.TOKEN, json.dumps(body))
    def test_completed_duplicate_executes_once(self):
        with patch.object(agent, 'operate', return_value=(200, {'ok': True, 'status': {}})) as op:
            a = self.request({'action': 'reset_comfy'}, agent.TOKEN)
            b = self.request({'action': 'reset_comfy'}, agent.TOKEN)
            self.assertEqual(a, b); self.assertEqual(op.call_count, 1)
    def test_wrong_physical_gpu_refused(self):
        with patch.object(agent, 'command', return_value='NVIDIA GeForce RTX 5060 Ti, 100, 16384'):
            self.assertRaises(ValueError, agent.gpu)
    def test_profiles_are_fixed(self):
        self.assertEqual(agent.PROFILES['3090'][0][1], 'otg-comfyui.service')
        self.assertEqual(agent.PROFILES['3090'][1][1], 'otg-comfyui-h3.service')
        self.assertEqual(agent.PROFILES['5060ti'], [('comfy8188', 'comfyui-5060.service', 8188)])
    def test_failed_unit_is_not_misreported_inactive_or_ready(self):
        def run(args, **kwargs):
            return 'failed' if 'systemctl' in args[0] else 'NVIDIA RTX 3090, 100, 24576'
        with patch.object(agent,'command',side_effect=run),patch.object(agent,'queue',side_effect=OSError()):
            self.assertEqual(agent.status()['services']['comfy8188'], {'state':'failed','http':'offline'})
    def test_busy_worker_refused_without_command(self):
        with patch.object(agent, 'status', return_value={'services': {'comfy8188': {'state': 'active', 'http': 'busy'}}}), patch.object(agent, 'command') as cmd, patch('builtins.open', return_value=tempfile.TemporaryFile()):
            self.assertEqual(agent.operate('reset_comfy')[0], 409); cmd.assert_not_called()
    def test_unmanaged_worker_refused(self):
        with patch.object(agent, 'status', return_value={'services': {'comfy8188': {'state': 'inactive', 'http': 'unmanaged'}}}), patch.object(agent, 'command') as cmd, patch('builtins.open', return_value=tempfile.TemporaryFile()):
            self.assertEqual(agent.operate('free_vram')[0], 409); cmd.assert_not_called()
    def test_duplicate_lock_refused(self):
        with patch.object(agent.fcntl, 'flock', side_effect=BlockingIOError()), patch.object(agent, 'command') as cmd, patch('builtins.open', return_value=tempfile.TemporaryFile()):
            self.assertEqual(agent.operate('reset_comfy')[0], 409); cmd.assert_not_called()

if __name__ == '__main__': unittest.main()

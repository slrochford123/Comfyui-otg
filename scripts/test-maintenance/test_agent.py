import importlib.util
import json
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from pathlib import Path

spec=importlib.util.spec_from_file_location('maintenance',Path(__file__).with_name('agent.py'))
agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)

class AgentSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        agent.TOKEN='synthetic-unit-test-token-with-no-runtime-access'
        cls.server=agent.http.server.ThreadingHTTPServer(('127.0.0.1',0),agent.Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close()
    def request(self,payload,token=None):
        headers={'Content-Type':'application/json'}
        if token is not None:headers['Authorization']='Bearer '+token
        req=Request(f'http://127.0.0.1:{self.server.server_port}/maintenance',data=json.dumps(payload).encode(),headers=headers)
        try:
            with urlopen(req) as r:return r.status,json.load(r)
        except HTTPError as e:return e.code,json.load(e)
    def test_missing_auth(self):self.assertEqual(self.request({'action':'status'})[0],401)
    def test_invalid_auth(self):self.assertEqual(self.request({'action':'status'},'invalid')[0],401)
    def test_unknown_action(self):self.assertEqual(self.request({'action':'shell'},agent.TOKEN)[0],400)
    def test_arbitrary_target_rejected(self):self.assertEqual(self.request({'action':'status','target':'other'},agent.TOKEN)[0],400)
    def test_arbitrary_service_rejected(self):self.assertEqual(self.request({'action':'reset_comfy','service':'arbitrary'},agent.TOKEN)[0],400)
    def test_status_dispatch(self):
        with patch.object(agent,'status',return_value={'target':'5060ti'}):self.assertEqual(self.request({'action':'status'},agent.TOKEN),(200,{'ok':True,'status':{'target':'5060ti'}}))
    def test_busy_refuses_mutation(self):
        with patch.object(agent,'status',return_value={'services':{'comfy8188':{'state':'active'}}}),patch.object(agent,'comfy',return_value={'queue_running':[['mine']], 'queue_pending':[]}),patch.object(agent,'command') as cmd,patch('builtins.open',return_value=__import__('tempfile').TemporaryFile()):
            self.assertEqual(agent.operate('reset_comfy')[0],409);cmd.assert_not_called()
    def test_fixed_service_name(self):self.assertEqual(agent.SERVICE,'comfyui-5060.service')
    def test_unmanaged_live_worker_refuses_mutation(self):
        with patch.object(agent,'status',return_value={'services':{'comfy8188':{'state':'inactive','http':'unmanaged'}}}),patch.object(agent,'command') as cmd,patch('builtins.open',return_value=__import__('tempfile').TemporaryFile()):
            self.assertEqual(agent.operate('free_vram')[0],409);cmd.assert_not_called()
    def test_reachable_unmanaged_endpoint_is_not_ready(self):
        def run(args,**kwargs):
            if 'is-active' in args:raise agent.subprocess.CalledProcessError(3,args)
            return 'NVIDIA GeForce RTX 5060 Ti, 400, 16384'
        with patch.object(agent,'command',side_effect=run),patch.object(agent,'comfy',return_value={'queue_running':[], 'queue_pending':[]}):
            self.assertEqual(agent.status()['services']['comfy8188']['http'],'unmanaged')

if __name__=='__main__':unittest.main()

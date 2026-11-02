"""Real CPU tensors/MP4 preview, fake guider. Never loads model weights or CUDA."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import torch


class PreviewTests(unittest.TestCase):
    def test_transparent_sampling_and_atomic_playable_preview(self):
        with tempfile.TemporaryDirectory(prefix='h3-preview-cpu-') as directory:
            root=Path(directory);(root/'worker/output').mkdir(parents=True)
            mm=types.ModuleType('comfy.model_management');comfy=types.ModuleType('comfy');comfy.model_management=mm
            folder=types.SimpleNamespace(get_output_directory=lambda:str(root/'worker/output'))
            with patch.dict(sys.modules,{'comfy':comfy,'comfy.model_management':mm,'folder_paths':folder,'nodes':types.ModuleType('nodes')}):
                spec=importlib.util.spec_from_file_location('private_preview',Path(__file__).parent/'LabMemory/__init__.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
                frames=torch.randn(1,24,3,8,8);before=frames.clone();callbacks=[]
                fmt=types.SimpleNamespace(latent_rgb_factors=[[.1,.2,.3]]*24,latent_rgb_factors_bias=[0,0,0])
                class Guider:
                    model_patcher=types.SimpleNamespace(model=types.SimpleNamespace(latent_format=fmt))
                    def sample(self,*args,**kwargs):
                        for step in range(2):kwargs['callback'](step,frames,frames,2)
                        return 'unchanged-result'
                wrapped=module.PreviewGuider(Guider())
                self.assertEqual(wrapped.sample(callback=lambda *a:callbacks.append(a[0])),'unchanged-result')
                self.assertEqual(callbacks,[0,1]);self.assertTrue(torch.equal(frames,before))
                state=json.loads((root/'preview-state.json').read_text());self.assertEqual(state['step'],2);self.assertEqual(state['total'],2);self.assertGreater(state['previewVersion'],0)
                probe=json.loads(subprocess.check_output(['/usr/bin/ffprobe','-v','error','-show_streams','-of','json',str(root/'preview.mp4')]))
                self.assertEqual(probe['streams'][0]['codec_name'],'h264');self.assertEqual(int(probe['streams'][0]['nb_frames']),3)
                with patch.object(module.subprocess,'run',side_effect=RuntimeError('optional preview failed')):
                    self.assertEqual(wrapped.sample(callback=lambda *a:None),'unchanged-result')
                self.assertEqual(json.loads((root/'preview-state.json').read_text())['step'],2)


if __name__=='__main__':unittest.main()

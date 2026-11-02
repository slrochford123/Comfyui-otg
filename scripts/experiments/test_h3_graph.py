import copy
import unittest
from h3_graph import HASHES, RECIPES, compile_graph, validate

class GraphTests(unittest.TestCase):
    def setUp(self):
        self.settings=dict(mode='text',resolution='0.2',orientation='landscape',seconds=2,gpu='rtx3090',recipe='author',seed=424242,prompt='A fully clothed adult at a cafe.')
    def test_pins(self):
        self.assertEqual(len(HASHES),4)
        for value in HASHES.values():self.assertEqual(len(value),64)
    def test_native_lengths_and_recipe(self):
        for model in RECIPES:
            for seconds in range(2,16):
                g,a=compile_graph(model,{**self.settings,'seconds':seconds},[],'encoder')
                self.assertEqual(a['frames'],seconds*24);self.assertGreaterEqual(a['nativeFrames'],a['frames']);self.assertEqual(a['nativeFrames']%17,5)
                self.assertEqual(g['30']['inputs']['unet_name'],model+'.safetensors');self.assertFalse(any('Lora' in n['class_type'] for n in g.values()))
    def test_distinct_images_reach_dit_and_vae(self):
        g,a=compile_graph('prism-pika',{**self.settings,'mode':'reference'},[dict(kind='image',name='a.png'),dict(kind='image',name='b.png')],'encoder')
        refs=g['39']['inputs'];self.assertNotEqual(refs['ref_images.ref_image_0'],refs['ref_images.ref_image_1']);self.assertEqual(refs['vae'],['3',0]);self.assertEqual(a['referenceCount'],2)
    def test_first_frame_anchor(self):
        g,_=compile_graph('prism-pika',{**self.settings,'mode':'image'},[dict(kind='image',name='a.png')],'encoder');self.assertEqual(g['40']['class_type'],'MiniMaxH3AddGuide');self.assertEqual(g['40']['inputs']['frame_idx'],0)
    def test_silent_video_does_not_connect_nonexistent_audio(self):
        for audio in (False,True):
            g,_=compile_graph('prism-pika',{**self.settings,'mode':'edit'},[dict(kind='video',name='a.mp4',hasAudio=audio)],'encoder')
            self.assertEqual('ref_video_audios.ref_video_audio_0' in g['39']['inputs'],audio)
    def test_image_edit_uses_native_image_latent_and_never_extracts_a_video_frame(self):
        g,a=compile_graph('prism-pika',{**self.settings,'mode':'edit-image'},[dict(kind='image',name='a.png')],'encoder')
        self.assertEqual(g['93']['class_type'],'EmptyLatentImage');self.assertEqual(g['5']['class_type'],'SaveImage')
        self.assertEqual(a['frames'],1);self.assertEqual(a['format'],'png');self.assertIsNone(a['fps'])
        self.assertFalse(any(n['class_type'] in ('CreateVideo','SaveVideo') for n in g.values()))
        self.assertEqual(g['39']['inputs']['ref_images.ref_image_0'],['100',0])
    def test_missing_or_mismatched_inputs_fail(self):
        for mode in ('image','reference','edit'):
            with self.assertRaises(ValueError):validate({**self.settings,'mode':mode},[])
        with self.assertRaises(ValueError):validate(self.settings,[dict(kind='image',name='a.png')])
    def test_eros_vsa_only(self):
        g,_=compile_graph('eros-beta7',self.settings,[],'encoder');self.assertEqual(g['41']['inputs']['selection'],'vsa');self.assertFalse(any(n['class_type']=='H3SLAAttention' for n in g.values()))

if __name__=='__main__':unittest.main()

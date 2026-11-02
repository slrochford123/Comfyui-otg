"""Offline graph contracts; these tests never claim model-inference success."""
import unittest
from testing_graph import compile_graph, PIKA_SIGMAS
from director_runtime import validate_plan


class TestingGraphs(unittest.TestCase):
    def settings(self, **kw):
        return dict(mode='reference',resolution='0.2',orientation='landscape',seconds=5,
                    gpu='rtx3090',recipe='author',seed=424242,prompt='An adult in a cafe.',**kw)
    def graph(self, model='pika-flex', mode='reference',variant='pika6',sources=None):
        s=self.settings();s.update(mode=mode,variant=variant)
        return compile_graph(model,s,sources if sources is not None else [{'kind':'image','name':'0.png'}],'encoder.safetensors')
    def test_pika_uses_exact_lcm_sigmas_not_euler_turbo(self):
        g,a=self.graph();self.assertEqual(g['18']['inputs']['sampler_name'],'lcm')
        self.assertEqual([float(x) for x in g['24']['inputs']['sigmas'].split(',')],PIKA_SIGMAS)
        self.assertEqual(g['35']['inputs']['lora_name'],'pika6-ref2va.safetensors');self.assertEqual(a['steps'],6)
    def test_text_uses_fl2va_not_ref_checkpoint_workaround(self):
        g,a=self.graph(mode='text',sources=[])
        self.assertEqual(g['39']['class_type'],'MiniMaxH3ImageToVideo');self.assertEqual(a['family'],'fl2va')
        self.assertEqual(a['frames'],120);self.assertEqual(a['nativeFrames'],124)
    def test_image_really_anchors_first_frame(self):
        g,_=self.graph(mode='image');self.assertEqual(g['39']['inputs']['first_frame'],['100',0]);self.assertNotIn('40',g)
    def test_two_references_are_independently_connected(self):
        g,a=self.graph(sources=[{'kind':'image','name':'0.png'},{'kind':'image','name':'1.png'}])
        self.assertEqual(g['39']['inputs']['ref_images.ref_image_0'],['100',0]);self.assertEqual(g['39']['inputs']['ref_images.ref_image_1'],['103',0]);self.assertEqual(a['referenceCount'],2)
    def test_baseline_keeps_existing_reference_turbo_recipe(self):
        g,a=self.graph(model='pika-baseline',variant='base8')
        self.assertEqual(g['35']['inputs']['lora_name'],'base8-ref2va.safetensors');self.assertEqual(a['steps'],8)
        self.assertEqual(g['38']['inputs']['shift_video'],6);self.assertEqual(g['41']['class_type'],'H3SLAAttention')
        self.assertEqual(g['18']['inputs']['sampler_name'],'euler')
    def test_unsupported_baseline_family_fails_closed(self):
        with self.assertRaises(ValueError):self.graph(model='pika-baseline',mode='text',variant='base8',sources=[])
    def test_swap_needs_both_reference_video_and_replacement_image(self):
        with self.assertRaises(ValueError):self.graph(model='body-swap',mode='edit',sources=[{'kind':'video','name':'0.mp4'}])
        g,a=self.graph(model='body-swap',mode='edit',sources=[{'kind':'video','name':'0.mp4'},{'kind':'image','name':'1.png'}])
        self.assertIn('ref_videos.ref_video_0',g['39']['inputs']);self.assertIn('ref_images.ref_image_0',g['39']['inputs']);self.assertIn('no SAM3',a['modeNote'])
    def test_no_audio_only_reference_or_silent_model_substitution(self):
        with self.assertRaises(ValueError):self.graph(sources=[{'kind':'audio','name':'0.wav'}])
        with self.assertRaises(ValueError):self.graph(model='nvidia-regenerate')
    def test_cinematic_preserves_generated_audio_and_time(self):
        g,a=self.graph(model='cinematic-upscale',mode='text',sources=[])
        self.assertEqual(g['34']['inputs']['audio'],['14',0]);self.assertEqual(g['34']['inputs']['images'],['301',0])
        self.assertEqual((a['width'],a['height'],a['frames']),(1216,704,120));self.assertIn('NOT Pika hosted',a['note'])
    def test_denomix_is_two_separate_adapter_branches(self):
        g,a=self.graph(model='sol-denomix')
        self.assertEqual(a['steps'],10);self.assertEqual(g['201']['inputs']['model'],g['202']['inputs']['model'])
        self.assertEqual(g['203']['inputs']['model'],['202',0]);self.assertEqual(g['207']['inputs']['step'],6)
        self.assertEqual(g['216']['inputs']['sigmas'],['207',1]);self.assertEqual(g['214']['inputs']['samples'],['211',1])
        self.assertEqual(g['213']['inputs']['value'],0);self.assertEqual(g['91']['inputs']['samples'],['216',1])
        self.assertEqual(g['25']['inputs']['samples'],g['14']['inputs']['samples']);self.assertEqual((a['width'],a['height']),(1216,704))
    def test_director_schema_rejects_incomplete_output(self):
        with self.assertRaises(ValueError):validate_plan({'title':'x','continuity':'x','shots':[]})
        plan={'title':'x','continuity':'Same cafe','shots':[{'title':'Greeting','seconds':5,'prompt':'Friends wave','sound':'Cafe ambience'}]}
        self.assertEqual(validate_plan(plan),plan)


if __name__=='__main__':unittest.main()

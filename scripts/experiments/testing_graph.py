"""Server-owned Testing recipes. Separate from the installed H3 Admin engine.

Pika recipe: Pika-Labs/Pika-H3-Flex @ 3ff166447d5edb1406107ab8370c42000ce173e4.
Never accepts a user graph, filename, adapter strength or sampler override.
"""
from h3_graph import compile_graph as h3_graph, validate

PIKA_SIGMAS = [1., .972973, .923077, .8, .571429, .333333, 0.]
SUPPORTED = {'pika-flex', 'pika-baseline', 'body-swap', 'sol-denomix', 'cinematic-upscale'}


def profile(model, settings):
    if model not in SUPPORTED:
        raise ValueError('This Testing recipe has not been implemented; no substitution')
    mode = settings.get('mode')
    if model == 'sol-denomix':
        if mode != 'reference' or settings.get('variant','pika6') != 'pika6' or not 5 <= settings['seconds'] <= 15:
            raise ValueError('DenoMix implements its reference-only 8+2 recipe, 5–15 seconds')
        return 'denomix', 'denomix'
    if mode not in ('text', 'image', 'reference', 'edit'):
        raise ValueError('Pika video graphs do not implement still-image editing')
    if model == 'body-swap' and mode != 'edit':
        raise ValueError('Prompt-guided character swapping requires edit-video mode')
    if not 5 <= settings['seconds'] <= 15:
        raise ValueError('Pika was released for 5–15 seconds; shorter clips are not enabled')
    family = 'fl2va' if mode in ('text', 'image') else 'ref2va'
    variant = settings.get('variant', 'pika6')
    if variant not in ('pika6', 'base8') or (model != 'pika-baseline' and variant != 'pika6'):
        raise ValueError('Unsupported experiment variant')
    if model == 'pika-baseline' and mode != 'reference':
        raise ValueError('Matched baseline comparison currently supports reference-to-video only')
    return family, variant


def compile_graph(model, settings, sources, encoder):
    validate(settings, sources)
    family, variant = profile(model, settings)
    if model == 'sol-denomix': return compile_denomix(settings, sources, encoder)
    if settings['mode'] in ('reference', 'edit') and not any(s['kind'] in ('image', 'video') for s in sources):
        raise ValueError('Pika Ref2VA requires an image or video reference, not audio alone')
    if model == 'body-swap' and (sum(s['kind'] == 'image' for s in sources) != 1 or len(sources) != 2):
        raise ValueError('Character swap requires exactly one source video and one replacement image')
    # Reuse AV conditioning, release barriers and output handling, not the hybrid weights/recipe.
    graph, actual = h3_graph('prism-pika', settings, sources, encoder)
    graph['30']['inputs']['unet_name'] = model + '.safetensors'
    if family == 'fl2va':
        inputs = {k:v for k,v in graph['39']['inputs'].items() if k in ('clip','vae','prompt','width','height','length')}
        if settings['mode'] == 'image': inputs['first_frame'] = ['100',0]
        graph['39'] = {'class_type':'MiniMaxH3ImageToVideo','inputs':inputs}
        graph.pop('40', None)
        graph['90']['inputs']['positive'] = ['39',0]
    graph['35'] = {'class_type':'LoraLoaderModelOnly','inputs':{
        'model':['30',0], 'lora_name':f'{variant}-{family}.safetensors', 'strength_model':1.}}
    graph['38']['inputs']['model'] = ['35',0]
    if variant == 'pika6':
        graph['18']['inputs']['sampler_name'] = 'lcm'
        graph['24'] = {'class_type':'ManualSigmas','inputs':{'sigmas':', '.join(map(str, PIKA_SIGMAS))}}
    else:
        # Original Standard R2V Turbo recipe, not the Pika adapter/sigma schedule.
        graph['38']['inputs']['shift_video'] = 6.
        graph['41'] = {'class_type':'H3SLAAttention','inputs':dict(model=['38',0],sparsity_ratio=.85,
            block_size='64',min_seq_len=8192,dense_last_steps=0,protect_audio=True,enabled=True,dense_steps='0',
            dense_backend='sage:qk_int8_pv_fp16_cuda',disable_fp16_accum=True,stabilize_motion=False,
            reference_protection='Off',tail_correction=False,use_int8_qk=True,engine='comfy_kitchen')}
        graph['32']['inputs']['model'] = ['41',0]
        graph['24']['inputs']['model'] = ['41',0]
        graph['91']['inputs']['model'] = ['41',0]
    actual.update(steps=6 if variant=='pika6' else 8, sampler='lcm' if variant=='pika6' else 'euler',
                  scheduler='published Pika sigmas' if variant=='pika6' else 'simple',
                  attention='dense' if variant=='pika6' else 'sla', shiftVideo=12 if variant=='pika6' else 6,
                  family=family, variant=variant, adapterStrength=1.,
                  note='Pika six-step adapter; no legacy Turbo stacking.' if variant=='pika6' else 'Separate eight-step acceleration baseline, not Pika.',
                  modeNote='Prompt-guided character replacement; no SAM3 mask or pixel-exact background guarantee.' if model=='body-swap' else actual['modeNote'],
                  encoderNote='Installed INT8 Qwen encoder; not the NVFP4 encoder from the newest example template.')
    if variant == 'pika6': actual['sigmas'] = PIKA_SIGMAS
    if model == 'cinematic-upscale':
        graph['300']={'class_type':'UpscaleModelLoader','inputs':{'model_name':'lab-realesrgan-x2.pth'}}
        graph['301']={'class_type':'ImageUpscaleWithModel','inputs':{'upscale_model':['300',0],'image':['25',0]}}
        graph['34']['inputs']['images']=['301',0]
        actual.update(draftWidth=actual['width'],draftHeight=actual['height'],width=actual['width']*2,height=actual['height']*2,scale=2,
                      upscaler='RealESRGAN x2plus',note='Local Pika draft + RealESRGAN 2x spatial baseline, NOT Pika hosted 4K finishing. Native timing and generated audio retained; no interpolation.')
    return graph, actual


def compile_denomix(settings, sources, encoder):
    if not sources or any(s['kind']!='image' for s in sources):
        raise ValueError('DenoMix qualification uses image references only')
    g, actual = h3_graph('prism-pika', settings, sources, encoder)
    def add(key, node, **inputs):
        g[str(key)]={'class_type':node,'inputs':inputs};return [str(key),0]
    g['30']['inputs']['unet_name']='sol-denomix.safetensors'
    g['39']['inputs']['ref_image_size']='max'
    base=add(200,'ModelAttentionBackend',model=['30',0],attention='comfy kitchen attention')
    first=add(201,'LoraLoaderModelOnly',model=base,lora_name='deno-acc.safetensors',strength_model=1.)
    g['38']['inputs']['model']=first
    # Complete the 8-step AV draft, then lift only video. The draft audio is noise-masked for refinement.
    draft=add(210,'LabReleaseDenoiser',samples=['21',1],model=['38',0])
    split=add(211,'LTXVSeparateAVLatent',av_latent=draft)
    lifted=add(212,'MinimaxH3LatentUpscaler3D',latent=split,model_name='deno-lifter.safetensors',
        mode='scale by multiplier',**{'mode.scale':2.},align=32,enable_temporal_chunking=True,force_unload=True,device='cuda',precision='bf16')
    mask=add(213,'SolidMask',value=0.,width=64,height=64)
    audio=add(214,'SetLatentNoiseMask',samples=['211',1],mask=mask)
    latent=add(215,'LTXVConcatAVLatent',video_latent=lifted,audio_latent=audio)
    dmd=add(202,'LoraLoaderModelOnly',model=base,lora_name='deno-dmd.safetensors',strength_model=1.)
    refiner=add(203,'LoraLoaderModelOnly',model=dmd,lora_name='deno-refiner.safetensors',strength_model=1.)
    shifted=add(204,'MiniMaxH3SigmaShift',model=refiner,shift_video=12.,shift_audio=3.)
    sparse=add(205,'BlockSparseAttention',model=shifted,selection='sol-attn',**{'selection.tau':1.3},
        start_percent=.2,end_percent=1.,dense_blocks='',min_tokens=12288,extra_tokens=256,sink_conditioning='exact_kv_and_rows',verbose=True)
    guide=add(206,'BasicGuider',model=sparse,conditioning=['90',0])
    add(207,'SplitSigmas',sigmas=['24',0],step=6)
    add(216,'SamplerCustomAdvanced',noise=['31',0],guider=guide,sampler=['18',0],sigmas=['207',1],latent_image=latent)
    g['91']['inputs'].update(samples=['216',1],model=sparse)
    actual.update(steps=10,sampler='euler',scheduler='simple · 8 draft + last 2 refinement',attention='dense CK draft / SoL refiner',
        width=actual['width']*2,height=actual['height']*2,draftWidth=actual['width'],draftHeight=actual['height'],scale=2,
        draftSteps=8,refineSteps=2,variant='denomix',family='ref2va',
        note='DenoMix author 8+2 algorithm; core reference node, FP16 video VAE and private release barriers replace UI/unload helpers. Rank-16 refiner is not the full NVIDIA Regenerate model.',
        audioNote='Draft audio retained; zero-noise mask during high-resolution refinement.')
    return g, actual

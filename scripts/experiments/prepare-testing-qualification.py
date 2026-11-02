#!/usr/bin/python3
"""Prepare pinned, non-explicit evidence jobs. No live configuration changes."""
import argparse
import json
import os
from pathlib import Path
import shutil
import uuid
from h3_runner import read, write, sha

os.umask(0o077)
p=argparse.ArgumentParser();p.add_argument('evidence');p.add_argument('model');p.add_argument('--mode',default='text');p.add_argument('--variant',default='pika6');p.add_argument('--source',action='append',default=[]);a=p.parse_args()
root=Path(a.evidence).resolve()
if not (root/'source-before.tar.gz').is_file():raise ValueError('Fresh source backup required')
cfg=read('/home/shawn-rochford/AI/runtime/test/experiments/runtime.json')
for key in ('models','runner','runnerSha256','files'):cfg.pop(key,None)
cfg.update(assets={},models={})
shared=Path(cfg['sharedModels'])
pins={
 'base-ref2va':(shared/'diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors','9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779'),
 'base-fl2va':(shared/'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors','e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a'),
 'pika6-fl2va':(root/'pika/comfy/loras/pika_h3_flex_fl2va_comfy_bf16.safetensors','68783e6447696ec365d13c0554941e070bee4cfea13c37da52498ec4f9a53f89'),
 'pika6-ref2va':(root/'pika/comfy/loras/pika_h3_flex_ref2va_comfy_bf16.safetensors','e4d058fbd027377b925a0ee607b514ddd9037873fee3afa05d73b302e6f7f8e1'),
 'base8-ref2va':(shared/'loras/minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors','6a56f41ab4229c9dd845b9501bbd475ee57e112d846cf2e819d534a1ae928c5a'),
 'realesrgan-x2':(shared/'upscale_models/RealESRGAN_x2plus.pth','49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb'),
}
optional={
 'base-denomix':(root/'denomix/MiniMax-H3_DenoMix_ref2va_pruned_int8_v3.safetensors','6fc735bb1d2e9e44951106b3ec6a4c063df1535c567bc7d44aaff4c9052add52'),
 'deno-acc':(root/'denomix/kijai/loras/MiniMax-H3-Ref2VA-Acc-8Step_pruned_comfy.safetensors','6f18e1c2eccb14b37322607730f26b16bf1169b56cd098ea006cffaec43d1e39'),
 'deno-refiner':(root/'denomix/kijai/loras/minimax_h3_open_regenerate_2k_refiner_rank_16_bf16.safetensors','add559cd92e2b17b42ac080516b476df120903e485fc98add4538e0217820fbd'),
 'deno-dmd':(root/'denomix/dmd/experimental/minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors','693f41129785f31a820d32100b698cdcc42182c27c291f37f47d1ca5f38f5c20'),
 'deno-lifter':(root/'denomix/lifter/minimax_h3_latent_upscaler_3d_bf16.safetensors','4f57821f5837f32f7142b67d815606dbd7550f194e5c769f7d6c3f83b146a5e6'),
}
pins.update({key:value for key,value in optional.items() if value[0].is_file()})
previous=read(root/'testing-qualification-runtime.json').get('assets',{}) if (root/'testing-qualification-runtime.json').exists() else {}
for key,(file,expected) in pins.items():
    old=previous.get(key,{})
    if old.get('path')==str(file) and old.get('sha256')==expected and old.get('bytes')==file.stat().st_size and old.get('mtimeNs')==file.stat().st_mtime_ns:
        cfg['assets'][key]=old;continue
    digest=sha(file)
    if digest!=expected:raise ValueError('Checksum mismatch: '+key)
    st=file.stat();cfg['assets'][key]=dict(path=str(file),sha256=digest,bytes=st.st_size,mtimeNs=st.st_mtime_ns)
cfg['privateNodes']=str(root/'private-nodes')
cfg['nodeFiles']=[dict(name=str(f.relative_to(root/'private-nodes')),sha256=sha(f)) for f in (root/'private-nodes').rglob('*') if f.is_file() and '__pycache__' not in str(f)]
if a.model=='director-studio' or (root/'testing-qualification-runtime.json').exists():
    old_cfg=read(root/'testing-qualification-runtime.json') if (root/'testing-qualification-runtime.json').exists() else {}
    if 'director' in old_cfg:cfg['director']=old_cfg['director']
    elif a.model=='director-studio':
        models=Path('/home/shawn-rochford/AI/ollama-qwen/models')
        manifest=models/'manifests/registry.ollama.ai/library/qwen3.5/4b'
        def pin(file,expected=None):
            digest=sha(file);st=file.stat()
            if expected and digest!=expected:raise ValueError('Director blob checksum mismatch')
            return dict(path=str(file),sha256=digest,bytes=st.st_size,mtimeNs=st.st_mtime_ns)
        m=read(manifest);blobs=[]
        for item in [m['config'],*m['layers']]:
            digest=item['digest'].split(':')[1];blobs.append(pin(models/'blobs'/('sha256-'+digest),digest))
        binary='/usr/local/bin/ollama'
        cfg['director']=dict(manifest=pin(manifest),blobs=blobs,binary=binary,binarySha256=sha(binary))
write(root/'testing-qualification-runtime.json',cfg)
job=root/'testing-qualification'/str(uuid.uuid4());(job/'sources').mkdir(parents=True,mode=0o700)
sources=[]
for i,name in enumerate(a.source):
    f=Path(name);target=job/'sources'/(str(i)+f.suffix);shutil.copyfile(f,target)
    sources.append(dict(name=target.name,sha256=sha(f),kind='video' if f.suffix=='.mp4' else 'image'))
prompt='Photorealistic film scene, an adult woman with a short curly bob and ivory sweater gently lifts a coffee mug and smiles in a sunlit cafe. Stable natural face, hands and clothing, subtle movement, medium composition. Quiet cafe ambience, no dialogue or music. Fully clothed non-explicit scene.'
if a.mode=='reference':prompt='<Picture 1> is the woman. '+prompt
if a.mode=='edit':prompt='Regenerate <Video 1> in warm afternoon sunlight; preserve the cafe, natural movement and camera. '+prompt
if a.model=='body-swap':prompt='Replace the adult woman in <Video 1> with the different adult woman in <Picture 1>, using her distinct face and long dark braids. Keep the source cafe setting and action. Fully clothed adult wearing a teal jacket, non-explicit. Quiet cafe ambience.'
if a.model=='director-studio':prompt='Plan a warm cafe reunion in three five-second shots. An adult woman with a curly bob and ivory sweater drinks coffee; her friend with long dark braids and a teal jacket arrives, and they greet each other. Keep both identities and the setting consistent. No dialogue or music, natural cafe sound. Give usable independent video prompts.'
write(job/'request.json',dict(id=job.name,model=a.model,settings=dict(mode=a.mode,resolution='0.2',orientation='landscape',seconds=5,gpu='rtx3090',recipe='author',variant=a.variant,seed=424242,prompt=prompt),sources=sources))
print(json.dumps(dict(job=str(job),config=str(root/'testing-qualification-runtime.json'))))

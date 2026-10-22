const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root='/home/shawn-rochford/AI/runtime/test/qualification';
const source=path.resolve('scripts/test-maintenance/test_ltx_hdr_node.py');
const installed=path.join(root,'test_ltx_hdr_node.py');
fs.copyFileSync(source,installed);
for(const [target,value] of [
 ['/home/shawn-rochford/AI/ComfyUI/models/embeddings/TEST-LTX-Closure/ltx-2.5-22b-ic-lora-sdr-to-hdr-scene-emb.safetensors',path.join(root,'ltx25-loras/ltx-2.5-22b-ic-lora-sdr-to-hdr-scene-emb.safetensors')],
 ['/home/shawn-rochford/AI/ComfyUI/ComfyUI/custom_nodes/SLR_TEST_LTX_HDR/__init__.py',installed],
 ['/home/shawn-rochford/AI/ComfyUI/models/vae/TEST-LTX-Closure/hdr-video-vae-bf16.safetensors','/home/shawn-rochford/AI/ComfyUI/models/vae/ltx-2.5-video-vae-bf16.safetensors'],
]){
 if(!fs.existsSync(value))throw Error('Missing TEST dependency '+value);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 if(fs.existsSync(target)){if(!fs.lstatSync(target).isSymbolicLink()||fs.realpathSync(target)!==value)throw Error('Refusing to replace existing dependency');}else fs.symlinkSync(value,target);
}
console.log(JSON.stringify({node:'TESTLTXHDRExport',source,sha256:crypto.createHash('sha256').update(fs.readFileSync(installed)).digest('hex'),dependency:'OpenImageIO==3.1.18.1',dependencyRoot:path.join(root,'ltx25-node-deps'),changes:'new TEST-prefixed node and embedding alias only'}));

"""Private ACE-Step adapter. Never initializes or reconfigures the live API service."""
import json
import os
from pathlib import Path
import sys
import time

request=json.loads(Path(sys.argv[1]).read_text())
cfg=json.loads(Path(os.environ["OTG_AUDIO_ENGINE_CONFIG"]).read_text())["ace"]
sys.path.insert(0,cfg["source"])
os.environ["HF_HUB_OFFLINE"]="1"
os.environ["TRANSFORMERS_OFFLINE"]="1"
os.environ["ACESTEP_DISABLE_TQDM"]="true"
import torch
from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams,GenerationConfig,generate_music
from acestep.model_downloader import check_model_exists
from acestep.core.generation.handler import init_service_downloads

# This provider deliberately does not use ACE's optional lyrics/planning LM.
# Upstream's all-family checker otherwise attempts to download that unused LM.
# Validate ALL three actually required component families, then narrow only this
# process's readiness check. Missing selected weights still fail, never download.
required=("acestep-v15-turbo","vae","Qwen3-Embedding-0.6B")
def native_components_ready(directory):
    return all(check_model_exists(name,Path(directory)) for name in required)
if not native_components_ready(Path(cfg["source"])/"checkpoints"):
    raise RuntimeError("The private instrumental provider is missing required DiT, VAE or text-encoder weights; no automatic download was attempted")
init_service_downloads.check_main_model_exists=native_components_ready

torch.set_num_threads(4)
torch.cuda.reset_peak_memory_stats()
started=time.monotonic()
handler=AceStepHandler()
message,ok=handler.initialize_service(project_root=cfg["source"],config_path="acestep-v15-turbo",device="cuda",
    use_flash_attention=False,compile_model=False,offload_to_cpu=True,offload_dit_to_cpu=True,use_mlx_dit=False)
if not ok:
    raise RuntimeError(message)
initialized=time.monotonic()-started
params=GenerationParams(caption=request["prompt"],lyrics="[Instrumental]",instrumental=True,
    duration=request["seconds"],inference_steps=8,guidance_scale=1,seed=int(request.get("seed",42)),
    thinking=False,use_cot_metas=False,use_cot_caption=False,use_cot_language=False)
config=GenerationConfig(batch_size=1,use_random_seed=False,seeds=[int(request.get("seed",42))],audio_format="wav")
tick=time.monotonic()
result=generate_music(handler,LLMHandler(),params,config,save_dir=request["directory"])
if not result.success or not result.audios or not result.audios[0].get("path"):
    raise RuntimeError(result.error or result.status_message or "ACE-Step produced no audio")
Path(request["result"]).write_text(json.dumps({"file":result.audios[0]["path"],"engine":"ACE-Step 1.5 Turbo (non-XL)",
    "initializationSeconds":initialized,"generationSeconds":time.monotonic()-tick,
    "peakTorchVramMiB":torch.cuda.max_memory_allocated()/1048576},indent=2))

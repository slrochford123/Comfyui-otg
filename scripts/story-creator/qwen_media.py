"""Offline, one-request Qwen3 voice design/authorized-reference synthesis."""
import json
import sys
import os
import signal
import ctypes
import time
from pathlib import Path


def main():
    request = json.load(sys.stdin)
    if ctypes.CDLL(None).prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise RuntimeError("Could not attach speech process lifetime to its web worker")
    if os.getppid() != request["parent_pid"]:
        raise RuntimeError("Speech request owner exited before inference")
    text = request["text"].strip()
    if not text or len(text) > 1200:
        raise ValueError("Dialogue must contain 1 to 1200 characters")
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable; CPU fallback is not qualified")
    device = torch.cuda.get_device_name(0)
    if request.get('expected_gpu') and request['expected_gpu'] not in device:
        raise RuntimeError('Speech device does not match the reserved GPU')
    started = time.monotonic()
    torch.cuda.reset_peak_memory_stats()
    if "seed" in request:
        seed=request["seed"]
        if isinstance(seed,bool) or not isinstance(seed,int) or not 0 <= seed <= 2147483647:
            raise ValueError("Invalid Qwen seed")
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
    model = Qwen3TTSModel.from_pretrained(request["model"], device_map="cuda:0",
        dtype=torch.bfloat16, attn_implementation="sdpa", local_files_only=True)
    if request.get("reference"):
        reference = Path(request["reference"])
        if not reference.is_file():
            raise ValueError("Reference file unavailable")
        ref_text = request.get("reference_text", "").strip()
        wavs, rate = model.generate_voice_clone(text=text, language="Auto",
            ref_audio=str(reference), ref_text=ref_text or None,
            x_vector_only_mode=not bool(ref_text), max_new_tokens=4096)
    else:
        wavs, rate = model.generate_voice_design(text=text, language="Auto",
            instruct=request["instruction"], max_new_tokens=4096)
    samples = np.asarray(wavs[0])
    if not np.isfinite(samples).all() or samples.size < rate // 5:
        raise ValueError("Invalid or empty generated audio")
    sf.write(request["output"], samples, rate, subtype="PCM_16")
    receipt={"ok": True, "sample_rate": rate, "duration": len(samples) / rate,
        "device": device, "cuda": torch.version.cuda, "torch": torch.__version__,
        "peak_vram_bytes": torch.cuda.max_memory_allocated(), "elapsed_seconds": time.monotonic()-started}
    Path(request['output']+'.receipt.json').write_text(json.dumps(receipt))
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()

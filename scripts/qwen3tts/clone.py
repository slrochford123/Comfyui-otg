import argparse
import json
import os
import sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--ref", required=True, help="Reference wav (16k/24k mono)")
    p.add_argument("--out", required=True, help="Output directory for artifacts")
    args = p.parse_args()

    ref = args.ref
    if not os.path.exists(ref):
        print("Reference wav not found", file=sys.stderr)
        return 2

    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)

    try:
        import torch
        from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel
    except Exception as e:
        print(f"Failed to import qwen_tts: {e}", file=sys.stderr)
        return 3

    repo_id = os.environ.get("QWEN3TTS_MODEL_CUSTOM", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype_name = os.environ.get("QWEN3TTS_DTYPE", "float16")
    dtype = getattr(torch, dtype_name, torch.float16)

    model = Qwen3TTSModel.from_pretrained(
        repo_id,
        device=device,
        dtype=dtype,
        use_flash_attn=True,
    )

    # The upstream library's cloning/embedding API is not stable across versions.
    # We do best-effort detection and write a small metadata file.
    meta = {
        "repo_id": repo_id,
        "device": device,
        "dtype": dtype_name,
        "ref": os.path.basename(ref),
        "status": "source_only",
    }

    try:
        import soundfile as sf
        import numpy as np

        wav, sr = sf.read(ref)
        if isinstance(wav, np.ndarray) and wav.ndim > 1:
            wav = wav[:, 0]

        # Try common embedding APIs.
        if hasattr(model, "extract_speaker_embedding"):
            emb = model.extract_speaker_embedding(wav=wav, sr=int(sr))
            # Save as .npy
            import numpy as np

            np.save(os.path.join(out_dir, "speaker_embedding.npy"), emb)
            meta["status"] = "embedded"
        elif hasattr(model, "build_prompt"):
            prompt = model.build_prompt(wav=wav, sr=int(sr))
            with open(os.path.join(out_dir, "prompt.json"), "w", encoding="utf-8") as f:
                json.dump(prompt, f, indent=2)
            meta["status"] = "prompt_ready"
        else:
            # No-op; downstream generate.py will still try prompt_wav/prompt_sr.
            meta["status"] = "no_clone_api"
    except Exception as e:
        meta["status"] = "clone_error"
        meta["error"] = str(e)

    with open(os.path.join(out_dir, "clone_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    # Always return success if we at least wrote meta; cloning can be refined later.
    print(json.dumps(meta))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

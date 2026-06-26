# OTG Speaker Diarization Worker

This optional local worker gives Production > Audio Studio real speaker diarization through `pyannote.audio`.

The Next.js app calls this endpoint when `OTG_SPEAKER_DIARIZATION_URL` is set:

```env
OTG_SPEAKER_DIARIZATION_URL=http://127.0.0.1:9010/diarize
```

## Requirements

- Python 3.10, 3.11, or 3.12
- A Hugging Face token with access to the configured pyannote model
- You must accept the model terms on Hugging Face for `pyannote/speaker-diarization-3.1`
- The worker pins `huggingface_hub<1.0`, `torch==2.5.1`, `torchaudio==2.5.1`, and `pyannote.audio==3.3.2`; do not upgrade pyannote to 4.x on Windows unless TorchCodec is known-good.

Set one of:

```bat
set PYANNOTE_AUTH_TOKEN=hf_your_token_here
```

or:

```bat
set HF_TOKEN=hf_your_token_here
```

## Install

```powershell
cd C:\AI\OTG-Test2\services\speaker_diarization
powershell -ExecutionPolicy Bypass -File .\install_speaker_diarization.ps1
```

## Run

```bat
C:\AI\OTG-Test2\services\speaker_diarization\run_speaker_diarization.bat
```

Health check:

```text
http://127.0.0.1:9010/health
```

## App wiring

Add this to the TEST app environment before starting the Next dev server:

```env
OTG_SPEAKER_DIARIZATION_URL=http://127.0.0.1:9010/diarize
```

Then use Production > Audio Studio > Analyze Clip Audio. Set `Expected voices` to the known speaker count when you know it, such as `3 voices`.

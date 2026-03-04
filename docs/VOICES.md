# Voices Studio

This app supports **Voice Studio** workflows driven by ComfyUI (Qwen3-TTS nodes) and optional Whisper transcription.

## UI modes

### 1) Clone Voice
- Create a voice slot (name + tags)
- Upload a reference clip (WAV/MP3/etc)
- Transcribe the clip with Whisper to populate `ref_text`
- Generate previews via `/api/tts/generate`

### 2) Create Voice
- Provide a voice description (character details)
- Provide a sample line (what the voice should say)
- Generates a reference sample and stores it as the voice's reference audio

### 3) Group Voices
- Select 2–8 voices
- Assign role names + optional ref-text overrides
- Build dialogue in ordered lines
- Generates a combined dialogue clip

## Storage
All voice assets are stored under:
`OTG_DATA_DIR/uploads/voices/`

## Routes

### Library + uploads
- `GET /api/voices/library` — list voices + limits
- `POST /api/voices/library` — create/update voice
- `DELETE /api/voices/library?voiceId=...` — delete voice (removes samples/outputs)
- `POST /api/voices/upload` — upload reference clip
- `POST /api/voices/transcribe` — Whisper STT (updates voice `refText`)

### Comfy-driven generation
- `POST /api/tts/generate` — generate audio using a voice's reference audio + ref text
- `POST /api/voices/studio/design` — voice creation (design)
- `POST /api/voices/studio/group` — group dialogue

## Environment variables
See `.env.example` for:
- `TTS_MAX_TEXT_LEN`
- `VOICES_MAX_TEXT_LEN`
- `VOICES_MAX_UPLOAD_MB`
- Whisper config (`WHISPER_*`)

# Manual Verification - Qwen3 Real Voice Sample

Date: 2026-05-25
Repo: C:\AI\OTG-Test2

## Verified

- Real Qwen3 worker path completed.
- Job: cvp_1779720529926_cb2fff2a8711
- Owner: slrochford12300
- Character id: j

## Result

- mock: false
- adapter: qwen3
- provider: qwen3
- exitCode: 0
- outputBytes: 613334

## Output WAV

C:\AI\OTG-Test2\data\characters\slrochford12300\voice-samples\j\cvp_1779720529926_cb2fff2a8711\sample.wav

ffprobe verified:

- Duration: 00:00:12.78
- Codec: pcm_s16le
- Sample rate: 24000 Hz
- Channels: mono
- Bitrate: 384 kb/s

## Logs

Stdout reported:

- ok: true
- engine: Qwen3-TTS VoiceDesign
- model_id: Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign
- device_map: cuda:0
- dtype_requested: float16
- sample_rate: 24000

Stderr was empty.

## Serving Route

Dedicated route verified:

GET /api/characters/voice-sample/file?owner=slrochford12300&characterId=j&jobId=cvp_1779720529926_cb2fff2a8711

HEAD result:

- HTTP 200 OK
- content-type: audio/wav
- content-length: 613334
- x-otg-voice-sample-file: 1

Downloaded WAV from the route and ffprobe verified it successfully.

## Final Qwen Sample URL Format

Future Qwen3 jobs now emit:

/api/characters/voice-sample/file?owner=<ownerKey>&characterId=<characterId>&jobId=<jobId>

instead of the old broken gallery URL:

/api/gallery/file?name=...

## Validation

- npx eslint passed for:
  - lib/jobs/adapters/qwen3VoiceSampleAdapter.ts
  - app/api/characters/voice-sample/file/route.ts
  - tests/vitest/contracts/voice-pipeline-worker.test.ts

- npm test passed:
  - 12 files
  - 42 tests

- npm run build: passed after URL test patch

## Next

- Add Cosy/CosyVoice base sample adapter.
- Then add Voice FX adapter.
- Then dataset generation and Applio training integration.

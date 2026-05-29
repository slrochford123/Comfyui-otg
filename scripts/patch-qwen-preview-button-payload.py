from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("qwen-preview-button-payload-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

old_message = '    setMessage("Generating IndexTTS2 voice preview...");'
new_message = '    setMessage("Generating Qwen3-TTS voice preview...");'

if old_message in text:
    text = text.replace(old_message, new_message, 1)

old_payload = '''          voiceSettings: {
            legacyVoiceSettings: voice,
            qwenVoiceDesign,
            qwenVoiceDesignRecord,
          },
          text: PREVIEW_LINES[0].text,
          previewLineId: PREVIEW_LINES[0].id,
          emotionAlpha: 0.6,'''

new_payload = '''          voiceSettings: {
            legacyVoiceSettings: voice,
            qwenVoiceDesign,
            qwenVoiceDesignRecord: qwenVoiceDesignRecord || (selectedQwenVoiceCandidate ? qwenVoiceDesignStorageRecord(qwenVoiceDesign, selectedQwenVoiceCandidate) : null),
          },
          candidateId: selectedQwenVoiceCandidate?.candidateId || "",
          text: selectedQwenVoiceCandidate?.previewText || PREVIEW_LINES[0].text,
          previewLineId: selectedQwenVoiceCandidate?.candidateId || PREVIEW_LINES[0].id,
          language: "english",
          dtype: "float16",
          emotionAlpha: 0.6,'''

if old_payload not in text:
    raise RuntimeError("Missing old generateVoicePreview payload block.")

text = text.replace(old_payload, new_payload, 1)

old_button = '''                <button
                  type="button"
                  disabled={true}
                  className="rounded-xl border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-100 opacity-40"
                >
                  Generate Qwen Audio Preview - Patch 3
                </button>'''

new_button = '''                <button
                  type="button"
                  onClick={generateVoicePreview}
                  disabled={loading || !voicePackCreated || !selectedQwenVoiceCandidate}
                  className="rounded-xl border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-40"
                >
                  {loading ? "Generating..." : "Generate Qwen Audio Preview"}
                </button>'''

if old_button not in text:
    raise RuntimeError("Missing disabled Qwen preview button block.")

text = text.replace(old_button, new_button, 1)

required = [
    "Generating Qwen3-TTS voice preview",
    "selectedQwenVoiceCandidate?.previewText",
    'language: "english"',
    'dtype: "float16"',
    "onClick={generateVoicePreview}",
    "Generate Qwen Audio Preview",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

bad = [
    "Generating IndexTTS2 voice preview",
    "Generate Qwen Audio Preview - Patch 3",
    "disabled={true}",
]

for item in bad:
    if item in text:
        raise RuntimeError("Verification failed. Old disabled/IndexTTS text remains: " + item)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: CharactersPanel now sends selected Qwen preview payload and enables preview button.")
print("Changed:", panel)
print("Backup:", backup_dir)
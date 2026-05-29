from pathlib import Path
from datetime import datetime
import re
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("qwen-preview-button-payload-v2-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

# 1) Fix visible status message.
text = text.replace(
    'setMessage("Generating IndexTTS2 voice preview...");',
    'setMessage("Generating Qwen3-TTS voice preview...");',
)

# 2) Patch the generateVoicePreview request payload inside the function only.
fn_match = re.search(
    r"  async function generateVoicePreview\(\) \{[\s\S]*?\n  \}\n\n  async function saveCharacter",
    text,
)

if not fn_match:
    raise RuntimeError("Could not find generateVoicePreview function block.")

fn = fn_match.group(0)
fn_original = fn

payload_pattern = re.compile(
    r"""          voiceSettings: \{
[\s\S]*?          \},
\s*          text: [^\n]+,
\s*          previewLineId: [^\n]+,
(?:\s*          language: [^\n]+,\n)?
(?:\s*          dtype: [^\n]+,\n)?
\s*          emotionAlpha: 0\.6,""",
    re.MULTILINE,
)

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
          emotionAlpha: 0.6,'''.rstrip()

fn, payload_count = payload_pattern.subn(new_payload, fn, count=1)

if payload_count == 0:
    # If the payload was already partially patched, enforce required fields after characterName line.
    if "selectedQwenVoiceCandidate?.previewText" not in fn:
        raise RuntimeError("Could not patch generateVoicePreview payload. Current function shape is different than expected.")
else:
    text = text[:fn_match.start()] + fn + text[fn_match.end():]

# 3) Replace the disabled Qwen preview button. This targets the specific placeholder label.
button_pattern = re.compile(
    r"""                <button
                  type="button"
                  disabled=\{true\}
                  className="rounded-xl border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-100 opacity-40"
                >
                  Generate Qwen Audio Preview - Patch 3
                </button>""",
    re.MULTILINE,
)

new_button = '''                <button
                  type="button"
                  onClick={generateVoicePreview}
                  disabled={loading || !voicePackCreated || !selectedQwenVoiceCandidate}
                  className="rounded-xl border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-40"
                >
                  {loading ? "Generating..." : "Generate Qwen Audio Preview"}
                </button>'''

text, button_count = button_pattern.subn(new_button, text, count=1)

if button_count == 0:
    raise RuntimeError("Could not find disabled Qwen preview placeholder button.")

# 4) Verify final file.
required = [
    "Generating Qwen3-TTS voice preview",
    "selectedQwenVoiceCandidate?.previewText",
    'language: "english"',
    'dtype: "float16"',
    "onClick={generateVoicePreview}",
    "Generate Qwen Audio Preview",
    "disabled={loading || !voicePackCreated || !selectedQwenVoiceCandidate}",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

for bad in [
    "Generating IndexTTS2 voice preview",
    "Generate Qwen Audio Preview - Patch 3",
    "disabled={true}",
]:
    if bad in text:
        raise RuntimeError("Verification failed. Old disabled/IndexTTS text remains: " + bad)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: CharactersPanel Qwen preview button/payload patched.")
print("Changed:", panel)
print("Backup:", backup_dir)
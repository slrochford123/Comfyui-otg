from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("qwen-preview-button-payload-v3-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

# -----------------------------
# 1. Patch generateVoicePreview function by direct targeted replacements.
# -----------------------------
start_marker = "  async function generateVoicePreview() {"
end_marker = "  async function saveCharacter() {"

start = text.find(start_marker)
end = text.find(end_marker)

if start == -1 or end == -1 or end <= start:
    raise RuntimeError("Could not locate generateVoicePreview function boundaries.")

before = text[:start]
fn = text[start:end]
after = text[end:]

fn = fn.replace(
    'setMessage("Generating IndexTTS2 voice preview...");',
    'setMessage("Generating Qwen3-TTS voice preview...");',
)

fn = fn.replace(
    "qwenVoiceDesignRecord,\n          },",
    "qwenVoiceDesignRecord: qwenVoiceDesignRecord || (selectedQwenVoiceCandidate ? qwenVoiceDesignStorageRecord(qwenVoiceDesign, selectedQwenVoiceCandidate) : null),\n          },",
)

fn = fn.replace(
    "text: PREVIEW_LINES[0].text,",
    'candidateId: selectedQwenVoiceCandidate?.candidateId || "",\n          text: selectedQwenVoiceCandidate?.previewText || PREVIEW_LINES[0].text,',
)

fn = fn.replace(
    "previewLineId: PREVIEW_LINES[0].id,",
    'previewLineId: selectedQwenVoiceCandidate?.candidateId || PREVIEW_LINES[0].id,\n          language: "english",\n          dtype: "float16",',
)

text = before + fn + after

# -----------------------------
# 2. Replace the placeholder button by locating its label, then replacing the whole enclosing button.
# -----------------------------
label = "Generate Qwen Audio Preview - Patch 3"
label_pos = text.find(label)

if label_pos != -1:
    button_start = text.rfind("<button", 0, label_pos)
    button_end = text.find("</button>", label_pos)

    if button_start == -1 or button_end == -1:
        raise RuntimeError("Found placeholder label but could not locate enclosing button.")

    button_end += len("</button>")

    new_button = '''<button
                  type="button"
                  onClick={generateVoicePreview}
                  disabled={loading || !voicePackCreated || !selectedQwenVoiceCandidate}
                  className="rounded-xl border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-40"
                >
                  {loading ? "Generating..." : "Generate Qwen Audio Preview"}
                </button>'''

    text = text[:button_start] + new_button + text[button_end:]
else:
    # Already patched is acceptable only if the real enabled button exists.
    if "onClick={generateVoicePreview}" not in text or "Generate Qwen Audio Preview" not in text:
        raise RuntimeError("Could not find placeholder button label or already-patched Qwen preview button.")

# -----------------------------
# 3. Verification.
# -----------------------------
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
        raise RuntimeError("Verification failed. Old text remains: " + bad)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: CharactersPanel Qwen preview button and payload patched.")
print("Changed:", panel)
print("Backup:", backup_dir)
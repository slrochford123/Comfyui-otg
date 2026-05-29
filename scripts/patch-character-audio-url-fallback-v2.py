from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("character-audio-url-fallback-v2-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

# 1. Insert voiceFileUrlFor after classNames helper.
class_anchor = '''function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}
'''

helper = '''function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function voiceFileUrlFor(pathValue?: string | null) {
  if (!pathValue) return "";
  const normalized = String(pathValue).replace(/\\\\/g, "/");
  const marker = "/data/";
  const markerIndex = normalized.indexOf(marker);
  const relativePath = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized.replace(/^\\/+/, "");
  return `/api/characters/voice-file?path=${encodeURIComponent(relativePath)}&v=${Date.now()}`;
}
'''

if "function voiceFileUrlFor" not in text:
    if class_anchor not in text:
        raise RuntimeError("Missing classNames anchor.")
    text = text.replace(class_anchor, helper, 1)

# 2. Add derived playable URLs after selectedQwenVoiceCandidate memo.
memo_start = "  const selectedQwenVoiceCandidate = useMemo("
memo_pos = text.find(memo_start)
if memo_pos == -1:
    raise RuntimeError("Missing selectedQwenVoiceCandidate memo start.")

# Find the end of that useMemo block.
memo_end_marker = "  );"
memo_end = text.find(memo_end_marker, memo_pos)
if memo_end == -1:
    raise RuntimeError("Could not find selectedQwenVoiceCandidate memo end.")
memo_end += len(memo_end_marker)

derived = '''
  const rawVoicePreviewPath = String(voicePreview?.audioPath || voicePreview?.outputPath || "").trim();
  const rawVoicePreviewUrl = String(voicePreview?.audioUrl || "").trim() || voiceFileUrlFor(rawVoicePreviewPath);
  const tunedVoicePreviewPath = String(voiceFxPreview?.audioPath || voiceFxPreview?.outputPath || "").trim();
  const tunedVoicePreviewUrl = String(voiceFxPreview?.audioUrl || "").trim() || voiceFileUrlFor(tunedVoicePreviewPath);
'''

if "const rawVoicePreviewUrl" not in text:
    text = text[:memo_end] + derived + text[memo_end:]

# 3. Replace raw preview block references.
text = text.replace("{voicePreview?.audioUrl ? (", "{rawVoicePreviewUrl ? (", 1)
text = text.replace(
    '<audio controls src={voicePreview.audioUrl} className="w-full" />',
    '<audio controls preload="metadata" src={rawVoicePreviewUrl} className="w-full" />',
    1,
)
text = text.replace(
    '{String(voicePreview.audioPath || voicePreview.outputPath || "")}',
    '{rawVoicePreviewPath}',
    1,
)

# 4. Replace tuned preview block references.
text = text.replace("{voiceFxPreview?.audioUrl ? (", "{tunedVoicePreviewUrl ? (", 1)
text = text.replace(
    '<audio controls src={voiceFxPreview.audioUrl} className="w-full" />',
    '<audio controls preload="metadata" src={tunedVoicePreviewUrl} className="w-full" />',
    1,
)
text = text.replace(
    '{String(voiceFxPreview.audioPath || voiceFxPreview.outputPath || "")}',
    '{tunedVoicePreviewPath}',
    1,
)

required = [
    "function voiceFileUrlFor",
    "const rawVoicePreviewPath",
    "const rawVoicePreviewUrl",
    "const tunedVoicePreviewPath",
    "const tunedVoicePreviewUrl",
    'src={rawVoicePreviewUrl}',
    'src={tunedVoicePreviewUrl}',
    'preload="metadata"',
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: character audio URL fallback v2 patched.")
print("Changed:", panel)
print("Backup:", backup_dir)
from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("character-audio-url-fallback-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

# Add helper after fileUrlFor if possible.
anchor = '''function fileUrlFor(pathValue?: string | null) {
  if (!pathValue) return "";
  return `/api/gallery/file?name=${encodeURIComponent(pathValue)}&scope=device&v=${Date.now()}`;
}
'''

helper = '''function fileUrlFor(pathValue?: string | null) {
  if (!pathValue) return "";
  return `/api/gallery/file?name=${encodeURIComponent(pathValue)}&scope=device&v=${Date.now()}`;
}

function voiceFileUrlFor(pathValue?: string | null) {
  if (!pathValue) return "";
  const normalized = String(pathValue).replace(/\\\\/g, "/");
  const marker = "/data/";
  const markerIndex = normalized.indexOf(marker);
  const relativePath = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized;
  return `/api/characters/voice-file?path=${encodeURIComponent(relativePath)}&v=${Date.now()}`;
}
'''

if "function voiceFileUrlFor" not in text:
    if anchor not in text:
        raise RuntimeError("Missing fileUrlFor anchor.")
    text = text.replace(anchor, helper, 1)

# Add derived URLs near selectedQwenVoiceCandidate memo.
memo_anchor = '''  const selectedQwenVoiceCandidate = useMemo(
    () => qwenVoiceCandidates.find((candidate) => candidate.candidateId === selectedQwenVoiceCandidateId) || null,
    [qwenVoiceCandidates, selectedQwenVoiceCandidateId],
  );
'''

derived = '''  const selectedQwenVoiceCandidate = useMemo(
    () => qwenVoiceCandidates.find((candidate) => candidate.candidateId === selectedQwenVoiceCandidateId) || null,
    [qwenVoiceCandidates, selectedQwenVoiceCandidateId],
  );
  const rawVoicePreviewPath = String(voicePreview?.audioPath || voicePreview?.outputPath || "").trim();
  const rawVoicePreviewUrl = String(voicePreview?.audioUrl || "").trim() || voiceFileUrlFor(rawVoicePreviewPath);
  const tunedVoicePreviewPath = String(voiceFxPreview?.audioPath || voiceFxPreview?.outputPath || "").trim();
  const tunedVoicePreviewUrl = String(voiceFxPreview?.audioUrl || "").trim() || voiceFileUrlFor(tunedVoicePreviewPath);
'''

if "const rawVoicePreviewUrl" not in text:
    if memo_anchor not in text:
        raise RuntimeError("Missing selectedQwenVoiceCandidate memo anchor.")
    text = text.replace(memo_anchor, derived, 1)

# Replace raw preview player condition/src/path.
text = text.replace(
    "{voicePreview?.audioUrl ? (",
    "{rawVoicePreviewUrl ? (",
    1,
)

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

# Replace tuned preview player condition/src/path.
text = text.replace(
    "{voiceFxPreview?.audioUrl ? (",
    "{tunedVoicePreviewUrl ? (",
    1,
)

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

print("OK: character audio URL fallback patched.")
print("Changed:", panel)
print("Backup:", backup_dir)
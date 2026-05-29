from pathlib import Path
from datetime import datetime
import re
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("qwen-create-voice-save-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")

required = [
    "const selectedQwenVoiceCandidate = useMemo",
    "qwenVoiceDesignStorageRecord",
    "async function createVoicePack()",
    "async function generateVoicePreview()",
]

for item in required:
    if item not in text:
        raise RuntimeError("Missing required anchor: " + item)

pattern = re.compile(
    r"  async function createVoicePack\(\) \{[\s\S]*?\n  \}\n\n  async function generateVoicePreview\(\)"
)

replacement = '''  async function createVoicePack() {
    if (!details.name.trim()) {
      setError("Character name is required before creating a voice pack.");
      setStep("details");
      return;
    }

    if (!selectedQwenVoiceCandidate) {
      setError("Generate Qwen voice design options and select one before creating the voice.");
      return;
    }

    const designRecord = qwenVoiceDesignRecord || qwenVoiceDesignStorageRecord(qwenVoiceDesign, selectedQwenVoiceCandidate);

    setLoading(true);
    setError("");
    setMessage("Preparing Qwen voice design metadata...");
    try {
      const characterId = safeId(details.name);
      const response = await fetch("/api/characters/voice-pack", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          characterId,
          characterName: details.name.trim(),
          characterDetails: details,
          voiceSettings: {
            legacyVoiceSettings: voice,
            qwenVoiceDesign,
            qwenVoiceDesignRecord: designRecord,
          },
          previewLines: [
            {
              id: designRecord.selectedCandidateId,
              label: selectedQwenVoiceCandidate.label,
              text: selectedQwenVoiceCandidate.previewText,
            },
          ],
          selectedPreviewLineId: designRecord.selectedCandidateId,
          identityBlock,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Create Voice failed.");
      }

      setQwenVoiceDesignRecord(designRecord);
      setVoicePackCreated(true);
      setVoicePackRecord(json.voicePack || { status: "qwen_voice_design_metadata_only", qwenVoiceDesignRecord: designRecord });
      setMessage("Qwen voice design metadata saved. Real Qwen audio generation will be wired next.");
    } catch (err: any) {
      setVoicePackCreated(false);
      setVoicePackRecord(null);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function generateVoicePreview()'''

text, count = pattern.subn(replacement, text, count=1)

if count != 1:
    raise RuntimeError("Failed to replace createVoicePack block.")

old_save = "          voiceSettings: voice,"
new_save = '''          voiceSettings: {
            legacyVoiceSettings: voice,
            qwenVoiceDesign,
            qwenVoiceDesignRecord,
          },'''

if old_save in text:
    text = text.replace(old_save, new_save, 1)

verify = [
    "Preparing Qwen voice design metadata",
    "Generate Qwen voice design options and select one",
    "qwenVoiceDesignRecord: designRecord",
    "Qwen voice design metadata saved",
]

for item in verify:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

panel.write_text(text, encoding="utf-8")

print("OK: createVoicePack now saves selected Qwen voice design metadata.")
print("Changed:", panel)
print("Backup:", backup_dir)
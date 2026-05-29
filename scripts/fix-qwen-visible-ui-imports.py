from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("fix-qwen-visible-ui-imports-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")

old = '''import {
  buildQwenVoiceCandidateInstructions,
  defaultAvoidTagsForVoiceType,
  defaultQwenVoiceDesignInput,
  qwenVoiceDesignStorageRecord,
  type QwenTextureTag,
  type QwenVoiceCandidateInstruction,
  type QwenVoiceDesignInput,
  type QwenVoiceType,
} from "../../../lib/characters/qwenVoiceDesign";'''

new = '''import {
  QWEN_PREVIEW_LINES,
  QWEN_VOICE_TYPE_LABELS,
  buildQwenVoiceCandidateInstructions,
  defaultAvoidTagsForVoiceType,
  defaultQwenVoiceDesignInput,
  qwenVoiceDesignStorageRecord,
  type QwenTextureTag,
  type QwenVoiceCandidateInstruction,
  type QwenVoiceDesignInput,
  type QwenVoiceType,
} from "../../../lib/characters/qwenVoiceDesign";'''

if old not in text:
    raise RuntimeError("Expected Qwen import block not found.")

text = text.replace(old, new, 1)

for item in ["QWEN_PREVIEW_LINES", "QWEN_VOICE_TYPE_LABELS"]:
    if item not in text:
        raise RuntimeError("Import verification failed: " + item)

panel.write_text(text, encoding="utf-8")

print("OK: added missing Qwen imports.")
print("Changed:", panel)
print("Backup:", backup_dir)
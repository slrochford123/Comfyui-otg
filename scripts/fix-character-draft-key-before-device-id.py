from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("fix-character-draft-key-before-device-id-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

old = 'const CHARACTER_BUILDER_DRAFT_KEY = `${CHARACTER_DEVICE_ID}:character_builder_draft:v${CHARACTER_BUILDER_DRAFT_VERSION}`;'
new = 'const CHARACTER_BUILDER_DRAFT_KEY = `web_characters_builder:character_builder_draft:v${CHARACTER_BUILDER_DRAFT_VERSION}`;'

if old not in text:
    raise RuntimeError("Could not find CHARACTER_BUILDER_DRAFT_KEY line using CHARACTER_DEVICE_ID.")

text = text.replace(old, new, 1)

required = [
    'const CHARACTER_BUILDER_DRAFT_KEY = `web_characters_builder:character_builder_draft:v${CHARACTER_BUILDER_DRAFT_VERSION}`;',
    'const CHARACTER_DEVICE_ID = "web_characters_builder";',
    "CHARACTER_BUILDER_DRAFT_VERSION",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if old in text:
    raise RuntimeError("Verification failed. Old CHARACTER_DEVICE_ID draft-key reference remains.")

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: fixed draft key before CHARACTER_DEVICE_ID declaration.")
print("Changed:", panel)
print("Backup:", backup_dir)
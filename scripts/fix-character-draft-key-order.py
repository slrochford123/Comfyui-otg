from pathlib import Path
from datetime import datetime
import shutil
import re

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("fix-character-draft-key-order-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

block_pattern = re.compile(
    r"""
const CHARACTER_BUILDER_DRAFT_VERSION = 1;
const CHARACTER_BUILDER_DRAFT_KEY = `\$\{CHARACTER_DEVICE_ID\}:character_builder_draft:v\$\{CHARACTER_BUILDER_DRAFT_VERSION\}`;
const BUILDER_STEP_ORDER = \["source", "card", "details", "voice", "review"\] as const;

function normalizeBuilderStepForNav\(value: string\) \{
  if \(value === "generate" \|\| value === "upload"\) return "source";
  return value;
\}

""",
    re.VERBOSE,
)

match = block_pattern.search(text)
if not match:
    raise RuntimeError("Could not find early CHARACTER_BUILDER_DRAFT block.")

draft_block = match.group(0)
text = text[:match.start()] + text[match.end():]

device_anchor = 'const CHARACTER_DEVICE_ID = "web_characters_builder";\n'

if device_anchor not in text:
    raise RuntimeError("Missing CHARACTER_DEVICE_ID anchor.")

text = text.replace(device_anchor, device_anchor + draft_block, 1)

device_pos = text.find(device_anchor)
draft_pos = text.find("const CHARACTER_BUILDER_DRAFT_VERSION = 1;")

if device_pos == -1 or draft_pos == -1:
    raise RuntimeError("Verification failed: missing device or draft constants.")

if draft_pos < device_pos:
    raise RuntimeError("Verification failed: draft constants are still before CHARACTER_DEVICE_ID.")

required = [
    'const CHARACTER_DEVICE_ID = "web_characters_builder";',
    "const CHARACTER_BUILDER_DRAFT_VERSION = 1;",
    "const CHARACTER_BUILDER_DRAFT_KEY",
    "function normalizeBuilderStepForNav",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: moved character draft constants after CHARACTER_DEVICE_ID.")
print("Changed:", panel)
print("Backup:", backup_dir)
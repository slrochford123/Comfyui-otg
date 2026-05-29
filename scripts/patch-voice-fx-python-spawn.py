from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
route = root / "app" / "api" / "characters" / "voice-fx" / "route.ts"
backup_dir = root / ".manual-backups" / ("voice-fx-python-spawn-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not route.exists():
    raise FileNotFoundError(route)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(route, backup_dir / "route.ts")

text = route.read_text(encoding="utf-8")
original = text

old = 'const PYTHON_EXE = path.resolve(process.env.OTG_VOICE_FX_PYTHON || "python");'
new = '''function commandPath(value: string) {
  if (!value) return value;
  if (path.isAbsolute(value)) return path.resolve(value);
  return value;
}

const PYTHON_EXE = commandPath(process.env.OTG_VOICE_FX_PYTHON || "python");'''

if old not in text:
    raise RuntimeError("Could not find PYTHON_EXE path.resolve line.")

text = text.replace(old, new, 1)

required = [
    "function commandPath",
    'const PYTHON_EXE = commandPath(process.env.OTG_VOICE_FX_PYTHON || "python");',
    "spawn(",
    "VOICE_FX_SCRIPT",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if 'path.resolve(process.env.OTG_VOICE_FX_PYTHON || "python")' in text:
    raise RuntimeError("Verification failed. Old bad path.resolve python line remains.")

if text == original:
    raise RuntimeError("No changes made.")

route.write_text(text, encoding="utf-8")

print("OK: Voice FX Python spawn fixed.")
print("Changed:", route)
print("Backup:", backup_dir)
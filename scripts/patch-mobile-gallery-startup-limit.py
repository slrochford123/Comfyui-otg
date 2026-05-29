from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
target = root / "app" / "app" / "AppPageClient.tsx"
backup_dir = root / ".manual-backups" / ("mobile-gallery-startup-limit-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not target.exists():
    raise FileNotFoundError(target)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(target, backup_dir / "AppPageClient.tsx")

text = target.read_text(encoding="utf-8")
original = text

replacements = {
    "per=5000": "per=80",
    "per: 5000": "per: 80",
    "per = 5000": "per = 80",
    "filter=all&per=5000": "filter=all&per=80",
    "sort=newest&filter=all&per=5000": "sort=newest&filter=all&per=80",
}

for old, new in replacements.items():
    text = text.replace(old, new)

if text == original:
    raise RuntimeError("No per=5000 startup gallery pattern was changed in AppPageClient.tsx.")

if "per=5000" in text or "per: 5000" in text or "per = 5000" in text:
    raise RuntimeError("Verification failed: AppPageClient.tsx still contains per=5000.")

target.write_text(text, encoding="utf-8")

print("OK: reduced AppPageClient gallery startup limit from 5000 to 80.")
print("Changed:", target)
print("Backup:", backup_dir)
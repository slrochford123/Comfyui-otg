from pathlib import Path
from datetime import datetime
import re
import shutil

root = Path(r"C:\AI\OTG-Test2")
target = root / "app" / "app" / "AppPageClient.tsx"
backup_dir = root / ".manual-backups" / ("disable-auto-gallery-sync-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not target.exists():
    raise FileNotFoundError(target)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(target, backup_dir / "AppPageClient.tsx")

text = target.read_text(encoding="utf-8")
original = text

# 1) Disable automatic gallery sync calls by replacing direct auto-trigger calls
# with comments/no-op guards, but keep the actual sync function available for manual buttons.
direct_call_patterns = [
    "void syncGallery();",
    "syncGallery();",
    "await syncGallery();",
    "void refreshGallerySync();",
    "refreshGallerySync();",
    "await refreshGallerySync();",
    "void handleGallerySync();",
    "handleGallerySync();",
    "await handleGallerySync();",
]

for pattern in direct_call_patterns:
    if pattern in text:
        text = text.replace(pattern, f"// Auto gallery sync disabled for mobile startup performance. Manual sync remains available.\n    // {pattern}")

# 2) Disable useEffect blocks whose only purpose is auto gallery sync.
# This is conservative: only targets effect blocks containing gallery/sync or forcePull.
effect_pattern = re.compile(
    r"\n\s*useEffect\(\(\) => \{(?P<body>[\s\S]*?)\n\s*\}, \[(?P<deps>[^\]]*)\]\);",
    re.MULTILINE,
)

def replace_effect(match):
    body = match.group("body")
    deps = match.group("deps")

    body_lower = body.lower()
    if "gallery/sync" in body_lower or "forcepull" in body_lower:
        return (
            "\n  // Auto gallery sync disabled for mobile startup performance.\n"
            "  // Manual gallery/content refresh still works from explicit user actions."
        )

    # Avoid disabling normal gallery list loads, favorites loads, characters loads, etc.
    return match.group(0)

text = effect_pattern.sub(replace_effect, text)

# 3) Reduce any remaining forcePull limit if it exists.
text = text.replace(
    "body: JSON.stringify({ forcePull: true, limit: 5000 }),",
    "body: JSON.stringify({ forcePull: true, limit: 500 }),",
)

# Verification: we should not leave obvious auto startup sync triggers.
bad_remaining = [
    "body: JSON.stringify({ forcePull: true, limit: 5000 }),",
]

for bad in bad_remaining:
    if bad in text:
        raise RuntimeError("Verification failed. Still found: " + bad)

if text == original:
    raise RuntimeError(
        "No changes were made. The file may already have no automatic gallery sync call, or the sync code uses different names."
    )

target.write_text(text, encoding="utf-8")

print("OK: automatic gallery sync disabled/reduced.")
print("Changed:", target)
print("Backup:", backup_dir)
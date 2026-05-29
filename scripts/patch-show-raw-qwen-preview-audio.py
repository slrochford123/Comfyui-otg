from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("show-raw-qwen-preview-audio-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

if "Raw Qwen Voice Preview" in text:
    raise RuntimeError("Raw Qwen preview audio UI already exists.")

anchor = '''                {voicePackRecord ? (
                  <p className="w-full text-xs text-emerald-300">
                    Voice design metadata saved. Status: {String(voicePackRecord.status || "metadata_only")}.
                  </p>
                ) : null}
'''

insert = '''                {voicePackRecord ? (
                  <p className="w-full text-xs text-emerald-300">
                    Voice design metadata saved. Status: {String(voicePackRecord.status || "metadata_only")}.
                  </p>
                ) : null}

                {voicePreview?.audioUrl ? (
                  <div className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-2 text-sm font-medium text-zinc-200">Raw Qwen Voice Preview</p>
                    <audio controls src={voicePreview.audioUrl} className="w-full" />
                    <p className="mt-2 break-all text-xs text-zinc-500">{String(voicePreview.audioPath || voicePreview.outputPath || "")}</p>
                  </div>
                ) : (
                  <p className="w-full text-xs text-zinc-500">
                    Click Generate Qwen Audio Preview to create the raw reference audio before applying Voice FX.
                  </p>
                )}
'''

if anchor not in text:
    raise RuntimeError("Missing voicePackRecord UI anchor.")

text = text.replace(anchor, insert, 1)

required = [
    "Raw Qwen Voice Preview",
    "voicePreview?.audioUrl",
    "<audio controls src={voicePreview.audioUrl}",
    "Generate Qwen Audio Preview to create the raw reference audio",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: Raw Qwen preview audio player added.")
print("Changed:", panel)
print("Backup:", backup_dir)
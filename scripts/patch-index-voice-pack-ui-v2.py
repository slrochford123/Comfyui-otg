from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("index-voice-pack-ui-v2-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

def replace_once(src: str, old: str, new: str, label: str) -> str:
    if old not in src:
        raise RuntimeError("Missing anchor: " + label)
    return src.replace(old, new, 1)

# 1. Add Index voice-pack state.
if "const [indexVoicePack, setIndexVoicePack]" not in text:
    anchor = "  const [selectedIndexVoiceReference, setSelectedIndexVoiceReference] = useState<any | null>(null);"
    text = replace_once(
        text,
        anchor,
        anchor + "\n  const [indexVoicePack, setIndexVoicePack] = useState<any | null>(null);",
        "selectedIndexVoiceReference state",
    )

# 2. Restore from draft if the current draft restore block exists.
if 'setIndexVoicePack(saved.indexVoicePack || null)' not in text:
    if 'setSelectedIndexVoiceReference(saved.selectedIndexVoiceReference || null);' in text:
        text = text.replace(
            '      if ("selectedIndexVoiceReference" in saved) setSelectedIndexVoiceReference(saved.selectedIndexVoiceReference || null);',
            '      if ("selectedIndexVoiceReference" in saved) setSelectedIndexVoiceReference(saved.selectedIndexVoiceReference || null);\n      if ("indexVoicePack" in saved) setIndexVoicePack(saved.indexVoicePack || null);',
            1,
        )

# 3. Persist to draft, tolerant insertion.
if "        indexVoicePack," not in text:
    draft_start = text.find("localStorage.setItem")
    if draft_start != -1:
        window = text[draft_start:draft_start + 5000]
        rel = window.find("selectedIndexVoiceReference")
        if rel != -1:
            abs_pos = draft_start + rel
            line_end = text.find("\n", abs_pos)
            if line_end != -1:
                text = text[:line_end + 1] + "        indexVoicePack,\n" + text[line_end + 1:]

# 4. Add dependency if there is a draft dependency array.
if "    indexVoicePack,\n  ]);" not in text and "    selectedIndexVoiceReference,\n  ]);" in text:
    text = text.replace(
        "    selectedIndexVoiceReference,\n  ]);",
        "    selectedIndexVoiceReference,\n    indexVoicePack,\n  ]);",
        1,
    )

# 5. Clear pack on reset.
reset_start = text.find("  function resetBuilder() {")
if reset_start == -1:
    raise RuntimeError("Missing resetBuilder function.")
reset_end = text.find("\n  }\n", reset_start)
if reset_end == -1:
    raise RuntimeError("Could not find resetBuilder end.")
reset_block = text[reset_start:reset_end]
if "setIndexVoicePack(null);" not in reset_block:
    text = text[:reset_end] + "    setIndexVoicePack(null);\n" + text[reset_end:]

# 6. Clear generated pack when choosing Raw/Tuned reference.
if "setMessage(\"Raw Qwen preview selected as the Index voice reference.\");" in text:
    raw_anchor = '''    setSelectedIndexVoiceReference(record);
    setMessage("Raw Qwen preview selected as the Index voice reference.");'''
    raw_replacement = '''    setSelectedIndexVoiceReference(record);
    setIndexVoicePack(null);
    setMessage("Raw Qwen preview selected as the Index voice reference.");'''
    if raw_anchor in text and raw_replacement not in text:
        text = text.replace(raw_anchor, raw_replacement, 1)

if "setMessage(\"Tuned Voice FX preview selected as the Index voice reference.\");" in text:
    tuned_anchor = '''    setSelectedIndexVoiceReference(record);
    setMessage("Tuned Voice FX preview selected as the Index voice reference.");'''
    tuned_replacement = '''    setSelectedIndexVoiceReference(record);
    setIndexVoicePack(null);
    setMessage("Tuned Voice FX preview selected as the Index voice reference.");'''
    if tuned_anchor in text and tuned_replacement not in text:
        text = text.replace(tuned_anchor, tuned_replacement, 1)

# 7. Add generator function.
if "async function generateIndexVoicePack" not in text:
    save_anchor = "  async function saveCharacter() {"
    generate_fn = '''  async function generateIndexVoicePack() {
    if (!selectedIndexVoiceReference?.audioPath) {
      setError("Select a raw or tuned Index voice reference before generating the Index voice pack.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("Generating IndexTTS2 voice pack. This can take several minutes...");
    try {
      const characterId = safeId(details.name || "character");
      const response = await fetch("/api/characters/voice-pack", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          characterId,
          characterName: details.name || "",
          indexVoiceReference: selectedIndexVoiceReference,
          indexVoiceReferencePath: selectedIndexVoiceReference.audioPath,
          voiceSettings: {
            ...voice,
            qwenVoiceDesign,
            qwenVoiceDesignRecord,
          },
          characterDetails: details,
          identityBlock,
        }),
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Index voice pack generation failed.");
      }

      setIndexVoicePack(json.voicePack || json);
      setMessage("Index voice pack generated. Review each style before saving the character.");
    } catch (error: any) {
      setError(error?.message || "Index voice pack generation failed.");
    } finally {
      setLoading(false);
    }
  }

'''
    text = replace_once(text, save_anchor, generate_fn + save_anchor, "saveCharacter")

# 8. Include generated pack in final save payload.
if "indexVoicePackPath" not in text:
    anchor = '''          indexVoiceReferenceSource: selectedIndexVoiceReference?.source || "",
          voiceEngineUsed: "IndexTTS2 direct",'''
    replacement = '''          indexVoiceReferenceSource: selectedIndexVoiceReference?.source || "",
          indexVoicePack,
          indexVoicePackPath: indexVoicePack?.voicePackPath || "",
          voiceEngineUsed: "IndexTTS2 direct",'''
    text = replace_once(text, anchor, replacement, "save payload index voice reference")

# 9. Add UI panel before tuned preview.
if "Generate Index Voice Pack" not in text:
    marker = '''                {tunedVoicePreviewUrl ? ('''
    ui = '''                <div className="mt-4 rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-purple-100">Index Voice Pack</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Generate emotional/style samples from the locked Index voice reference.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={generateIndexVoicePack}
                      disabled={loading || !selectedIndexVoiceReference?.audioPath}
                      className="rounded-xl border border-purple-400 px-4 py-2 text-xs font-semibold text-purple-100 disabled:opacity-40 hover:bg-purple-400/10"
                    >
                      {loading ? "Generating..." : "Generate Index Voice Pack"}
                    </button>
                  </div>

                  {indexVoicePack?.outputs ? (
                    <div className="mt-4 grid gap-3">
                      {Object.values(indexVoicePack.outputs || {}).map((output: any) => (
                        <div key={String(output.id || output.label || output.audioPath)} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-zinc-200">{String(output.label || output.id || "Voice Style")}</p>
                            <p className="text-xs text-zinc-500">{String(output.status || "")}</p>
                          </div>
                          <p className="mb-2 text-xs text-zinc-500">{String(output.text || "")}</p>
                          {output.audioUrl ? (
                            <audio controls preload="metadata" src={String(output.audioUrl)} className="w-full" />
                          ) : null}
                          <p className="mt-2 break-all text-xs text-zinc-600">{String(output.audioPath || "")}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">
                      No Index voice pack generated yet. Select Raw or Tuned as the Index reference, then generate the pack.
                    </p>
                  )}
                </div>

'''
    text = replace_once(text, marker, ui + marker, "tunedVoicePreviewUrl marker")

required = [
    "indexVoicePack",
    "setIndexVoicePack",
    "generateIndexVoicePack",
    "Generate Index Voice Pack",
    "Index Voice Pack",
    "Object.values(indexVoicePack.outputs",
    "indexVoicePackPath",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: Index voice-pack UI v2 patched.")
print("Changed:", panel)
print("Backup:", backup_dir)
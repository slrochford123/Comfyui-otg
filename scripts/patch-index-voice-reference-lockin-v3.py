from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("index-voice-reference-lockin-v3-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

# 1. Add selected Index reference state.
state_anchor = "  const [voiceFxAdvancedOpen, setVoiceFxAdvancedOpen] = useState(false);"

if "selectedIndexVoiceReference" not in text:
    if state_anchor not in text:
        raise RuntimeError("Missing voiceFxAdvancedOpen state anchor.")
    text = text.replace(
        state_anchor,
        state_anchor + "\n  const [selectedIndexVoiceReference, setSelectedIndexVoiceReference] = useState<any | null>(null);",
        1,
    )

# 2. Restore selected reference from draft.
restore_anchor = '''      if ("voiceFxPreview" in saved) setVoiceFxPreview(saved.voiceFxPreview || null);'''

if "setSelectedIndexVoiceReference(saved.selectedIndexVoiceReference" not in text:
    if restore_anchor not in text:
        raise RuntimeError("Missing draft restore voiceFxPreview anchor.")
    text = text.replace(
        restore_anchor,
        restore_anchor + '\n      if ("selectedIndexVoiceReference" in saved) setSelectedIndexVoiceReference(saved.selectedIndexVoiceReference || null);',
        1,
    )

# 3. Persist selected reference into draft.
persist_anchor = '''        voiceFxPreview,
      },'''

if "selectedIndexVoiceReference," not in text:
    if persist_anchor not in text:
        raise RuntimeError("Missing draft persist voiceFxPreview anchor.")
    text = text.replace(
        persist_anchor,
        '''        voiceFxPreview,
        selectedIndexVoiceReference,
      },''',
        1,
    )

deps_anchor = '''    voiceFxPreview,
  ]);'''

if "    selectedIndexVoiceReference,\n  ]);" not in text:
    if deps_anchor not in text:
        raise RuntimeError("Missing draft deps voiceFxPreview anchor.")
    text = text.replace(
        deps_anchor,
        '''    voiceFxPreview,
    selectedIndexVoiceReference,
  ]);''',
        1,
    )

# 4. Clear selected reference in resetBuilder.
reset_start = text.find("  function resetBuilder() {")
if reset_start == -1:
    raise RuntimeError("Missing resetBuilder function.")

reset_end = text.find("\n  }\n", reset_start)
if reset_end == -1:
    raise RuntimeError("Could not find resetBuilder end.")

reset_block = text[reset_start:reset_end]
if "setSelectedIndexVoiceReference(null);" not in reset_block:
    text = text[:reset_end] + "    setSelectedIndexVoiceReference(null);\n" + text[reset_end:]

# 5. Clear selected reference when raw preview or tuned preview is invalidated.
if 'setSelectedIndexVoiceReference(null);' not in text[text.find("  function setVoiceFxField"):text.find("  function applyVoiceFxPreset")]:
    field_anchor = "    setVoiceFxPreview(null);\n  }\n\n  function applyVoiceFxPreset"
    if field_anchor not in text:
        raise RuntimeError("Missing setVoiceFxField clear anchor.")
    text = text.replace(
        field_anchor,
        "    setVoiceFxPreview(null);\n    setSelectedIndexVoiceReference((current: any) => current?.source === \"tuned_voice_fx\" ? null : current);\n  }\n\n  function applyVoiceFxPreset",
        1,
    )

if 'setSelectedIndexVoiceReference((current: any) => current?.source === "tuned_voice_fx" ? null : current);' not in text[text.find("  function applyVoiceFxPreset"):text.find("  async function applyVoiceFx")]:
    preset_anchor = "    setVoiceFxPreview(null);\n  }\n\n  async function applyVoiceFx"
    if preset_anchor not in text:
        raise RuntimeError("Missing applyVoiceFxPreset clear anchor.")
    text = text.replace(
        preset_anchor,
        "    setVoiceFxPreview(null);\n    setSelectedIndexVoiceReference((current: any) => current?.source === \"tuned_voice_fx\" ? null : current);\n  }\n\n  async function applyVoiceFx",
        1,
    )

# 6. Add helper functions before saveCharacter.
save_anchor = "  async function saveCharacter() {"

helpers = '''  function buildIndexVoiceReference(source: "raw_qwen_preview" | "tuned_voice_fx", preview: any) {
    const audioPath = String(preview?.audioPath || preview?.outputPath || "").trim();
    const audioUrl = String(preview?.audioUrl || "").trim() || voiceFileUrlFor(audioPath);

    if (!audioPath) {
      return null;
    }

    return {
      source,
      engine: source === "tuned_voice_fx" ? "OTG Voice FX" : "Qwen3-TTS Voice Design",
      characterId: safeId(details.name || "character"),
      candidateId: selectedQwenVoiceCandidate?.candidateId || "",
      selectedAt: new Date().toISOString(),
      audioPath,
      audioUrl,
      qwenVoiceDesign,
      qwenVoiceDesignRecord,
      voiceFx: source === "tuned_voice_fx" ? voiceFx : null,
      voiceFxPreview: source === "tuned_voice_fx" ? preview : null,
      rawVoicePreview: voicePreview || null,
    };
  }

  function useRawPreviewAsIndexReference() {
    const record = buildIndexVoiceReference("raw_qwen_preview", voicePreview);
    if (!record) {
      setError("Generate a raw Qwen audio preview before selecting it as the Index reference.");
      return;
    }

    setSelectedIndexVoiceReference(record);
    setMessage("Raw Qwen preview selected as the Index voice reference.");
  }

  function useTunedPreviewAsIndexReference() {
    const record = buildIndexVoiceReference("tuned_voice_fx", voiceFxPreview);
    if (!record) {
      setError("Apply Voice FX before selecting the tuned preview as the Index reference.");
      return;
    }

    setSelectedIndexVoiceReference(record);
    setMessage("Tuned Voice FX preview selected as the Index voice reference.");
  }

'''

if "function useTunedPreviewAsIndexReference" not in text:
    if save_anchor not in text:
        raise RuntimeError("Missing saveCharacter anchor.")
    text = text.replace(save_anchor, helpers + save_anchor, 1)

# 7. Auto-select references after generation.
if 'buildIndexVoiceReference("raw_qwen_preview", json)' not in text:
    raw_anchor = "      setVoicePreview(json);"
    if raw_anchor not in text:
        raise RuntimeError("Missing setVoicePreview(json) anchor.")
    text = text.replace(
        raw_anchor,
        raw_anchor + '\n      setSelectedIndexVoiceReference((current: any) => current || buildIndexVoiceReference("raw_qwen_preview", json));',
        1,
    )

if 'buildIndexVoiceReference("tuned_voice_fx", json)' not in text:
    fx_anchor = "      setVoiceFxPreview(json);"
    if fx_anchor not in text:
        raise RuntimeError("Missing setVoiceFxPreview(json) anchor.")
    text = text.replace(
        fx_anchor,
        fx_anchor + '\n      setSelectedIndexVoiceReference(buildIndexVoiceReference("tuned_voice_fx", json));',
        1,
    )

# 8. Include selected reference in final character save payload.
save_payload_anchor = '''          voiceSettings: voice,
          voicePackPaths,
          voiceEngineUsed: "IndexTTS2 direct",'''

save_payload_replacement = '''          voiceSettings: voice,
          voicePackPaths,
          indexVoiceReference: selectedIndexVoiceReference,
          indexVoiceReferencePath: selectedIndexVoiceReference?.audioPath || "",
          indexVoiceReferenceUrl: selectedIndexVoiceReference?.audioUrl || "",
          indexVoiceReferenceSource: selectedIndexVoiceReference?.source || "",
          voiceEngineUsed: "IndexTTS2 direct",'''

if "indexVoiceReferencePath" not in text:
    if save_payload_anchor not in text:
        raise RuntimeError("Missing current save payload anchor.")
    text = text.replace(save_payload_anchor, save_payload_replacement, 1)

# 9. Add lock-in UI panel before tuned preview.
lock_panel = '''                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-100">Selected Index Voice Reference</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Choose which generated voice Index should use as this character's locked reference voice.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={useRawPreviewAsIndexReference}
                        disabled={!rawVoicePreviewPath}
                        className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-40 hover:bg-emerald-400/10"
                      >
                        Use Raw
                      </button>
                      <button
                        type="button"
                        onClick={useTunedPreviewAsIndexReference}
                        disabled={!tunedVoicePreviewPath}
                        className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-40 hover:bg-emerald-400/10"
                      >
                        Use Tuned
                      </button>
                    </div>
                  </div>

                  {selectedIndexVoiceReference ? (
                    <div className="mt-3 space-y-1 text-xs text-zinc-300">
                      <p>Source: {selectedIndexVoiceReference.source === "tuned_voice_fx" ? "Tuned Voice FX Preview" : "Raw Qwen Preview"}</p>
                      <p>Engine: {String(selectedIndexVoiceReference.engine || "")}</p>
                      <p className="break-all text-zinc-500">Path: {String(selectedIndexVoiceReference.audioPath || "")}</p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">
                      No Index voice reference selected yet. Generate a raw preview or apply Voice FX, then choose Raw or Tuned.
                    </p>
                  )}
                </div>

'''

if "Selected Index Voice Reference" not in text:
    marker = '''                {tunedVoicePreviewUrl ? ('''
    if marker not in text:
        raise RuntimeError("Missing tunedVoicePreviewUrl marker for lock-in panel insertion.")
    text = text.replace(marker, lock_panel + marker, 1)

required = [
    "selectedIndexVoiceReference",
    "buildIndexVoiceReference",
    "useRawPreviewAsIndexReference",
    "useTunedPreviewAsIndexReference",
    "Selected Index Voice Reference",
    "Use Raw",
    "Use Tuned",
    "indexVoiceReferencePath",
    "indexVoiceReferenceUrl",
    "indexVoiceReferenceSource",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: Index voice reference lock-in v3 patched.")
print("Changed:", panel)
print("Backup:", backup_dir)
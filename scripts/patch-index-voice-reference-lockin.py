from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("index-voice-reference-lockin-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

# 1. Add selected reference state.
state_anchor = '''  const [voiceFx, setVoiceFx] = useState<VoiceFxSettings>(DEFAULT_VOICE_FX);
  const [voiceFxPreview, setVoiceFxPreview] = useState<any | null>(null);
  const [voiceFxAdvancedOpen, setVoiceFxAdvancedOpen] = useState(false);'''

state_replacement = '''  const [voiceFx, setVoiceFx] = useState<VoiceFxSettings>(DEFAULT_VOICE_FX);
  const [voiceFxPreview, setVoiceFxPreview] = useState<any | null>(null);
  const [voiceFxAdvancedOpen, setVoiceFxAdvancedOpen] = useState(false);
  const [selectedIndexVoiceReference, setSelectedIndexVoiceReference] = useState<any | null>(null);'''

if "selectedIndexVoiceReference" not in text:
    if state_anchor not in text:
        raise RuntimeError("Missing voice FX state anchor.")
    text = text.replace(state_anchor, state_replacement, 1)

# 2. Reset selected reference on Start Over.
reset_anchor = '''    setVoiceFx(DEFAULT_VOICE_FX);
    setVoiceFxPreview(null);
    setVoiceFxAdvancedOpen(false);'''

reset_replacement = '''    setVoiceFx(DEFAULT_VOICE_FX);
    setVoiceFxPreview(null);
    setVoiceFxAdvancedOpen(false);
    setSelectedIndexVoiceReference(null);'''

if "setSelectedIndexVoiceReference(null);" not in text:
    if reset_anchor not in text:
        raise RuntimeError("Missing voice FX reset anchor.")
    text = text.replace(reset_anchor, reset_replacement, 1)

# 3. Add helpers before saveCharacter.
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

# 4. Auto-select raw preview on generation if no selected reference exists.
raw_success_anchor = '''      setVoicePreview(json);
      setMessage("Voice preview generated. Listen before saving the character.");'''

raw_success_replacement = '''      setVoicePreview(json);
      setSelectedIndexVoiceReference((current: any) => current || buildIndexVoiceReference("raw_qwen_preview", json));
      setMessage("Voice preview generated. Listen before saving the character.");'''

if 'buildIndexVoiceReference("raw_qwen_preview", json)' not in text:
    if raw_success_anchor not in text:
        raise RuntimeError("Missing generateVoicePreview success anchor.")
    text = text.replace(raw_success_anchor, raw_success_replacement, 1)

# 5. Auto-select tuned preview when FX succeeds.
fx_success_anchor = '''      setVoiceFxPreview(json);
      setMessage("Voice FX applied. Compare the raw preview and tuned preview.");'''

fx_success_replacement = '''      setVoiceFxPreview(json);
      setSelectedIndexVoiceReference(buildIndexVoiceReference("tuned_voice_fx", json));
      setMessage("Voice FX applied. Tuned preview selected as the Index voice reference.");'''

if 'buildIndexVoiceReference("tuned_voice_fx", json)' not in text:
    if fx_success_anchor not in text:
        raise RuntimeError("Missing applyVoiceFx success anchor.")
    text = text.replace(fx_success_anchor, fx_success_replacement, 1)

# 6. Include selected reference in save payload.
save_payload_anchor = '''          voicePackRecord,
          identityBlock,'''

save_payload_replacement = '''          voicePackRecord,
          indexVoiceReference: selectedIndexVoiceReference,
          indexVoiceReferencePath: selectedIndexVoiceReference?.audioPath || "",
          indexVoiceReferenceSource: selectedIndexVoiceReference?.source || "",
          identityBlock,'''

if "indexVoiceReferencePath" not in text:
    if save_payload_anchor not in text:
        raise RuntimeError("Missing saveCharacter payload anchor.")
    text = text.replace(save_payload_anchor, save_payload_replacement, 1)

# 7. Add buttons and selected reference panel near raw preview.
raw_preview_marker = '''                {rawVoicePreviewUrl ? (
                  <div className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-2 text-sm font-medium text-zinc-200">Raw Qwen Voice Preview</p>
                    <audio controls preload="metadata" src={rawVoicePreviewUrl} className="w-full" />
                    <p className="mt-2 break-all text-xs text-zinc-500">{rawVoicePreviewPath}</p>
                  </div>
                ) : ('''

raw_preview_replacement = '''                {rawVoicePreviewUrl ? (
                  <div className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium text-zinc-200">Raw Qwen Voice Preview</p>
                      <button
                        type="button"
                        onClick={useRawPreviewAsIndexReference}
                        className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/10"
                      >
                        Use Raw as Index Reference
                      </button>
                    </div>
                    <audio controls preload="metadata" src={rawVoicePreviewUrl} className="w-full" />
                    <p className="mt-2 break-all text-xs text-zinc-500">{rawVoicePreviewPath}</p>
                  </div>
                ) : ('''

if "Use Raw as Index Reference" not in text:
    if raw_preview_marker not in text:
        raise RuntimeError("Missing raw preview UI marker.")
    text = text.replace(raw_preview_marker, raw_preview_replacement, 1)

tuned_preview_marker = '''                {tunedVoicePreviewUrl ? (
                  <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-2 text-sm font-medium text-zinc-200">Tuned Voice Preview</p>
                    <audio controls preload="metadata" src={tunedVoicePreviewUrl} className="w-full" />
                    <p className="mt-2 break-all text-xs text-zinc-500">{tunedVoicePreviewPath}</p>
                  </div>
                ) : null}'''

tuned_preview_replacement = '''                {tunedVoicePreviewUrl ? (
                  <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium text-zinc-200">Tuned Voice Preview</p>
                      <button
                        type="button"
                        onClick={useTunedPreviewAsIndexReference}
                        className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/10"
                      >
                        Use Tuned as Index Reference
                      </button>
                    </div>
                    <audio controls preload="metadata" src={tunedVoicePreviewUrl} className="w-full" />
                    <p className="mt-2 break-all text-xs text-zinc-500">{tunedVoicePreviewPath}</p>
                  </div>
                ) : null}

                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <p className="text-sm font-semibold text-emerald-100">Selected Index Voice Reference</p>
                  {selectedIndexVoiceReference ? (
                    <div className="mt-2 space-y-1 text-xs text-zinc-300">
                      <p>Source: {selectedIndexVoiceReference.source === "tuned_voice_fx" ? "Tuned Voice FX Preview" : "Raw Qwen Preview"}</p>
                      <p>Engine: {String(selectedIndexVoiceReference.engine || "")}</p>
                      <p className="break-all text-zinc-500">Path: {String(selectedIndexVoiceReference.audioPath || "")}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-zinc-500">
                      No Index voice reference selected yet. Generate a raw preview or apply Voice FX, then choose which reference Index should use.
                    </p>
                  )}
                </div>'''

if "Selected Index Voice Reference" not in text:
    if tuned_preview_marker not in text:
        raise RuntimeError("Missing tuned preview UI marker.")
    text = text.replace(tuned_preview_marker, tuned_preview_replacement, 1)

required = [
    "selectedIndexVoiceReference",
    "buildIndexVoiceReference",
    "useRawPreviewAsIndexReference",
    "useTunedPreviewAsIndexReference",
    "Use Raw as Index Reference",
    "Use Tuned as Index Reference",
    "Selected Index Voice Reference",
    "indexVoiceReferencePath",
    "indexVoiceReferenceSource",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: Index voice reference lock-in patched.")
print("Changed:", panel)
print("Backup:", backup_dir)
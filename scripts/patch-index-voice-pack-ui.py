from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("index-voice-pack-ui-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

# 1. Add Index voice-pack state.
state_anchor = "  const [selectedIndexVoiceReference, setSelectedIndexVoiceReference] = useState<any | null>(null);"

if "const [indexVoicePack, setIndexVoicePack]" not in text:
    if state_anchor not in text:
        raise RuntimeError("Missing selectedIndexVoiceReference state anchor.")
    text = text.replace(
        state_anchor,
        state_anchor + "\n  const [indexVoicePack, setIndexVoicePack] = useState<any | null>(null);",
        1,
    )

# 2. Restore from draft.
restore_anchor = '''      if ("selectedIndexVoiceReference" in saved) setSelectedIndexVoiceReference(saved.selectedIndexVoiceReference || null);'''

if 'if ("indexVoicePack" in saved) setIndexVoicePack(saved.indexVoicePack || null);' not in text:
    if restore_anchor not in text:
        raise RuntimeError("Missing selectedIndexVoiceReference draft restore anchor.")
    text = text.replace(
        restore_anchor,
        restore_anchor + '\n      if ("indexVoicePack" in saved) setIndexVoicePack(saved.indexVoicePack || null);',
        1,
    )

# 3. Persist to draft.
persist_anchor = '''        selectedIndexVoiceReference,
      },'''

if "        indexVoicePack," not in text:
    if persist_anchor not in text:
        raise RuntimeError("Missing selectedIndexVoiceReference draft persist anchor.")
    text = text.replace(
        persist_anchor,
        '''        selectedIndexVoiceReference,
        indexVoicePack,
      },''',
        1,
    )

deps_anchor = '''    selectedIndexVoiceReference,
  ]);'''

if "    indexVoicePack,\n  ]);" not in text:
    if deps_anchor not in text:
        raise RuntimeError("Missing selectedIndexVoiceReference draft dependency anchor.")
    text = text.replace(
        deps_anchor,
        '''    selectedIndexVoiceReference,
    indexVoicePack,
  ]);''',
        1,
    )

# 4. Clear voice pack on reset.
reset_start = text.find("  function resetBuilder() {")
if reset_start == -1:
    raise RuntimeError("Missing resetBuilder function.")

reset_end = text.find("\n  }\n", reset_start)
if reset_end == -1:
    raise RuntimeError("Could not find resetBuilder end.")

reset_block = text[reset_start:reset_end]
if "setIndexVoicePack(null);" not in reset_block:
    text = text[:reset_end] + "    setIndexVoicePack(null);\n" + text[reset_end:]

# 5. Clear generated pack when choosing/changing reference.
if 'setIndexVoicePack(null);' not in text[text.find("  function useRawPreviewAsIndexReference"):text.find("  function useTunedPreviewAsIndexReference")]:
    raw_anchor = '''    setSelectedIndexVoiceReference(record);
    setMessage("Raw Qwen preview selected as the Index voice reference.");'''
    raw_replacement = '''    setSelectedIndexVoiceReference(record);
    setIndexVoicePack(null);
    setMessage("Raw Qwen preview selected as the Index voice reference.");'''
    if raw_anchor not in text:
        raise RuntimeError("Missing raw reference setter anchor.")
    text = text.replace(raw_anchor, raw_replacement, 1)

tuned_start = text.find("  function useTunedPreviewAsIndexReference")
save_start = text.find("  async function saveCharacter")
if tuned_start == -1 or save_start == -1:
    raise RuntimeError("Missing tuned reference/save function anchors.")

if "setIndexVoicePack(null);" not in text[tuned_start:save_start]:
    tuned_anchor = '''    setSelectedIndexVoiceReference(record);
    setMessage("Tuned Voice FX preview selected as the Index voice reference.");'''
    tuned_replacement = '''    setSelectedIndexVoiceReference(record);
    setIndexVoicePack(null);
    setMessage("Tuned Voice FX preview selected as the Index voice reference.");'''
    if tuned_anchor not in text:
        raise RuntimeError("Missing tuned reference setter anchor.")
    text = text.replace(tuned_anchor, tuned_replacement, 1)

# 6. Add generateIndexVoicePack function before saveCharacter.
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

if "async function generateIndexVoicePack" not in text:
    save_anchor = "  async function saveCharacter() {"
    if save_anchor not in text:
        raise RuntimeError("Missing saveCharacter anchor.")
    text = text.replace(save_anchor, generate_fn + save_anchor, 1)

# 7. Include indexVoicePack in save payload.
if "indexVoicePackPath" not in text:
    payload_anchor = '''          indexVoiceReferenceUrl: selectedIndexVoiceReference?.audioUrl || "",
          indexVoiceReferenceSource: selectedIndexVoiceReference?.source || "",
          voiceEngineUsed: "IndexTTS2 direct",'''
    payload_replacement = '''          indexVoiceReferenceUrl: selectedIndexVoiceReference?.audioUrl || "",
          indexVoiceReferenceSource: selectedIndexVoiceReference?.source || "",
          indexVoicePack,
          indexVoicePackPath: indexVoicePack?.voicePackPath || "",
          voiceEngineUsed: "IndexTTS2 direct",'''

    if payload_anchor not in text:
        raise RuntimeError("Missing save payload index voice reference anchor.")
    text = text.replace(payload_anchor, payload_replacement, 1)

# 8. Add UI panel before tuned preview.
voice_pack_ui = '''                <div className="mt-4 rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
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

if "Generate Index Voice Pack" not in text:
    marker = '''                {tunedVoicePreviewUrl ? ('''
    if marker not in text:
        raise RuntimeError("Missing tunedVoicePreviewUrl marker for Index voice pack UI insertion.")
    text = text.replace(marker, voice_pack_ui + marker, 1)

# Verify.
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

print("OK: Index voice-pack UI patched.")
print("Changed:", panel)
print("Backup:", backup_dir)
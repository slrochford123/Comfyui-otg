from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("character-builder-draft-navigation-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")
original = text

# 1. Add useRef import.
text = text.replace(
    'import React, { useEffect, useMemo, useState } from "react";',
    'import React, { useEffect, useMemo, useRef, useState } from "react";',
)

# 2. Add draft/navigation constants.
constants_anchor = 'const SPECIES_TRAITS = ["rat-like", "angelic", "robotic", "monstrous", "cute", "bunny-like", "reptilian", "fantasy creature", "custom"];'

draft_constants = '''
const CHARACTER_BUILDER_DRAFT_VERSION = 1;
const CHARACTER_BUILDER_DRAFT_KEY = `${CHARACTER_DEVICE_ID}:character_builder_draft:v${CHARACTER_BUILDER_DRAFT_VERSION}`;
const BUILDER_STEP_ORDER = ["source", "card", "details", "voice", "review"] as const;

function normalizeBuilderStepForNav(value: string) {
  if (value === "generate" || value === "upload") return "source";
  return value;
}
'''

if "CHARACTER_BUILDER_DRAFT_KEY" not in text:
    if constants_anchor not in text:
        raise RuntimeError("Missing SPECIES_TRAITS anchor.")
    text = text.replace(constants_anchor, constants_anchor + "\n" + draft_constants, 1)

# 3. Add hydrated ref after voice FX preview if possible, otherwise after voicePreview.
state_anchor_preferred = '  const [voiceFxPreview, setVoiceFxPreview] = useState<any | null>(null);'
state_anchor_fallback = '  const [voicePreview, setVoicePreview] = useState<any | null>(null);'

if "characterDraftHydratedRef" not in text:
    if state_anchor_preferred in text:
        text = text.replace(
            state_anchor_preferred,
            state_anchor_preferred + '\n  const characterDraftHydratedRef = useRef(false);',
            1,
        )
    elif state_anchor_fallback in text:
        text = text.replace(
            state_anchor_fallback,
            state_anchor_fallback + '\n  const characterDraftHydratedRef = useRef(false);',
            1,
        )
    else:
        raise RuntimeError("Missing voice preview state anchor.")

# 4. Add draft restore/persist effects after loadCharacters effect.
load_effect = '''  useEffect(() => {
    void loadCharacters();
  }, []);
'''

draft_effects = '''  useEffect(() => {
    void loadCharacters();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(CHARACTER_BUILDER_DRAFT_KEY);
      if (!raw) {
        characterDraftHydratedRef.current = true;
        return;
      }

      const draft = JSON.parse(raw);
      if (!draft || draft.version !== CHARACTER_BUILDER_DRAFT_VERSION || !draft.state) {
        characterDraftHydratedRef.current = true;
        return;
      }

      const saved = draft.state;

      if (saved.step) setStep(saved.step);
      if (typeof saved.generationPrompt === "string") setGenerationPrompt(saved.generationPrompt);
      if (Array.isArray(saved.candidates)) setCandidates(saved.candidates);
      if (typeof saved.selectedCandidateId === "string") setSelectedCandidateId(saved.selectedCandidateId);
      if ("uploadedImage" in saved) setUploadedImage(saved.uploadedImage || null);
      if (saved.imageCompleteness) setImageCompleteness(saved.imageCompleteness);
      if (typeof saved.missingGuidance === "string") setMissingGuidance(saved.missingGuidance);
      if ("selectedFullBody" in saved) setSelectedFullBody(saved.selectedFullBody || null);
      if ("characterCard" in saved) setCharacterCard(saved.characterCard || null);
      if (saved.details) setDetails({ ...DEFAULT_DETAILS, ...saved.details });
      if (saved.voice) setVoice({ ...DEFAULT_VOICE, ...saved.voice });
      if (saved.qwenVoiceDesign) setQwenVoiceDesign(saved.qwenVoiceDesign);
      if (Array.isArray(saved.qwenVoiceCandidates)) setQwenVoiceCandidates(saved.qwenVoiceCandidates);
      if (typeof saved.selectedQwenVoiceCandidateId === "string") setSelectedQwenVoiceCandidateId(saved.selectedQwenVoiceCandidateId);
      if ("qwenVoiceDesignRecord" in saved) setQwenVoiceDesignRecord(saved.qwenVoiceDesignRecord || null);
      if (typeof saved.voicePackCreated === "boolean") setVoicePackCreated(saved.voicePackCreated);
      if ("voicePackRecord" in saved) setVoicePackRecord(saved.voicePackRecord || null);
      if ("voicePreview" in saved) setVoicePreview(saved.voicePreview || null);
      if (saved.voiceFx) setVoiceFx({ ...DEFAULT_VOICE_FX, ...saved.voiceFx });
      if ("voiceFxPreview" in saved) setVoiceFxPreview(saved.voiceFxPreview || null);

      setMessage("Restored saved character creation progress.");
    } catch {
      // Bad local draft should not break the builder.
    } finally {
      characterDraftHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!characterDraftHydratedRef.current) return;

    const draft = {
      version: CHARACTER_BUILDER_DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      state: {
        step,
        generationPrompt,
        candidates,
        selectedCandidateId,
        uploadedImage,
        imageCompleteness,
        missingGuidance,
        selectedFullBody,
        characterCard,
        details,
        voice,
        qwenVoiceDesign,
        qwenVoiceCandidates,
        selectedQwenVoiceCandidateId,
        qwenVoiceDesignRecord,
        voicePackCreated,
        voicePackRecord,
        voicePreview,
        voiceFx,
        voiceFxPreview,
      },
    };

    try {
      window.localStorage.setItem(CHARACTER_BUILDER_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Ignore quota/private-mode failures.
    }
  }, [
    step,
    generationPrompt,
    candidates,
    selectedCandidateId,
    uploadedImage,
    imageCompleteness,
    missingGuidance,
    selectedFullBody,
    characterCard,
    details,
    voice,
    qwenVoiceDesign,
    qwenVoiceCandidates,
    selectedQwenVoiceCandidateId,
    qwenVoiceDesignRecord,
    voicePackCreated,
    voicePackRecord,
    voicePreview,
    voiceFx,
    voiceFxPreview,
  ]);
'''

if "Restored saved character creation progress." not in text:
    if load_effect not in text:
        raise RuntimeError("Missing loadCharacters useEffect anchor.")
    text = text.replace(load_effect, draft_effects, 1)

# 5. Remove local draft when Start Over runs.
reset_anchor = '  function resetBuilder() {'
reset_injection = '''  function resetBuilder() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CHARACTER_BUILDER_DRAFT_KEY);
    }'''

if "localStorage.removeItem(CHARACTER_BUILDER_DRAFT_KEY)" not in text:
    if reset_anchor not in text:
        raise RuntimeError("Missing resetBuilder anchor.")
    text = text.replace(reset_anchor, reset_injection, 1)

# 6. Add navigation helper functions before loadCharacters.
load_characters_anchor = "  async function loadCharacters() {"

nav_helpers = '''  function currentBuilderStepIndex() {
    const normalized = normalizeBuilderStepForNav(step);
    const found = BUILDER_STEP_ORDER.findIndex((item) => item === normalized);
    return found >= 0 ? found : 0;
  }

  function goToBuilderStepByOffset(offset: number) {
    const currentIndex = currentBuilderStepIndex();
    const nextIndex = Math.max(0, Math.min(BUILDER_STEP_ORDER.length - 1, currentIndex + offset));
    setStep(BUILDER_STEP_ORDER[nextIndex] as any);
  }

'''

if "function goToBuilderStepByOffset" not in text:
    if load_characters_anchor not in text:
        raise RuntimeError("Missing loadCharacters function anchor.")
    text = text.replace(load_characters_anchor, nav_helpers + load_characters_anchor, 1)

# 7. Make Start Over red/larger.
old_start_over = '''          <button type="button" onClick={resetBuilder} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-amber-300 hover:text-amber-200">
            Start Over
          </button>'''

new_start_over = '''          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => goToBuilderStepByOffset(-1)}
              disabled={currentBuilderStepIndex() === 0}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 disabled:opacity-40 hover:border-cyan-300 hover:text-cyan-100"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => goToBuilderStepByOffset(1)}
              disabled={currentBuilderStepIndex() === BUILDER_STEP_ORDER.length - 1}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 disabled:opacity-40 hover:border-cyan-300 hover:text-cyan-100"
            >
              Next
            </button>
            <button
              type="button"
              onClick={resetBuilder}
              className="rounded-2xl border border-red-400 bg-red-600/20 px-6 py-3 text-base font-black text-red-100 shadow-[0_0_28px_rgba(239,68,68,0.18)] transition hover:bg-red-500 hover:text-white"
            >
              Start Over
            </button>
          </div>'''

if "shadow-[0_0_28px_rgba(239,68,68,0.18)]" not in text:
    if old_start_over not in text:
        raise RuntimeError("Missing Start Over button anchor.")
    text = text.replace(old_start_over, new_start_over, 1)

# 8. Add a small save-status note under the step chips.
step_chips_end = '''        </div>
        {message ? <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{message}</div> : null}
'''

autosave_note = '''        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Character creation progress auto-saves on this device. Use Back / Next to move through steps without losing work.
        </p>
        {message ? <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{message}</div> : null}
'''

if "Character creation progress auto-saves on this device" not in text:
    if step_chips_end not in text:
        raise RuntimeError("Missing step chips end anchor.")
    text = text.replace(step_chips_end, autosave_note, 1)

required = [
    "useRef",
    "CHARACTER_BUILDER_DRAFT_KEY",
    "characterDraftHydratedRef",
    "Restored saved character creation progress.",
    "localStorage.removeItem(CHARACTER_BUILDER_DRAFT_KEY)",
    "goToBuilderStepByOffset",
    "Character creation progress auto-saves on this device",
    "Start Over",
    "bg-red-600/20",
]

for item in required:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

if text == original:
    raise RuntimeError("No changes made.")

panel.write_text(text, encoding="utf-8")

print("OK: Character builder draft save/navigation patched.")
print("Changed:", panel)
print("Backup:", backup_dir)
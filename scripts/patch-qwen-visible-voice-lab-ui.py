from pathlib import Path
from datetime import datetime
import re
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("qwen-visible-voice-lab-ui-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")

required = [
    '{step === "voice" ? (',
    '<Panel title="Voice Lab">',
    '{step === "review" ? (',
    "generateQwenVoiceDesignCandidates",
    "useQwenVoiceCandidate",
    "selectedQwenVoiceCandidate",
    "createVoicePack",
]

for item in required:
    if item not in text:
        raise RuntimeError("Missing required anchor: " + item)

pattern = re.compile(
    r'          \{step === "voice" \? \([\s\S]*?          \) : null\}\n\n          \{step === "review" \? \('
)

replacement = '''          {step === "voice" ? (
            <Panel title="Qwen3-TTS Voice Design">
              <p className="mb-4 text-sm text-zinc-400">
                Build a precise Qwen3-TTS VoiceDesign instruction. Generate options, pick one, then save the selected voice design.
              </p>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
                <div className="space-y-5">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-3 text-sm font-semibold text-zinc-100">1. Voice Identity</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <SelectField
                        label="Voice type"
                        value={qwenVoiceDesign.voiceType}
                        options={Object.keys(QWEN_VOICE_TYPE_LABELS)}
                        onChange={(value) => setQwenVoiceField("voiceType", value as QwenVoiceType)}
                      />
                      <SelectField
                        label="Age / maturity"
                        value={qwenVoiceDesign.ageMaturity}
                        options={["child", "teen", "young_adult", "adult", "middle_aged", "elderly", "ancient", "creature"]}
                        onChange={(value) => setQwenVoiceField("ageMaturity", value as any)}
                      />
                      <SelectField
                        label="Gender expression"
                        value={qwenVoiceDesign.genderExpression}
                        options={["male", "female", "androgynous", "creature_non_human"]}
                        onChange={(value) => setQwenVoiceField("genderExpression", value as any)}
                      />
                      <TextField
                        label="Species / body context"
                        value={qwenVoiceDesign.speciesContext}
                        onChange={(value) => setQwenVoiceField("speciesContext", value)}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-3 text-sm font-semibold text-zinc-100">2. Voice Texture</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <SelectField
                        label="Pitch"
                        value={qwenVoiceDesign.pitch}
                        options={["very_low", "low", "medium_low", "medium", "medium_high", "high", "very_high"]}
                        onChange={(value) => setQwenVoiceField("pitch", value as any)}
                      />
                      <SelectField
                        label="Resonance"
                        value={qwenVoiceDesign.resonance}
                        options={["thin", "nasal", "throat_heavy", "chest_heavy", "round", "hollow", "rumbling", "bright"]}
                        onChange={(value) => setQwenVoiceField("resonance", value as any)}
                      />
                      <SelectField
                        label="Texture strength"
                        value={qwenVoiceDesign.textureStrength}
                        options={["subtle", "moderate", "strong"]}
                        onChange={(value) => setQwenVoiceField("textureStrength", value as any)}
                      />
                      <SelectField
                        label="Variation amount"
                        value={qwenVoiceDesign.variationAmount}
                        options={["low", "medium", "high"]}
                        onChange={(value) => setQwenVoiceField("variationAmount", value as any)}
                      />
                    </div>

                    <p className="mt-4 text-xs text-zinc-500">Choose up to 3 texture tags. Too many tags makes the voice prompt weaker.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["clean", "warm", "breathy", "raspy", "gravelly", "smooth", "dry", "scratchy", "whispery", "rumbling", "squeaky", "hiss_edged", "metallic", "animal_like"].map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleQwenTexture(tag as QwenTextureTag)}
                          className={classNames(
                            "rounded-full border px-3 py-1.5 text-xs",
                            qwenVoiceDesign.textureTags.includes(tag as QwenTextureTag)
                              ? "border-amber-300 bg-amber-300/10 text-amber-100"
                              : "border-zinc-800 text-zinc-300 hover:border-zinc-600",
                          )}
                        >
                          {tag.replace(/_/g, " ")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-3 text-sm font-semibold text-zinc-100">3. Delivery / Realism</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <SelectField
                        label="Pace"
                        value={qwenVoiceDesign.pace}
                        options={["slow", "natural", "quick", "very_quick"]}
                        onChange={(value) => setQwenVoiceField("pace", value as any)}
                      />
                      <SelectField
                        label="Energy"
                        value={qwenVoiceDesign.energy}
                        options={["low", "medium", "high"]}
                        onChange={(value) => setQwenVoiceField("energy", value as any)}
                      />
                      <SelectField
                        label="Style"
                        value={qwenVoiceDesign.style}
                        options={["realistic", "cinematic", "animated", "cartoon", "creature_like", "radio_clean", "gritty"]}
                        onChange={(value) => setQwenVoiceField("style", value as any)}
                      />
                      <SelectField
                        label="Acting intensity"
                        value={qwenVoiceDesign.actingIntensity}
                        options={["plain_neutral", "light_character", "strong_character"]}
                        onChange={(value) => setQwenVoiceField("actingIntensity", value as any)}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-3 text-sm font-semibold text-zinc-100">4. Avoid / Notes</p>
                    <TextArea
                      label="Avoid list, comma-separated"
                      value={qwenVoiceDesign.avoidTags.join(", ")}
                      onChange={(value) => {
                        const avoidTags = value.split(",").map((item) => item.trim()).filter(Boolean);
                        setQwenVoiceField("avoidTags", avoidTags);
                      }}
                    />
                    <div className="mt-4">
                      <TextArea
                        label="Extra voice notes"
                        value={qwenVoiceDesign.customNotes}
                        onChange={(value) => setQwenVoiceField("customNotes", value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-3 text-sm font-semibold text-zinc-100">Preview Setup</p>
                    <SelectField
                      label="Preview line"
                      value={qwenVoiceDesign.previewLineId}
                      options={["neutral_standard", "character_intro", "dialogue_test"]}
                      onChange={(value) => setQwenVoiceField("previewLineId", value as any)}
                    />
                    <div className="mt-3 rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-300">
                      {QWEN_PREVIEW_LINES[qwenVoiceDesign.previewLineId]}
                    </div>
                    <SelectField
                      label="Candidate count"
                      value={String(qwenVoiceDesign.candidateCount)}
                      options={["3", "5"]}
                      onChange={(value) => setQwenVoiceField("candidateCount", Number(value) === 5 ? 5 : 3)}
                    />
                    <button
                      type="button"
                      onClick={generateQwenVoiceDesignCandidates}
                      className="mt-4 rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950"
                    >
                      Generate Voice Design Options
                    </button>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-3 text-sm font-semibold text-zinc-100">Voice Options</p>
                    {qwenVoiceCandidates.length === 0 ? (
                      <p className="text-sm text-zinc-500">Generate options to see Qwen prompt candidates.</p>
                    ) : (
                      <div className="space-y-3">
                        {qwenVoiceCandidates.map((candidate) => (
                          <div
                            key={candidate.candidateId}
                            className={classNames(
                              "rounded-xl border p-3",
                              selectedQwenVoiceCandidateId === candidate.candidateId
                                ? "border-amber-300 bg-amber-300/10"
                                : "border-zinc-800 bg-black/20",
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-zinc-100">{candidate.label}</p>
                              <button
                                type="button"
                                onClick={() => useQwenVoiceCandidate(candidate)}
                                className="rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-100"
                              >
                                Use This Voice Design
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-zinc-400">{candidate.variantInstruction}</p>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs text-zinc-500">Show generated Qwen prompt</summary>
                              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-zinc-300">
                                {candidate.fullInstruction}
                              </pre>
                            </details>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Selected Voice Design</p>
                    {selectedQwenVoiceCandidate ? (
                      <div className="mt-3 space-y-2 text-sm text-zinc-300">
                        <p>{selectedQwenVoiceCandidate.label}</p>
                        <p className="text-xs text-zinc-500">{selectedQwenVoiceCandidate.variantInstruction}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-zinc-500">No Qwen voice design selected yet.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={createVoicePack}
                  disabled={loading || !selectedQwenVoiceCandidate}
                  className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
                >
                  {loading ? "Creating Voice..." : "Create Voice"}
                </button>
                <button
                  type="button"
                  disabled={true}
                  className="rounded-xl border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-100 opacity-40"
                >
                  Generate Qwen Audio Preview - Patch 3
                </button>
                <button
                  type="button"
                  onClick={() => setStep("review")}
                  disabled={!voicePackCreated}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100 disabled:opacity-40"
                >
                  Continue to Review & Save
                </button>
                {voicePackRecord ? (
                  <p className="w-full text-xs text-emerald-300">
                    Voice design metadata saved. Status: {String(voicePackRecord.status || "metadata_only")}.
                  </p>
                ) : null}
              </div>
            </Panel>
          ) : null}

          {step === "review" ? ('''

text, count = pattern.subn(replacement, text, count=1)

if count != 1:
    raise RuntimeError("Failed to replace Voice Lab panel block.")

verify = [
    'Panel title="Qwen3-TTS Voice Design"',
    "Generate Voice Design Options",
    "Use This Voice Design",
    "Generate Qwen Audio Preview - Patch 3",
    "selectedQwenVoiceCandidate",
]

for item in verify:
    if item not in text:
        raise RuntimeError("Verification failed. Missing: " + item)

panel.write_text(text, encoding="utf-8")

print("OK: visible Voice Lab UI replaced with Qwen3-TTS Voice Design UI.")
print("Changed:", panel)
print("Backup:", backup_dir)

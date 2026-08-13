"use client";

import React from "react";
import {
  DELIVERY_STYLES,
  VOICE_AGE_RANGES,
  VOICE_ENERGIES,
  VOICE_GENDER_PRESENTATIONS,
  VOICE_PACES,
  VOICE_PITCHES,
  VOICE_TIMBRES,
  VOICE_TONES,
  accentOptionsForModel,
  buildVoiceRequestPayload,
  defaultVoiceDesignProfile,
  type VoiceDesignModelId,
  type VoiceDesignProfile,
} from "@/lib/characters/voiceDesignModels";

type CharacterAsset = {
  imageUrl: string;
  serverPath?: string;
};

type SavedCharacterRecord = {
  id: string;
  name: string;
  imagePath: string;
  previewImagePath?: string;
  defaultCharacterImagePath?: string;
  defaultCharacterPreviewImagePath?: string;
  backgroundRemovedDefaultImagePath?: string;
  characterCardPath?: string;
  characterCardWorkflowImagePath?: string;
  description: string;
  referenceAudioPath?: string;
  voiceEngineUsed?: string;
  globalPromptIdentityBlock?: string;
  voiceSettings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type VoiceProviderId = "qwen3" | "cosy" | "ltx";
type VoiceSource = "generated" | "uploaded_reference";

type VoiceAsset = {
  path: string;
  url: string;
  provider: VoiceProviderId | "uploaded";
  source: VoiceSource;
  jobId: string;
  label: string;
};

type VoiceFxState = {
  pitchSemitones: number;
  grit: number;
  gainDb: number;
  echoDelayMs: number;
  echoDecay: number;
  compression: number;
};

const DEFAULT_FX: VoiceFxState = {
  pitchSemitones: 0,
  grit: 0,
  gainDb: 0,
  echoDelayMs: 0,
  echoDecay: 0,
  compression: 30,
};

const PROVIDERS: Array<{
  model: VoiceDesignModelId;
  provider: VoiceProviderId;
  label: string;
  detail: string;
}> = [
  {
    model: "qwen3tts",
    provider: "qwen3",
    label: "Qwen3-TTS",
    detail: "Natural-language character voice design.",
  },
  {
    model: "cosyvoice",
    provider: "cosy",
    label: "CosyVoice",
    detail: "Character voice generation with instruction-driven delivery.",
  },
  {
    model: "ltxvoice",
    provider: "ltx",
    label: "LTX Voice",
    detail: "Experimental accent-capable voice generation from hidden LTX audition audio.",
  },
];

function getCharacterDeviceId() {
  if (typeof window === "undefined") return "character-web";
  const storageKey = "otg_character_device_id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;
  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `character-${crypto.randomUUID()}`
      : `character-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(storageKey, value);
  return value;
}

function pretty(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactAppearance(value: string) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= 420) return cleaned;
  const clipped = cleaned.slice(0, 420);
  const lastBoundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf(", "), clipped.lastIndexOf("; "));
  return (lastBoundary > 220 ? clipped.slice(0, lastBoundary + 1) : clipped).trim();
}

function buildIdentityBlock(name: string, appearance: string) {
  return `Character identity: ${name}. Appearance: ${appearance}. Use the name "${name}" for this referenced character.`;
}

function characterAssetUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.startsWith("/api/") || raw.startsWith("/_next/")) return raw;

  if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw.slice(1))}`;
  }
  if (/^\/(?:home|opt|var|mnt|srv|tmp|run|data)(?:\/|$)/.test(raw)) {
    return `/api/file?path=${encodeURIComponent(raw)}`;
  }
  if (raw.startsWith("/")) return raw;
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.includes("\\data\\")) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw)}`;
  }
  if (raw.includes("/data/")) {
    return `/api/file?path=${encodeURIComponent(raw)}`;
  }
  return raw.replace(/\\/g, "/");
}

function voiceAudioUrl(record: SavedCharacterRecord) {
  const saved = record.voiceSettings && typeof record.voiceSettings === "object"
    ? String((record.voiceSettings as Record<string, unknown>).audioUrl || "").trim()
    : "";
  return saved || (record.referenceAudioPath ? `/api/file?path=${encodeURIComponent(record.referenceAudioPath)}` : "");
}

function voiceStyleSummary(profile: VoiceDesignProfile) {
  return [
    pretty(profile.ageRange),
    pretty(profile.genderPresentation),
    profile.tone,
    `${pretty(profile.pitch)} pitch`,
    `${pretty(profile.pace)} pace`,
    `${pretty(profile.energy)} energy`,
    `${profile.timbre} timbre`,
    profile.deliveryStyle,
  ].join(", ");
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm font-semibold text-white outline-none focus:border-sky-200/60"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {pretty(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function VoicePlayButton({ url }: { url: string }) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  if (!url) {
    return (
      <button
        type="button"
        disabled
        className="min-h-10 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-bold text-white/30"
      >
        No Voice
      </button>
    );
  }

  async function toggle() {
    if (!audioRef.current) {
      const audio = new Audio(url);
      audio.preload = "none";
      audio.addEventListener("ended", () => setPlaying(false));
      audio.addEventListener("pause", () => setPlaying(false));
      audioRef.current = audio;
    }

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }

    try {
      await audioRef.current.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      className="min-h-10 rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-3 text-xs font-black text-cyan-100 transition hover:bg-cyan-400/20"
      data-otg="character-gallery-play-voice"
    >
      {playing ? "Pause Voice" : "Play Voice"}
    </button>
  );
}

export function SavedCharacterLibrary() {
  const [items, setItems] = React.useState<SavedCharacterRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/characters", {
        cache: "no-store",
        credentials: "include",
        headers: { "x-otg-device-id": getCharacterDeviceId() },
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "Could not load saved characters.");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved characters.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-[28px] border border-sky-300/15 bg-sky-400/[0.045] p-5 sm:p-6" data-otg="character-saved-gallery-phase11">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-200/70">Saved Characters</div>
          <p className="mt-1 text-xs leading-5 text-white/45">
            Character image, compact identity, and canonical voice reference used later by Production.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-bold text-white/75"
        >
          Refresh
        </button>
      </div>

      {loading ? <div className="mt-4 text-sm text-white/45">Loading saved characters...</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{error}</div> : null}

      {!loading && !error && items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-5 text-sm text-white/40">
          No completed characters saved yet.
        </div>
      ) : null}

      {items.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const imagePath =
              item.defaultCharacterPreviewImagePath ||
              item.defaultCharacterImagePath ||
              item.backgroundRemovedDefaultImagePath ||
              item.previewImagePath ||
              item.imagePath ||
              item.characterCardPath ||
              item.characterCardWorkflowImagePath ||
              "";
            const audioUrl = voiceAudioUrl(item);
            return (
              <article key={item.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                <div className="aspect-[4/5] bg-black/40">
                  {imagePath ? (
                    <img
                      src={characterAssetUrl(imagePath)}
                      alt={item.name}
                      draggable={false}
                      onContextMenu={(event) => event.preventDefault()}
                      className="h-full w-full object-contain"
                    />
                  ) : null}
                </div>
                <div className="space-y-3 p-4">
                  <div>
                    <h3 className="text-lg font-black text-white">{item.name}</h3>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/55">
                      {item.description || "No appearance description saved."}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/35">
                      {item.voiceEngineUsed || (audioUrl ? "Saved Voice" : "Voice Pending")}
                    </span>
                    <VoicePlayButton url={audioUrl} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export default function CharacterIdentityVoicePanel({
  mode,
  appearanceSeed,
  processedImage,
  characterCard,
  onBackToCard,
  onSaved,
}: {
  mode: "standard" | "freeform";
  appearanceSeed: string;
  processedImage: CharacterAsset;
  characterCard: CharacterAsset;
  onBackToCard: () => void;
  onSaved: (character: SavedCharacterRecord) => void;
}) {
  const [stage, setStage] = React.useState<"identity" | "voice">("identity");
  const [name, setName] = React.useState("");
  const [appearance, setAppearance] = React.useState(() => compactAppearance(appearanceSeed));
  const [character, setCharacter] = React.useState<SavedCharacterRecord | null>(null);
  const [voiceProfile, setVoiceProfile] = React.useState<VoiceDesignProfile>(() =>
    defaultVoiceDesignProfile({
      model: "qwen3tts",
      mode: "voice_design",
      language: "English",
      sampleText: "Hello. This is my character voice. I am ready for the next scene.",
    }),
  );
  const [baseVoice, setBaseVoice] = React.useState<VoiceAsset | null>(null);
  const [finalVoice, setFinalVoice] = React.useState<VoiceAsset | null>(null);
  const [voiceFx, setVoiceFx] = React.useState<VoiceFxState>(DEFAULT_FX);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");

  const selectedProvider = PROVIDERS.find((item) => item.model === voiceProfile.model) || PROVIDERS[0];
  const ltxAccents = voiceProfile.model === "ltxvoice" ? accentOptionsForModel(voiceProfile) : [];

  function setProfileField<K extends keyof VoiceDesignProfile>(key: K, value: VoiceDesignProfile[K]) {
    setVoiceProfile((current) => ({ ...current, [key]: value }));
  }

  function selectProvider(model: VoiceDesignModelId) {
    const nextProvider = PROVIDERS.find((item) => item.model === model) || PROVIDERS[0];
    setVoiceProfile((current) =>
      defaultVoiceDesignProfile({
        ...current,
        model,
        mode: model === "cosyvoice" ? "instruct" : "voice_design",
        modelVersion: "cosyvoice3",
        language: "English",
        accentDialectId: model === "ltxvoice" ? "general_american" : "neutral_american_english",
      }),
    );
    setBaseVoice(null);
    setFinalVoice(null);
    setMessage(`${nextProvider.label} selected.`);
    setError("");
  }

  async function saveIdentity() {
    const cleanName = name.trim();
    const cleanAppearance = appearance.trim();
    if (!cleanName) {
      setError("Character name is required.");
      return;
    }
    if (!cleanAppearance) {
      setError("A short appearance description is required.");
      return;
    }
    if (!processedImage.serverPath || !characterCard.serverPath) {
      setError("Processed character image and accepted Character Card are required.");
      return;
    }

    setBusy("identity");
    setError("");
    setMessage("Saving character identity...");
    try {
      const identityBlock = buildIdentityBlock(cleanName, cleanAppearance);
      const response = await fetch("/api/characters", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-device-id": getCharacterDeviceId(),
        },
        body: JSON.stringify({
          action: "create",
          name: cleanName,
          imagePath: processedImage.serverPath,
          previewImagePath: processedImage.serverPath,
          transparentImagePath: processedImage.serverPath,
          fullBodyImagePath: processedImage.serverPath,
          characterCardPath: characterCard.serverPath,
          characterCardWorkflowImagePath: characterCard.serverPath,
          characterCardPreviewImagePath: characterCard.serverPath,
          defaultCharacterImagePath: processedImage.serverPath,
          defaultCharacterPreviewImagePath: processedImage.serverPath,
          defaultCharacterSourceImagePath: processedImage.serverPath,
          backgroundRemovedDefaultImagePath: processedImage.serverPath,
          defaultCharacterImageStatus: "background_removed",
          description: cleanAppearance,
          voiceStyleDefinition: "",
          introLine: "",
          source: "character-hub-3003",
          metadata: {
            characterHubPhase: "identity-voice-phase11",
            mode,
            voiceStatus: "pending",
          },
          globalPromptIdentityBlock: identityBlock,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok || !json.character?.id) {
        throw new Error(json?.error || "Could not save character identity.");
      }
      setCharacter(json.character as SavedCharacterRecord);
      setStage("voice");
      setMessage("Name and appearance saved. Create a voice or upload an existing voice reference.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save character identity.");
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  async function pollVoiceJob(jobId: string) {
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const response = await fetch(`/api/characters/voice-pipeline/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
        credentials: "include",
        headers: { "x-otg-device-id": getCharacterDeviceId() },
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.job) throw new Error(json?.error || "Could not read voice job.");
      const job = json.job as Record<string, any>;
      const status = String(job.status || "");
      if (status === "completed") return job;
      if (["failed", "canceled", "terminated", "interrupted"].includes(status)) {
        throw new Error(String(job.error || job.message || `Voice job ${status}.`));
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("Voice creation timed out.");
  }

  function voiceAssetFromJob(job: Record<string, any>): VoiceAsset {
    const result = job.result && typeof job.result === "object" ? job.result as Record<string, any> : {};
    if (result.mock !== false) throw new Error("The voice worker did not return a verified real audio result.");
    const path = String(
      result.enhancedAudioPath ||
      result.isolatedAudioPath ||
      result.processedSamplePath ||
      result.samplePath ||
      result.outputAudioPath ||
      result.uploadedSamplePath ||
      "",
    ).trim();
    const url = String(
      result.enhancedAudioUrl ||
      result.isolatedAudioUrl ||
      result.processedSampleUrl ||
      result.sampleUrl ||
      result.outputAudioUrl ||
      result.uploadedSampleUrl ||
      "",
    ).trim();
    if (!path) throw new Error("Voice worker completed without a local canonical audio path.");
    return {
      path,
      url: url || `/api/file?path=${encodeURIComponent(path)}`,
      provider: selectedProvider.provider,
      source: "generated",
      jobId: String(job.jobId || ""),
      label: `${selectedProvider.label} generated voice`,
    };
  }

  async function generateVoice() {
    if (!character?.id) {
      setError("Save the character identity before creating a voice.");
      return;
    }

    setBusy("generate");
    setError("");
    setMessage(`Creating ${selectedProvider.label} voice...`);
    setBaseVoice(null);
    setFinalVoice(null);

    try {
      const payload = buildVoiceRequestPayload(voiceProfile);
      const instruction = String(payload.instruct || payload.prompt || "").trim();
      const requestSeed = Math.floor(Math.random() * 2147483647) + 1;
      const body: Record<string, unknown> = {
        action: "create_voice_sample",
        characterId: character.id,
        provider: selectedProvider.provider,
        voiceInstruction: instruction,
        sampleText: payload.text,
        previewText: payload.text,
        voiceDesign: payload.voiceDesign,
        modelConfig: payload,
        seed: requestSeed,
        requestSeed,
        qwenVoiceDesignRecord: {
          selectedCandidateId: "character-hub-phase11",
          voiceInstruction: instruction,
          sampleText: payload.text,
          voiceDesign: payload.voiceDesign,
          promptSnapshot: { payload },
        },
      };

      if (selectedProvider.provider === "ltx") {
        body.ltxDialect = payload.accentDialect;
        body.ltxDialectId = payload.accentDialect?.id;
        body.ltxDialectLabel = payload.accentDialect?.label;
        body.ltxSpokenLine = payload.text;
        body.ltxAuditionPrompt = payload.ltxAuditionPrompt || payload.prompt || instruction;
      }

      const response = await fetch("/api/characters/voice-pipeline", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-device-id": getCharacterDeviceId(),
        },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.job?.jobId) {
        throw new Error(json?.error || "Could not start voice creation.");
      }

      setMessage(`Voice job ${json.job.jobId} queued. Waiting for the real worker output...`);
      const completed = await pollVoiceJob(String(json.job.jobId));
      const asset = voiceAssetFromJob(completed);
      setBaseVoice(asset);
      setFinalVoice(asset);
      setMessage(`${asset.label} is ready. Listen, optionally apply effects, then save it to the character.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice creation failed.");
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  async function uploadReferenceVoice(file: File | null) {
    if (!file || !character?.id) return;
    setBusy("upload");
    setError("");
    setMessage("Uploading and normalizing voice reference...");
    setBaseVoice(null);
    setFinalVoice(null);
    try {
      const form = new FormData();
      form.set("media", file, file.name);
      const response = await fetch("/api/characters/reference-media", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": getCharacterDeviceId() },
        body: form,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok || !json.referenceAudioPath) {
        throw new Error(json?.error || "Voice reference upload failed.");
      }
      const asset: VoiceAsset = {
        path: String(json.referenceAudioPath),
        url: String(json.referenceAudioUrl || `/api/file?path=${encodeURIComponent(json.referenceAudioPath)}`),
        provider: "uploaded",
        source: "uploaded_reference",
        jobId: "uploaded-reference",
        label: `Uploaded reference: ${file.name}`,
      };
      setBaseVoice(asset);
      setFinalVoice(asset);
      setMessage("Uploaded voice reference is normalized and ready. No generated voice is required.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice reference upload failed.");
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  async function processLtx(action: "remove_background" | "enhance_voice") {
    if (!character?.id || !baseVoice || baseVoice.provider !== "ltx" || !baseVoice.jobId) return;
    setBusy(action);
    setError("");
    setMessage(action === "remove_background" ? "Removing LTX background sound/effects..." : "Enhancing LTX voice...");
    try {
      const source = finalVoice || baseVoice;
      const response = await fetch("/api/characters/voice-sample/process", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-device-id": getCharacterDeviceId(),
        },
        body: JSON.stringify({
          action,
          provider: "ltx",
          characterId: character.id,
          jobId: baseVoice.jobId,
          samplePath: source.path,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok || !json.audioPath) throw new Error(json?.error || "LTX audio processing failed.");
      setFinalVoice({
        ...baseVoice,
        path: String(json.audioPath),
        url: String(json.audioUrl || `/api/file?path=${encodeURIComponent(json.audioPath)}`),
        label: action === "remove_background" ? "LTX isolated voice" : "LTX enhanced voice",
      });
      setMessage(String(json.message || "LTX voice processing complete."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "LTX audio processing failed.");
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  async function applyVoiceFx() {
    if (!character?.id || !baseVoice) {
      setError("Create or upload a voice before applying effects.");
      return;
    }
    setBusy("fx");
    setError("");
    setMessage("Applying voice effects...");
    try {
      const inputVoice = finalVoice || baseVoice;
      const response = await fetch("/api/characters/voice-sample/effect", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-device-id": getCharacterDeviceId(),
        },
        body: JSON.stringify({
          provider: baseVoice.provider,
          effectId: "custom_voice_tuning",
          engine: "ffmpeg",
          intensity: "medium",
          samplePath: inputVoice.path,
          characterId: character.id,
          jobId: baseVoice.jobId || "manual",
          controls: {
            pitchSemitones: voiceFx.pitchSemitones,
            grit: voiceFx.grit,
            gainDb: voiceFx.gainDb,
            echoDelayMs: voiceFx.echoDelayMs,
            echoDecay: voiceFx.echoDecay,
            compression: voiceFx.compression,
            highpassHz: 80,
            lowpassHz: 12000,
          },
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok || !json.audioPath) throw new Error(json?.error || "Voice effects failed.");
      setFinalVoice({
        ...baseVoice,
        path: String(json.audioPath),
        url: String(json.audioUrl || `/api/file?path=${encodeURIComponent(json.audioPath)}`),
        label: "Voice with custom effects",
      });
      setMessage("Voice effects applied. Compare the adjusted voice before saving.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice effects failed.");
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  async function saveVoiceAndFinish() {
    if (!character?.id || !baseVoice || !finalVoice?.path) {
      setError("Create or upload a voice before finishing the character.");
      return;
    }
    setBusy("save");
    setError("");
    setMessage("Saving canonical character voice...");
    try {
      const source = baseVoice.source;
      const providerLabel =
        baseVoice.provider === "uploaded"
          ? "Uploaded Voice Reference"
          : PROVIDERS.find((item) => item.provider === baseVoice.provider)?.label || baseVoice.provider;
      const response = await fetch("/api/characters", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-device-id": getCharacterDeviceId(),
        },
        body: JSON.stringify({
          action: "update_voice_selection",
          id: character.id,
          referenceAudioPath: finalVoice.path,
          voiceEngineUsed: providerLabel,
          voiceStyleDefinition: source === "uploaded_reference"
            ? "User-provided uploaded reference voice."
            : voiceStyleSummary(voiceProfile),
          voiceSettings: {
            source,
            provider: baseVoice.provider,
            model: source === "generated" ? voiceProfile.model : "uploaded",
            design: source === "generated" ? voiceProfile : null,
            audioUrl: finalVoice.url,
            baseAudioPath: baseVoice.path,
            baseAudioUrl: baseVoice.url,
            finalAudioPath: finalVoice.path,
            finalAudioUrl: finalVoice.url,
            sourceJobId: baseVoice.jobId,
            effectsApplied: finalVoice.path !== baseVoice.path,
            fx: finalVoice.path !== baseVoice.path ? voiceFx : null,
          },
          metadata: {
            voiceStatus: "ready",
            voiceSource: source,
            voiceProvider: baseVoice.provider,
          },
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok || !json.character) throw new Error(json?.error || "Could not save character voice.");
      setCharacter(json.character as SavedCharacterRecord);
      setMessage("Character complete. Name, appearance, Character Card, and canonical voice are saved.");
      onSaved(json.character as SavedCharacterRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save character voice.");
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  if (stage === "identity") {
    return (
      <div className="space-y-4" data-otg="character-identity-phase11">
        <div className="rounded-[30px] border border-sky-300/20 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.2),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.24em] text-sky-200/75">Character Studio</div>
              <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">Character Details</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
                Save only the identity details Production needs: the character name and a compact visual appearance description.
              </p>
            </div>
            <button type="button" onClick={onBackToCard} className="rounded-full border border-white/10 px-4 py-2 text-sm font-bold text-white/75">
              ← Character Card
            </button>
          </div>
        </div>

        {message ? <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{message}</div> : null}
        {error ? <div className="rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{error}</div> : null}

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-[26px] border border-white/10 bg-black/30 p-4">
            <img src={processedImage.imageUrl} alt="Character identity reference" className="max-h-[520px] w-full rounded-xl object-contain" draggable={false} />
          </div>
          <div className="rounded-[26px] border border-sky-300/15 bg-sky-400/[0.045] p-5">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.18em] text-sky-200/70">Character Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                placeholder="Example: Marcus"
                className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/35 px-4 text-base font-bold text-white outline-none focus:border-sky-200/60"
              />
            </label>

            <label className="mt-5 block">
              <span className="text-xs font-black uppercase tracking-[0.18em] text-sky-200/70">Appearance</span>
              <textarea
                value={appearance}
                onChange={(event) => setAppearance(event.target.value)}
                rows={6}
                maxLength={700}
                placeholder="Brief identifying appearance only: age impression, hair/fur, face, build, clothing, colors, distinctive features."
                className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/35 p-4 text-sm leading-6 text-white outline-none focus:border-sky-200/60"
              />
            </label>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3 text-xs leading-5 text-white/45">
              H3 identity block preview: {name.trim() && appearance.trim() ? buildIdentityBlock(name.trim(), appearance.trim()) : "Enter a name and appearance."}
            </div>

            <button
              type="button"
              disabled={busy === "identity" || !name.trim() || !appearance.trim()}
              onClick={() => void saveIdentity()}
              className="mt-5 min-h-12 w-full rounded-xl border border-sky-300/30 bg-sky-400/20 px-5 text-sm font-black text-sky-50 disabled:opacity-40"
            >
              {busy === "identity" ? "Saving Details..." : "Save Details & Continue to Voice"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-otg="character-voice-phase11">
      <div className="rounded-[30px] border border-cyan-300/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
        <div className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/75">Character Studio</div>
        <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">Character Voice</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
          Create a voice with Qwen3-TTS, CosyVoice, or LTX Voice, or upload an existing reference voice. Either path can complete the character.
        </p>
      </div>

      {message ? <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{message}</div> : null}
      {error ? <div className="rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="rounded-[26px] border border-cyan-300/15 bg-cyan-400/[0.04] p-5">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-cyan-200/70">Create a Voice</div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {PROVIDERS.map((item) => (
                <button
                  key={item.model}
                  type="button"
                  onClick={() => selectProvider(item.model)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    voiceProfile.model === item.model
                      ? "border-cyan-200/70 bg-cyan-300/12"
                      : "border-white/10 bg-black/25 hover:border-white/20"
                  }`}
                >
                  <div className="font-black text-white">{item.label}</div>
                  <p className="mt-2 text-xs leading-5 text-white/45">{item.detail}</p>
                </button>
              ))}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SelectControl label="Age" value={voiceProfile.ageRange} options={VOICE_AGE_RANGES} onChange={(value) => setProfileField("ageRange", value as VoiceDesignProfile["ageRange"])} />
              <SelectControl label="Presentation" value={voiceProfile.genderPresentation} options={VOICE_GENDER_PRESENTATIONS} onChange={(value) => setProfileField("genderPresentation", value as VoiceDesignProfile["genderPresentation"])} />
              <SelectControl label="Tone" value={voiceProfile.tone} options={VOICE_TONES} onChange={(value) => setProfileField("tone", value)} />
              <SelectControl label="Pace" value={voiceProfile.pace} options={VOICE_PACES} onChange={(value) => setProfileField("pace", value as VoiceDesignProfile["pace"])} />
              <SelectControl label="Pitch" value={voiceProfile.pitch} options={VOICE_PITCHES} onChange={(value) => setProfileField("pitch", value as VoiceDesignProfile["pitch"])} />
              <SelectControl label="Energy" value={voiceProfile.energy} options={VOICE_ENERGIES} onChange={(value) => setProfileField("energy", value as VoiceDesignProfile["energy"])} />
              <SelectControl label="Timbre" value={voiceProfile.timbre} options={VOICE_TIMBRES} onChange={(value) => setProfileField("timbre", value)} />
              <SelectControl label="Delivery" value={voiceProfile.deliveryStyle} options={DELIVERY_STYLES} onChange={(value) => setProfileField("deliveryStyle", value)} />
            </div>

            {voiceProfile.model === "ltxvoice" ? (
              <label className="mt-4 block">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">LTX Accent / Dialect</span>
                <select
                  value={voiceProfile.accentDialectId}
                  onChange={(event) => setProfileField("accentDialectId", event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white"
                >
                  {ltxAccents.map((accent) => (
                    <option key={accent.id} value={accent.id}>{accent.label}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="mt-4 block">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Voice Sample Line</span>
              <textarea
                value={voiceProfile.sampleText}
                onChange={(event) => setProfileField("sampleText", event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm leading-6 text-white"
              />
            </label>

            <button
              type="button"
              disabled={busy !== "" || !voiceProfile.sampleText.trim()}
              onClick={() => void generateVoice()}
              className="mt-4 min-h-12 w-full rounded-xl border border-cyan-300/30 bg-cyan-400/20 px-5 text-sm font-black text-cyan-50 disabled:opacity-40"
            >
              {busy === "generate" ? "Creating Voice..." : `Create Voice with ${selectedProvider.label}`}
            </button>
          </section>

          <section className="rounded-[26px] border border-emerald-300/15 bg-emerald-400/[0.04] p-5" data-otg="character-upload-reference-voice-phase11">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-200/70">Or Upload Voice Reference</div>
            <p className="mt-2 text-sm leading-6 text-white/50">
              Already have the character voice? Upload it here. The app normalizes the sample and uses it as the canonical character voice; TTS generation is skipped.
            </p>
            <label className="mt-4 inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-emerald-300/30 bg-emerald-400/12 px-5 text-sm font-black text-emerald-100">
              {busy === "upload" ? "Uploading..." : "Upload Voice Sample / Reference"}
              <input
                type="file"
                accept=".wav,.mp3,.m4a,.aac,.ogg,.flac,.opus,audio/*"
                className="hidden"
                disabled={busy !== ""}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] || null;
                  event.currentTarget.value = "";
                  void uploadReferenceVoice(file);
                }}
              />
            </label>
          </section>

          {baseVoice ? (
            <section className="rounded-[26px] border border-white/10 bg-black/30 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Current Base Voice</div>
                  <div className="mt-1 text-sm font-bold text-white">{baseVoice.label}</div>
                </div>
                <VoicePlayButton url={baseVoice.url} />
              </div>

              {baseVoice.provider === "ltx" && baseVoice.source === "generated" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" disabled={busy !== ""} onClick={() => void processLtx("remove_background")} className="rounded-xl border border-violet-300/25 bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-100 disabled:opacity-40">
                    Remove Background Sound / Effects
                  </button>
                  <button type="button" disabled={busy !== ""} onClick={() => void processLtx("enhance_voice")} className="rounded-xl border border-sky-300/25 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-100 disabled:opacity-40">
                    Enhance Voice
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {baseVoice ? (
            <section className="rounded-[26px] border border-violet-300/15 bg-violet-400/[0.04] p-5">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-violet-200/70">Voice Effects</div>
              <p className="mt-2 text-xs leading-5 text-white/45">
                Optional. Adjust the real generated or uploaded voice, then compare it before saving.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { label: "Deep", pitch: -5 },
                  { label: "Neutral", pitch: 0 },
                  { label: "High", pitch: 5 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setVoiceFx((current) => ({ ...current, pitchSemitones: preset.pitch }))}
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/75"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="text-xs text-white/45">Pitch: {voiceFx.pitchSemitones > 0 ? "+" : ""}{voiceFx.pitchSemitones} semitones</span>
                  <input type="range" min={-12} max={12} step={1} value={voiceFx.pitchSemitones} onChange={(event) => setVoiceFx((current) => ({ ...current, pitchSemitones: Number(event.target.value) }))} className="mt-2 w-full" />
                </label>
                <label>
                  <span className="text-xs text-white/45">Grit: {voiceFx.grit}%</span>
                  <input type="range" min={0} max={100} step={5} value={voiceFx.grit} onChange={(event) => setVoiceFx((current) => ({ ...current, grit: Number(event.target.value) }))} className="mt-2 w-full" />
                </label>
                <label>
                  <span className="text-xs text-white/45">Gain: {voiceFx.gainDb > 0 ? "+" : ""}{voiceFx.gainDb} dB</span>
                  <input type="range" min={-8} max={8} step={1} value={voiceFx.gainDb} onChange={(event) => setVoiceFx((current) => ({ ...current, gainDb: Number(event.target.value) }))} className="mt-2 w-full" />
                </label>
                <label>
                  <span className="text-xs text-white/45">Compression: {voiceFx.compression}%</span>
                  <input type="range" min={0} max={100} step={5} value={voiceFx.compression} onChange={(event) => setVoiceFx((current) => ({ ...current, compression: Number(event.target.value) }))} className="mt-2 w-full" />
                </label>
              </div>

              <button type="button" disabled={busy !== ""} onClick={() => void applyVoiceFx()} className="mt-4 min-h-11 rounded-xl border border-violet-300/30 bg-violet-400/12 px-4 text-sm font-black text-violet-100 disabled:opacity-40">
                {busy === "fx" ? "Applying Effects..." : "Apply Voice Effects"}
              </button>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <section className="rounded-[26px] border border-white/10 bg-black/30 p-4">
            <img src={processedImage.imageUrl} alt={character?.name || "Character"} className="max-h-[420px] w-full rounded-xl object-contain" draggable={false} />
            <div className="mt-3 text-lg font-black text-white">{character?.name}</div>
            <p className="mt-1 text-xs leading-5 text-white/50">{character?.description}</p>
          </section>

          <section className="rounded-[26px] border border-white/10 bg-black/30 p-4">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Voice to Save</div>
            {finalVoice ? (
              <div className="mt-3 space-y-3">
                <div className="text-sm font-bold text-white">{finalVoice.label}</div>
                <VoicePlayButton url={finalVoice.url} />
                {finalVoice.path !== baseVoice?.path ? (
                  <button type="button" onClick={() => setFinalVoice(baseVoice)} className="block text-xs font-bold text-white/45 underline">
                    Reset to original voice
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/40">Create or upload a voice first.</p>
            )}
          </section>

          <button
            type="button"
            disabled={!finalVoice?.path || busy !== ""}
            onClick={() => void saveVoiceAndFinish()}
            className="min-h-12 w-full rounded-xl border border-emerald-300/35 bg-emerald-400/18 px-5 text-sm font-black text-emerald-50 disabled:opacity-40"
            data-otg="character-save-canonical-voice-phase11"
          >
            {busy === "save" ? "Saving Character Voice..." : "Save Voice & Finish Character"}
          </button>
        </aside>
      </div>
    </div>
  );
}

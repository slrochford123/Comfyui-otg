"use client";

// OTG_CHARACTER_TAB_REWORK_CURRENT_STABLE_PHASE1

import React from "react";
import {
  TELEVISION_ANIME_STYLE_PRESETS,
  type TelevisionAnimeStyleId,
} from "@/lib/characters/televisionAnimeStyles";
// OTG_CHARACTER_TELEVISION_ANIME_STYLES_PHASE9_UI
import {
  THREE_D_ANIMATION_STYLE_PRESETS,
  type ThreeDAnimationStyleId,
} from "@/lib/characters/threeDAnimationStyles";
// OTG_CHARACTER_3D_ANIMATION_STYLES_PHASE11_UI
import { createPortal } from "react-dom";
import {
  CandidateModifyDialog,
  CharacterCardRuntimeActions,
  ContinueToCharacterCardButton,
  type CharacterEditUiStatus,
} from "./CharacterCandidateRuntimeControls";
import LegacyCharactersPanel from "./CharactersPanel";
import {
  executeCharacterCandidateEdit,
  type EditableCharacterCandidate,
} from "@/lib/client/characterCandidateEditClient";
import CharacterIdentityVoicePanel, { SavedCharacterLibrary } from "./CharacterIdentityVoicePanel";
import {
  appendCharacterEditCandidate,
  type CharacterCandidateLineage,
} from "@/lib/characters/characterCandidateFlow";
import { executeCharacterUploadCompletion } from "@/lib/client/characterUploadCompletionClient";
import {
  type CharacterSourceMode,
  type CharacterUploadFraming,
} from "@/lib/characters/characterWorkflow";

type CharacterHubPanelProps = {
  isAdmin?: boolean;
  authenticatedOwnerKey?: string;
};

type CharacterHubView =
  | "home"
  | "character-gallery"
  | "background-gallery"
  | "asset-gallery"
  | "create-character"
  | "create-freeform"
  | "upload-character"
  | "upload-freeform"
  | "saved-for-later"
  | "legacy";

type CharacterModelId =
  | "ernie-image"
  | "z-image"
  | "krea-2"
  | "boogu"
  | "mage-flow";

const CHARACTER_IMAGE_MODELS: Array<{
  id: CharacterModelId;
  label: string;
  workflowFile: string;
}> = [
  {
    id: "ernie-image",
    label: "Ernie Image",
    workflowFile: "image_ernie_image_turbo.json",
  },
  {
    id: "z-image",
    label: "Z Image",
    workflowFile: "image_z_image_turbo.json",
  },
  {
    id: "krea-2",
    label: "Krea 2",
    workflowFile: "image_krea2_turbo_t2i.json",
  },
  {
    id: "boogu",
    label: "Boogu",
    workflowFile: "image_boogu_image_0_1_turbo_t2i.json",
  },
  {
    id: "mage-flow",
    label: "Mage Flow",
    workflowFile: "image_mage_flow_turbo_t2i_int8.json",
  },
];

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function BackButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center justify-center rounded-full border border-sky-300/30 bg-sky-400/10 px-4 py-2 text-sm font-bold text-sky-100 transition hover:bg-sky-300/20"
    >
      ← {label}
    </button>
  );
}

function GalleryCard({
  eyebrow,
  title,
  description,
  accent,
  onClick,
  status = "Open →",
}: {
  eyebrow: string;
  title: string;
  description: string;
  accent: string;
  onClick: () => void;
  status?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative min-h-[210px] overflow-hidden rounded-[28px] border border-sky-300/20 bg-[linear-gradient(145deg,rgba(14,32,48,0.94),rgba(5,10,18,0.98))] p-6 text-left transition hover:-translate-y-0.5 hover:border-sky-200/45 hover:bg-[linear-gradient(145deg,rgba(20,52,78,0.97),rgba(5,10,18,0.99))]"
    >
      <div
        className={cn(
          "mb-8 h-2 w-28 rounded-full shadow-[0_0_28px_rgba(125,211,252,0.22)]",
          accent
        )}
      />

      <div className="text-xs font-black uppercase tracking-[0.22em] text-sky-200/70">
        {eyebrow}
      </div>

      <div className="mt-3 text-3xl font-black tracking-tight text-white">
        {title}
      </div>

      <p className="mt-4 max-w-xl text-sm leading-6 text-white/60">
        {description}
      </p>

      <div className="mt-7 text-sm font-black text-sky-200">
        {status}
      </div>
    </button>
  );
}

// OTG_CHARACTER_HUB_DRAFT_CONTROLS_V1
function ActiveCharacterDraftCard({
  onResume,
  persistenceOwnerKey,
}: {
  onResume: (
    mode: "standard" | "freeform",
    sourceMode: CharacterSourceMode,
  ) => void;
  persistenceOwnerKey: string;
}) {
  const [draft, setDraft] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    if (!persistenceOwnerKey) {
      setDraft(null);
      return;
    }
    try {
      const response = await fetch(
        "/api/characters/builder-draft",
        {
          cache: "no-store",
          credentials: "include",
        },
      );
      const json = await response.json().catch(() => null);
      const candidate = json?.draft;
      const state = candidate?.state;
      if (
        response.ok &&
        state?.builderOwner === "character-hub-v1" &&
        (state?.mode === "standard" || state?.mode === "freeform")
      ) {
        setDraft(candidate);
      } else {
        setDraft(null);
      }
    } catch {
      setDraft(null);
    }
  }, [persistenceOwnerKey]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function deleteDraft() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const jobId = String(draft?.state?.characterCompletionJobId || "").trim();

      if (jobId) {
        await fetch(
          `/api/characters/completion/${encodeURIComponent(jobId)}`,
          {
            method: "DELETE",
            credentials: "include",
          },
        );
      }

      const response = await fetch(
        "/api/characters/builder-draft",
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Could not delete Character draft.");
      }

      clearCharacterCreatePersistence(persistenceOwnerKey);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete Character draft.");
    } finally {
      setBusy(false);
    }
  }

  if (!draft) return null;

  const state = draft.state || {};
  const mode = state.mode === "freeform" ? "freeform" : "standard";
  const sourceMode = state.sourceMode === "uploaded" ? "uploaded" : "generated";
  const stage = String(state.currentStage || state.stage || "in progress");
  const progress = Math.max(
    0,
    Math.min(100, Number(state.characterCompletionProgress || 0)),
  );

  return (
    <div
      className="rounded-[28px] border border-amber-300/25 bg-amber-300/[0.07] p-5"
      data-otg="character-hub-active-draft"
    >
      <div className="text-xs font-black uppercase tracking-[0.2em] text-amber-100/70">
        Character in progress
      </div>
      <div className="mt-2 text-xl font-black text-white">
        Resume Character
      </div>
      <p className="mt-2 text-sm leading-6 text-white/55">
        Saved stage: {stage}
        {progress > 0 ? ` · ${progress}%` : ""}
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onResume(mode, sourceMode)}
          className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-black text-zinc-950"
        >
          Resume Character
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void deleteDraft()}
          className="rounded-xl border border-red-300/40 px-4 py-2 text-sm font-bold text-red-100 disabled:opacity-50"
        >
          {busy ? "Deleting..." : "Delete Draft"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 text-sm text-red-100">{error}</div>
      ) : null}
    </div>
  );
}

function CharacterCreateSetup({
  mode,
  sourceMode = "generated",
  onBack,
  persistenceOwnerKey,
  initialCandidate = null,
  onInitialCandidateConsumed,
}: {
  mode: "standard" | "freeform";
  sourceMode?: CharacterSourceMode;
  onBack: () => void;
  persistenceOwnerKey: string;
  initialCandidate?: CharacterCreateCandidate | null;
  onInitialCandidateConsumed?: () => void;
}) {
  const [modelId, setModelId] =
    React.useState<CharacterModelId>("ernie-image");
  const [description, setDescription] = React.useState("");
  const [stylePresetId, setStylePresetId] =
    React.useState<CharacterStylePresetId>("cartoon");
  const [televisionAnimeStyleId, setTelevisionAnimeStyleId] =
    React.useState<TelevisionAnimeStyleId>("default");
  const [threeDAnimationStyleId, setThreeDAnimationStyleId] =
    React.useState<ThreeDAnimationStyleId>("default");
  const [createLoading, setCreateLoading] = React.useState(false);
  const [enhanceDescriptionLoading, setEnhanceDescriptionLoading] =
    React.useState(false);
  const [createError, setCreateError] = React.useState("");
  const [createMessage, setCreateMessage] = React.useState("");
  const [uploadFraming, setUploadFraming] =
    React.useState<CharacterUploadFraming>("full-body");
  const [uploadedSource, setUploadedSource] =
    React.useState<CharacterCreateCandidate | null>(null);
  const [completionPrompt, setCompletionPrompt] = React.useState("");
  const [createCandidates, setCreateCandidates] = React.useState<CharacterCreateCandidate[]>([]);
  const [selectedCreateCandidateId, setSelectedCreateCandidateId] = React.useState("");
  const [modifyCandidateId, setModifyCandidateId] = React.useState("");
  const [modifyInstruction, setModifyInstruction] = React.useState("");
  const [modifyNegativePrompt, setModifyNegativePrompt] = React.useState("");
  const [modifyAdvancedOpen, setModifyAdvancedOpen] = React.useState(false);
  const [candidateEditStatus, setCandidateEditStatus] = React.useState<CharacterEditUiStatus>("idle");
  const [candidateBusyId, setCandidateBusyId] = React.useState("");
  const [characterCardStep, setCharacterCardStep] = React.useState(false);
  const [processedCharacterSource, setProcessedCharacterSource] = React.useState<CharacterCreateCandidate | null>(null);
  const [characterCard, setCharacterCard] = React.useState<CharacterCreateCandidate | null>(null);
  const [characterCardStatus, setCharacterCardStatus] = React.useState<"idle" | "running" | "error" | "accepted">("idle");
  const [characterFinalizeStep, setCharacterFinalizeStep] = React.useState(false);
  // OTG_CHARACTER_HUB_REFERENCE_STATE_V1
  const [characterReferences, setCharacterReferences] =
    React.useState<CharacterReferencePackageV1 | null>(null);
  const [characterCompletionJobId, setCharacterCompletionJobId] =
    React.useState("");
  const [characterCompletionProgress, setCharacterCompletionProgress] =
    React.useState(0);
  const [characterHubDraftId, setCharacterHubDraftId] = React.useState("");
  const [characterHubDraftHydrated, setCharacterHubDraftHydrated] =
    React.useState(false);
  const candidateEditInFlightRef = React.useRef(false);
  const characterCardInFlightRef = React.useRef(false);
  const [expandedCandidate, setExpandedCandidate] =
    React.useState<CharacterCreateCandidate | null>(null);

  const selectedCreateCandidate = createCandidates.find(
    (candidate) => candidate.id === selectedCreateCandidateId,
  ) || null;
  const modifyingCandidate = createCandidates.find(
    (candidate) => candidate.id === modifyCandidateId,
  ) || null;

  // OTG_CHARACTER_HUB_DRAFT_RUNTIME_V1
  React.useEffect(() => {
    let cancelled = false;

    async function restoreCharacterHubDraft() {
      try {
        const response = await fetch(
          "/api/characters/builder-draft",
          {
            cache: "no-store",
            credentials: "include",
          },
        );
        const json = await response.json().catch(() => null);
        const saved = json?.draft?.state;

        if (
          !cancelled &&
          response.ok &&
          saved?.builderOwner === "character-hub-v1" &&
          saved?.mode === mode &&
          (saved?.sourceMode === sourceMode ||
            (!saved?.sourceMode && sourceMode === "generated"))
        ) {
          if (typeof saved.modelId === "string") setModelId(saved.modelId as CharacterModelId);
          if (typeof saved.description === "string") setDescription(saved.description);
          if (typeof saved.stylePresetId === "string") setStylePresetId(saved.stylePresetId as CharacterStylePresetId);
          if (typeof saved.televisionAnimeStyleId === "string") {
            setTelevisionAnimeStyleId(saved.televisionAnimeStyleId as TelevisionAnimeStyleId);
          }
          if (typeof saved.threeDAnimationStyleId === "string") {
            setThreeDAnimationStyleId(saved.threeDAnimationStyleId as ThreeDAnimationStyleId);
          }
          if (Array.isArray(saved.createCandidates)) setCreateCandidates(saved.createCandidates);
          if (typeof saved.selectedCreateCandidateId === "string") {
            setSelectedCreateCandidateId(saved.selectedCreateCandidateId);
          }

          setProcessedCharacterSource(saved.processedCharacterSource || null);
          if (
            saved.uploadFraming === "head" ||
            saved.uploadFraming === "half-body" ||
            saved.uploadFraming === "full-body"
          ) {
            setUploadFraming(saved.uploadFraming);
          }
          setUploadedSource(saved.uploadedSource || null);
          if (typeof saved.completionPrompt === "string") {
            setCompletionPrompt(saved.completionPrompt);
          }
          setCharacterCard(saved.characterCard || null);
          setCharacterCardStep(Boolean(saved.characterCardStep));
          setCharacterFinalizeStep(Boolean(saved.characterFinalizeStep));
          setCharacterReferences(saved.characterReferences || null);
          setCharacterCompletionJobId(String(saved.characterCompletionJobId || ""));
          setCharacterCompletionProgress(Number(saved.characterCompletionProgress || 0));
          setCharacterHubDraftId(
            String(saved.characterHubDraftId || json?.draft?.characterId || newCharacterHubDraftId()),
          );

          const restoredStatus = String(saved.characterCardStatus || "");
          if (
            restoredStatus === "running" ||
            restoredStatus === "error" ||
            restoredStatus === "accepted"
          ) {
            setCharacterCardStatus(restoredStatus);
          } else {
            setCharacterCardStatus("idle");
          }

          setCreateMessage("Restored saved Character creation progress.");
        } else if (!cancelled) {
          setCharacterHubDraftId(newCharacterHubDraftId());
        }
      } catch {
        if (!cancelled) setCharacterHubDraftId(newCharacterHubDraftId());
      } finally {
        if (!cancelled) setCharacterHubDraftHydrated(true);
      }
    }

    void restoreCharacterHubDraft();
    return () => {
      cancelled = true;
    };
  }, [mode, sourceMode, persistenceOwnerKey]);

  React.useEffect(() => {
    if (!characterHubDraftHydrated || !characterHubDraftId) return;

    const hasWork =
      Boolean(description.trim()) ||
      Boolean(uploadedSource?.serverPath) ||
      Boolean(completionPrompt.trim()) ||
      createCandidates.length > 0 ||
      Boolean(processedCharacterSource?.serverPath) ||
      Boolean(characterCompletionJobId) ||
      Boolean(characterCard?.serverPath) ||
      characterFinalizeStep;

    if (!hasWork) return;

    const timer = window.setTimeout(() => {
      const currentStage = characterFinalizeStep
        ? "identity_voice"
        : characterCardStep
          ? characterReferences?.status === "complete"
            ? "references_complete"
            : "character_references"
          : createCandidates.length
            ? "candidate_selection"
            : "source";

      void fetch(
        "/api/characters/builder-draft",
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "new_character",
            characterId: characterHubDraftId,
            currentStage,
            state: {
              builderOwner: "character-hub-v1",
              schemaVersion: 1,
              mode,
              sourceMode,
              currentStage,
              characterHubDraftId,
              modelId,
              description,
              stylePresetId,
              televisionAnimeStyleId,
              threeDAnimationStyleId,
              createCandidates,
              selectedCreateCandidateId,
              processedCharacterSource,
              uploadFraming,
              uploadedSource,
              completionPrompt,
              characterCardStep,
              characterCard,
              characterCardStatus,
              characterFinalizeStep,
              characterReferences,
              characterCompletionJobId,
              characterCompletionProgress,
              updatedAt: new Date().toISOString(),
            },
          }),
        },
      ).catch(() => {
        // The current browser state remains available until the next retry.
      });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    characterHubDraftHydrated,
    characterHubDraftId,
    mode,
    sourceMode,
    modelId,
    description,
    stylePresetId,
    televisionAnimeStyleId,
    threeDAnimationStyleId,
    createCandidates,
    selectedCreateCandidateId,
    processedCharacterSource,
    uploadFraming,
    uploadedSource,
    completionPrompt,
    characterCardStep,
    characterCard,
    characterCardStatus,
    characterFinalizeStep,
    characterReferences,
    characterCompletionJobId,
    characterCompletionProgress,
  ]);

  React.useEffect(() => {
    if (!expandedCandidate) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpandedCandidate(null);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [expandedCandidate]);

  const selectedModel =
    CHARACTER_IMAGE_MODELS.find((model) => model.id === modelId) ??
    CHARACTER_IMAGE_MODELS[0];

  const selectedStylePreset =
    CHARACTER_STYLE_PRESETS.find((preset) => preset.id === stylePresetId) ??
    CHARACTER_STYLE_PRESETS[0];

  const selectedTelevisionAnimeStyle =
    TELEVISION_ANIME_STYLE_PRESETS.find(
      (preset) => preset.id === televisionAnimeStyleId,
    ) ?? TELEVISION_ANIME_STYLE_PRESETS[0];

  const selectedThreeDAnimationStyle =
    THREE_D_ANIMATION_STYLE_PRESETS.find(
      (preset) => preset.id === threeDAnimationStyleId,
    ) ?? THREE_D_ANIMATION_STYLE_PRESETS[0];

  const selectedDetailedStyleLabel =
    stylePresetId === "anime" && televisionAnimeStyleId !== "default"
      ? `${selectedStylePreset.label} / ${selectedTelevisionAnimeStyle.label}`
      : stylePresetId === "pixar-3d" && threeDAnimationStyleId !== "default"
        ? `${selectedStylePreset.label} / ${selectedThreeDAnimationStyle.label}`
        : selectedStylePreset.label;

  async function enhanceCharacterDescription() {
    const cleaned = description.trim();

    if (!cleaned || enhanceDescriptionLoading) return;

    setEnhanceDescriptionLoading(true);
    setCreateError("");
    setCreateMessage(
      "Writing richer character details...",
    );

    try {
      const response = await fetch(
        "/api/characters/enhance-description",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            prompt: cleaned,
            mode,
          }),
        },
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Enhance Prompt failed.",
        );
      }

      const enhanced =
        typeof data?.enhancedDescription === "string"
          ? data.enhancedDescription.trim()
          : typeof data?.enhancedPrompt === "string"
            ? data.enhancedPrompt.trim()
            : "";

      if (!enhanced) {
        throw new Error(
          "Prompt enhancement returned an empty description.",
        );
      }

      setDescription(enhanced);
      setCreateMessage(
        "Character description enhanced. Review or edit it before generating.",
      );
    } catch (error: any) {
      setCreateError(
        error?.message ||
          "Could not enhance the Character description.",
      );
      setCreateMessage("");
    } finally {
      setEnhanceDescriptionLoading(false);
    }
  }

  const isFreeform = mode === "freeform";
  const title = sourceMode === "uploaded"
    ? isFreeform
      ? "Upload Freeform Character"
      : "Upload Character"
    : isFreeform
      ? "Create Freeform Character"
      : "Create Character";

  React.useEffect(() => {
    if (!initialCandidate) return;

    setCreateCandidates((current) => {
      if (current.some((item) => item.id === initialCandidate.id)) {
        return current;
      }

      return [initialCandidate, ...current].slice(0, 5);
    });

    setSelectedCreateCandidateId("");
    setCreateMessage(
      "Loaded saved Character candidate. Press Select when you want to use it for Character Card creation.",
    );
    onInitialCandidateConsumed?.();

    if (!initialCandidate.serverPath) {
      void copyCharacterHubImageToUpload(
        initialCandidate.imageUrl,
        `saved-${initialCandidate.promptId || Date.now()}.png`,
      ).then((upload) => {
        setCreateCandidates((current) => current.map((candidate) =>
          candidate.id === initialCandidate.id
            ? { ...candidate, imageUrl: upload.fileUrl || candidate.imageUrl, serverPath: upload.serverPath }
            : candidate,
        ));
      }).catch((error: any) => {
        setCreateError(error?.message || "Could not prepare the saved candidate for editing.");
      });
    }
  }, [initialCandidate, onInitialCandidateConsumed]);

  function selectCandidate(candidate: CharacterCreateCandidate) {
    if (candidate.id !== selectedCreateCandidateId) {
      setProcessedCharacterSource(null);
      setCharacterCard(null);
      setCharacterCardStatus("idle");
    }
    setSelectedCreateCandidateId(candidate.id);
    setCreateMessage(
      `${candidate.modelLabel} candidate selected for Character Card creation.`,
    );
  }

  function clearCandidate(candidateId: string) {
    setCreateCandidates((current) => {
      const remaining = current.filter(
        (candidate) => candidate.id !== candidateId,
      );

      if (selectedCreateCandidateId === candidateId) {
        setSelectedCreateCandidateId("");
        setProcessedCharacterSource(null);
        setCharacterCard(null);
        setCharacterCardStatus("idle");
      }

      return remaining;
    });

    if (modifyCandidateId === candidateId) {
      setModifyCandidateId("");
      setModifyInstruction("");
      setModifyNegativePrompt("");
      setModifyAdvancedOpen(false);
      setCandidateEditStatus("idle");
    }
  }

  function openCandidateEdit(candidate: CharacterCreateCandidate) {
    if (candidateEditInFlightRef.current) return;
    setModifyCandidateId(candidate.id);
    setModifyInstruction("");
    setModifyNegativePrompt("");
    setModifyAdvancedOpen(false);
    setCandidateEditStatus("idle");
    setCreateError("");
  }

  function closeCandidateEdit() {
    if (candidateEditInFlightRef.current) return;
    setModifyCandidateId("");
    setModifyInstruction("");
    setModifyNegativePrompt("");
    setModifyAdvancedOpen(false);
    setCandidateEditStatus("idle");
  }

  async function saveCandidateForLater(
    candidate: CharacterCreateCandidate,
  ) {
    if (candidateBusyId) return;

    setCandidateBusyId(candidate.id);
    setCreateError("");
    setCreateMessage("Saving Character candidate for later...");

    try {
      const imageResponse = await fetch(candidate.imageUrl, {
        cache: "no-store",
      });

      if (!imageResponse.ok) {
        throw new Error(
          `Could not read generated candidate (${imageResponse.status}).`,
        );
      }

      const blob = await imageResponse.blob();
      const form = new FormData();

      form.set(
        "image",
        new File(
          [blob],
          `character-${candidate.promptId || Date.now()}.png`,
          {
            type: blob.type || "image/png",
          },
        ),
      );

      form.set("promptId", candidate.promptId);
      form.set("seed", String(candidate.seed));
      form.set("backend", candidate.backend);
      form.set("modelLabel", candidate.modelLabel);
      form.set("styleLabel", candidate.styleLabel);
      form.set("mode", mode);
      form.set("description", description.trim());

      const response = await fetch(
        "/api/characters/saved-for-later",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "x-otg-device-id": getCharacterHubDeviceId(),
          },
          body: form,
        },
      );

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(
          json?.error ||
            `Save for Later failed (${response.status}).`,
        );
      }

      setCreateMessage(
        "Candidate saved to Saved for Later Character Gallery.",
      );
    } catch (error: any) {
      setCreateError(error?.message || String(error));
      setCreateMessage("");
    } finally {
      setCandidateBusyId("");
    }
  }

  async function applyCandidateEdit() {
    if (candidateEditInFlightRef.current) return;
    const source = createCandidates.find((candidate) => candidate.id === modifyCandidateId);
    if (!source?.serverPath) {
      setCandidateEditStatus("error");
      setCreateError("This candidate does not have a stable source image for editing.");
      return;
    }

    candidateEditInFlightRef.current = true;
    setCandidateEditStatus("running");
    setCreateError("");
    setCreateMessage("Applying candidate edit with Qwen Image Edit 2509...");
    try {
      const edited = await executeCharacterCandidateEdit({
        source: editableCharacterHubCandidate(source),
        requestedChange: modifyInstruction,
        negativePrompt: modifyNegativePrompt,
        seed: randomCharacterSeed(),
        requestInit: {
          credentials: "include",
          headers: { "x-otg-device-id": getCharacterHubDeviceId() },
        },
        resolveOutput: waitForCharacterWorkflowImage,
        persistOutput: copyCharacterHubImageToUpload,
        onSubmitted: (job) => setCreateMessage(
          `Candidate edit submitted. Prompt ID: ${job.promptId}. Waiting for output...`,
        ),
      });
      const nextCandidate: CharacterCreateCandidate = {
        ...source,
        ...edited,
        imageUrl: edited.url,
        promptId: edited.promptId || source.promptId,
        modelLabel: edited.label,
        backgroundFree: false,
      };
      setCreateCandidates((current) => appendCharacterEditCandidate(current, nextCandidate));
      setModifyCandidateId("");
      setModifyInstruction("");
      setModifyNegativePrompt("");
      setModifyAdvancedOpen(false);
      setCandidateEditStatus("idle");
      setCreateMessage("Edit complete. The original was preserved and the edited result was added as a new candidate.");
    } catch (error: any) {
      setCandidateEditStatus("error");
      setCreateError(error?.message || String(error));
      setCreateMessage("Candidate edit failed. Correct the request if needed, then try Apply Edit again.");
    } finally {
      candidateEditInFlightRef.current = false;
    }
  }

  async function continueCandidateToCharacterCard(
    candidate: CharacterCreateCandidate | null,
  ) {
    if (!candidate?.serverPath || candidateBusyId) return;
    setCandidateBusyId(candidate.id);
    setCreateError("");
    setCreateMessage("Processing the selected character image for Character Card...");
    try {
      let processed = candidate;
      if (!processed.backgroundFree) {
        const response = await fetch("/api/background-remove", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-otg-device-id": getCharacterHubDeviceId() },
          credentials: "include",
          body: JSON.stringify({ imagePath: processed.serverPath }),
        });
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || "Background removal failed before Character Card.");
        }
        const serverPath = String(json.imagePath || json.path || "").trim();
        const imageUrl = String(json.url || "").trim();
        if (!serverPath || !imageUrl) {
          throw new Error("Background removal did not return a stable processed character image.");
        }
        processed = {
          ...processed,
          id: `${processed.id}-background-free-${Date.now()}`,
          imageUrl,
          serverPath,
          backgroundFree: true,
        };
      }
      setProcessedCharacterSource(processed);
      setCharacterCardStep(true);
      setCreateMessage("Processed source image is ready. Create the Character Card when ready.");
    } catch (error: any) {
      setCreateError(error?.message || String(error));
      setCreateMessage("");
    } finally {
      setCandidateBusyId("");
    }
  }

  async function continueToCharacterCard() {
    await continueCandidateToCharacterCard(selectedCreateCandidate);
  }

  function changeUploadFraming(next: CharacterUploadFraming) {
    setUploadFraming(next);
    setCreateCandidates([]);
    setSelectedCreateCandidateId("");
    setProcessedCharacterSource(null);
    setCharacterCard(null);
    setCharacterCardStep(false);
    setCharacterFinalizeStep(false);
    setCharacterCardStatus("idle");
    setCharacterReferences(null);
    setCharacterCompletionJobId("");
    setCharacterCompletionProgress(0);
    setCreateError("");
    setCreateMessage(
      next === "full-body"
        ? "Full Body selected. Qwen completion will be skipped."
        : `${next === "head" ? "Head" : "Half Body"} selected. Describe the intended complete Character before running Qwen completion.`,
    );
  }

  async function uploadCharacterSource(file: File | null) {
    if (!file || createLoading) return;
    setCreateLoading(true);
    setCreateError("");
    setCreateMessage("Uploading Character source...");
    try {
      const form = new FormData();
      form.set("image", file, file.name);
      const response = await fetch("/api/characters/upload", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": getCharacterHubDeviceId() },
        body: form,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `Character upload failed (${response.status}).`);
      }
      const serverPath = String(json.serverPath || "").trim();
      const imageUrl = String(json.fileUrl || "").trim();
      if (!serverPath || !imageUrl) {
        throw new Error("Character upload did not return a stable owner-scoped source.");
      }
      const candidate: CharacterCreateCandidate = {
        id: `uploaded-${Date.now()}`,
        imageUrl,
        serverPath,
        promptId: "uploaded-source",
        seed: 0,
        backend: "owner-upload",
        modelLabel: "Uploaded Character",
        styleLabel: isFreeform ? "Freeform" : "Standard",
        workflowId: "owner-scoped-character-upload",
        backgroundFree: false,
      };
      setUploadedSource(candidate);
      setCreateCandidates([]);
      setSelectedCreateCandidateId("");
      setProcessedCharacterSource(null);
      setCharacterCard(null);
      setCharacterCardStep(false);
      setCharacterFinalizeStep(false);
      setCreateMessage("Uploaded source is ready. Confirm what the image contains.");
    } catch (error: any) {
      setCreateError(error?.message || "Character upload failed.");
      setCreateMessage("");
    } finally {
      setCreateLoading(false);
    }
  }

  async function completeUploadedCharacter() {
    if (
      !uploadedSource?.serverPath ||
      uploadFraming === "full-body" ||
      !completionPrompt.trim() ||
      createLoading
    ) {
      return;
    }

    setCreateLoading(true);
    setCreateError("");
    setCreateMessage("Completing the Character with Qwen Edit Image...");
    try {
      const seed = randomCharacterSeed();
      const completed = await executeCharacterUploadCompletion({
        sourceServerPath: uploadedSource.serverPath,
        kind: mode,
        framing: uploadFraming,
        completionPrompt,
        seed,
        requestInit: {
          credentials: "include",
          headers: { "x-otg-device-id": getCharacterHubDeviceId() },
        },
        resolveOutput: waitForCharacterWorkflowImage,
        persistOutput: copyCharacterHubImageToUpload,
        onSubmitted: (job) => setCreateMessage(
          `Qwen completion submitted. Prompt ID: ${job.promptId}. Waiting for the completed Character...`,
        ),
      });
      const candidate: CharacterCreateCandidate = {
        id: `completed-${completed.promptId}-${Date.now()}`,
        imageUrl: completed.imageUrl,
        serverPath: completed.serverPath,
        promptId: completed.promptId,
        seed: Number(seed),
        backend: "qwen-image-edit",
        modelLabel: isFreeform
          ? "Qwen Completed Freeform Character"
          : "Qwen Completed Character",
        styleLabel: uploadFraming === "head" ? "Head completion" : "Half Body completion",
        internalPrompt: completed.instruction,
        workflowId: "presets/Edit Image",
        backgroundFree: false,
      };
      setCreateCandidates([candidate]);
      setSelectedCreateCandidateId(candidate.id);
      setCreateMessage(
        "Qwen completion finished. Review the complete Character, then continue to background removal and Character Card.",
      );
    } catch (error: any) {
      setCreateCandidates([]);
      setSelectedCreateCandidateId("");
      setCreateError(
        `${error?.message || "Qwen Character completion failed."} The partial upload was preserved for retry and will not be used for Character Card generation.`,
      );
      setCreateMessage("");
    } finally {
      setCreateLoading(false);
    }
  }

  async function continueFullBodyUpload() {
    if (!uploadedSource || uploadFraming !== "full-body" || createLoading) return;
    setCreateMessage("Full Body confirmed. Skipping Qwen completion and removing the background...");
    await continueCandidateToCharacterCard(uploadedSource);
  }

  async function pollCharacterReferenceCompletionV1(jobId: string) {
    const deadline = Date.now() + 45 * 60 * 1000;

    while (Date.now() < deadline) {
      const ownerId = getCharacterHubDeviceId();
      const response = await fetch(
        `/api/characters/completion/${encodeURIComponent(jobId)}`,
        {
          cache: "no-store",
          credentials: "include",
          headers: { "x-otg-device-id": ownerId },
        },
      );
      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok || !json?.job) {
        throw new Error(
          json?.error || `Character reference status failed (${response.status}).`,
        );
      }

      const job = json.job;
      const status = String(job.status || "queued").toLowerCase();
      const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
      setCharacterCompletionProgress(progress);
      setCreateMessage(
        `${String(job.message || "Building Character references...")} ${progress}%`,
      );

      if (status === "completed") {
        const refs = job?.result?.characterReferences as
          | CharacterReferencePackageV1
          | undefined;

        const body = refs?.body;
        const card = refs?.characterCard;

        if (
          refs?.status !== "complete" ||
          !body?.front?.serverPath ||
          !body?.back?.serverPath ||
          !body?.leftProfile?.serverPath ||
          !body?.rightProfile?.serverPath ||
          !card?.serverPath
        ) {
          throw new Error(
            "Character completion finished without all four body references and the Character Card.",
          );
        }

        setCharacterReferences(refs);
        setCharacterCard({
          ...(processedCharacterSource as CharacterCreateCandidate),
          id: `four-angle-card-${jobId}`,
          imageUrl: characterReferenceAssetUrl(card),
          serverPath: card.serverPath,
          promptId: refs.anglePromptId || jobId,
          modelLabel: "Four-angle Character Card",
          styleLabel: "Front / Back / Left / Right",
          workflowId: "internal/character-reference/qwen_character_4angle_lowres",
          backgroundFree: false,
        });
        setCharacterCardStatus("idle");
        setCharacterCompletionProgress(100);
        setCreateMessage(
          "Four canonical 1080×1920 Character references and the four-angle Character Card are ready. Review them, then accept.",
        );
        return;
      }

      if (status === "failed" || status === "canceled") {
        throw new Error(
          String(job.error || job.message || "Character reference generation failed."),
        );
      }

      await new Promise((resolve) => window.setTimeout(resolve, 2500));
    }

    setCreateMessage(
      "Character reference generation is still active. It is saved and will resume when you return.",
    );
  }

  async function createCharacterCard() {
    if (
      characterCardInFlightRef.current ||
      !processedCharacterSource?.serverPath ||
      !characterHubDraftId
    ) {
      return;
    }

    characterCardInFlightRef.current = true;
    setCharacterCardStatus("running");
    setCreateError("");
    setCreateMessage(
      "Queueing four low-resolution Character angles for durable completion...",
    );

    try {
      let jobId = characterCompletionJobId;

      if (!jobId) {
        const ownerId = getCharacterHubDeviceId();
        const response = await fetch("/api/characters/completion", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-otg-device-id": ownerId,
          },
          body: JSON.stringify({
            characterId: characterHubDraftId,
            sourceImagePath: processedCharacterSource.serverPath,
            fullBodyImagePath: processedCharacterSource.serverPath,
            defaultCharacterSourceImagePath: processedCharacterSource.serverPath,
            originalSourceImagePath: processedCharacterSource.serverPath,
            deferCharacterSave: true,
            characterReferenceGpuTarget: "rtx5060ti",
            metadata: {
              source: "character-hub-v1",
              mode,
              sourceMode,
              ...(sourceMode === "uploaded" ? { uploadFraming } : {}),
            },
          }),
        });

        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok || !json?.job?.jobId) {
          throw new Error(
            json?.error || `Could not queue Character references (${response.status}).`,
          );
        }

        jobId = String(json.job.jobId);
        setCharacterCompletionJobId(jobId);
        setCharacterCompletionProgress(Number(json.job.progress || 0));

        // Persist the job id immediately before polling so closing the phone
        // cannot lose the durable worker handoff.
        await fetch(
          "/api/characters/builder-draft",
          {
            method: "PUT",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              mode: "new_character",
              characterId: characterHubDraftId,
              currentStage: "character_references",
              state: {
                builderOwner: "character-hub-v1",
                schemaVersion: 1,
                mode,
                sourceMode,
                currentStage: "character_references",
                characterHubDraftId,
                modelId,
                description,
                stylePresetId,
                televisionAnimeStyleId,
                threeDAnimationStyleId,
                createCandidates,
                selectedCreateCandidateId,
                processedCharacterSource,
                uploadFraming,
                uploadedSource,
                completionPrompt,
                characterCardStep: true,
                characterCard: null,
                characterCardStatus: "running",
                characterFinalizeStep: false,
                characterReferences: null,
                characterCompletionJobId: jobId,
                characterCompletionProgress: Number(json.job.progress || 0),
                updatedAt: new Date().toISOString(),
              },
            }),
          },
        );
      }

      setCreateMessage(
        `Character reference job ${jobId} is saved. Generating four low-resolution angles, then upscaling each to 1080×1920...`,
      );

      await pollCharacterReferenceCompletionV1(jobId);
    } catch (error: any) {
      setCharacterCardStatus("error");
      setCreateError(error?.message || String(error));
      setCreateMessage(
        "Character reference generation stopped. The source, job ID, and completed checkpoints remain saved for Resume.",
      );
    } finally {
      characterCardInFlightRef.current = false;
    }
  }

  function acceptCharacterCard() {
    if (
      !processedCharacterSource?.serverPath ||
      !characterCard?.serverPath ||
      characterReferences?.status !== "complete"
    ) {
      setCreateError(
        "All four canonical Character references must finish before the Character Card can be accepted.",
      );
      return;
    }

    setCharacterCardStatus("accepted");
    setCharacterFinalizeStep(true);
    setCreateMessage(
      "Four-angle Character references accepted. Add the real character name and appearance details, then choose or upload the voice.",
    );
  }

  async function clearCharacterHubDraftV1() {
    await fetch(
      "/api/characters/builder-draft",
      {
        method: "DELETE",
        credentials: "include",
      },
    ).catch(() => null);
    clearCharacterCreatePersistence(persistenceOwnerKey);
  }

  function backToCandidates() {
    if (characterCardInFlightRef.current) return;
    setCharacterFinalizeStep(false);
    setCharacterCardStep(false);
    setCreateMessage("Returned to candidates. The current selection, processed source, and Character Card are preserved.");
  }

  const characterCreateJobInFlightRef = React.useRef(false);
  const characterCreateMountedRef = React.useRef(true);

  const resumePersistedCharacterCreateJob = React.useCallback(async () => {
    if (sourceMode !== "generated") return;
    if (characterCreateJobInFlightRef.current) return;
    const persisted = readCharacterCreatePersistence(persistenceOwnerKey);
    if (!persisted) return;

    if (persisted.status === "completed" && persisted.candidate) {
      setCreateCandidates((current) => {
        if (current.some((candidate) => candidate.promptId === persisted.candidate?.promptId)) {
          return current;
        }
        return [persisted.candidate as CharacterCreateCandidate, ...current].slice(0, 5);
      });
      clearCharacterCreatePersistence(persistenceOwnerKey);
      setCreateError("");
      setCreateMessage("Recovered the completed Character image after returning to the app.");
      return;
    }

    characterCreateJobInFlightRef.current = true;
    setCreateLoading(true);
    setCreateError("");
    setCreateMessage("Recovering the pending Character generation...");

    try {
      const job =
        persisted.status === "running" && persisted.job
          ? persisted.job
          : await ensureCharacterCreateSubmission(persisted, false);

      const running: CharacterCreatePersistenceRecord = {
        ...persisted,
        status: "running",
        job,
        updatedAt: Date.now(),
      };
      writeCharacterCreatePersistence(persistenceOwnerKey, running);
      setCreateMessage(
        `Resuming Character generation ${job.promptId} on ${job.backend || "the selected backend"}...`,
      );

      const imageUrl = await waitForCharacterCreateImage(job);
      if (!characterCreateMountedRef.current) return;
      const upload = await copyCharacterHubImageToUpload(
        imageUrl,
        `character-${job.promptId}.png`,
      );
      const candidate: CharacterCreateCandidate = {
        id: `${job.promptId}-${Date.now()}`,
        imageUrl: upload.fileUrl || imageUrl,
        serverPath: upload.serverPath,
        promptId: job.promptId,
        seed: job.seed,
        backend: job.backend,
        modelLabel: job.modelLabel,
        styleLabel: running.styleLabel,
      };

      writeCharacterCreatePersistence(persistenceOwnerKey, {
        ...running,
        status: "completed",
        candidate,
        updatedAt: Date.now(),
      });

      if (characterCreateMountedRef.current) {
        setCreateCandidates((current) => {
          if (current.some((item) => item.promptId === candidate.promptId)) return current;
          return [candidate, ...current].slice(0, 5);
        });
        setCreateMessage(`Recovered ${candidate.modelLabel} / ${candidate.styleLabel} candidate.`);
        if (characterPageIsVisible()) clearCharacterCreatePersistence(persistenceOwnerKey);
      }
    } catch (error: any) {
      if (characterCreateMountedRef.current) {
        const message = error?.message || String(error);
        if (characterCreateErrorIsRetryable(error)) {
          setCreateError("");
          setCreateMessage(
            `Character generation is still pending. Return to this page when connectivity is available and recovery will retry automatically. ${message}`.trim(),
          );
        } else {
          clearCharacterCreatePersistence(persistenceOwnerKey);
          setCreateError(message);
          setCreateMessage("");
        }
      }
    } finally {
      characterCreateJobInFlightRef.current = false;
      if (characterCreateMountedRef.current) setCreateLoading(false);
    }
  }, [sourceMode, persistenceOwnerKey]);

  React.useEffect(() => {
    characterCreateMountedRef.current = true;
    const resumeWhenVisible = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void resumePersistedCharacterCreateJob();
      }
    };

    void resumePersistedCharacterCreateJob();
    document.addEventListener("visibilitychange", resumeWhenVisible);
    window.addEventListener("pageshow", resumeWhenVisible);

    return () => {
      characterCreateMountedRef.current = false;
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      window.removeEventListener("pageshow", resumeWhenVisible);
    };
  }, [resumePersistedCharacterCreateJob]);

  // OTG_CHARACTER_HUB_REFERENCE_RESUME_V1
  React.useEffect(() => {
    if (
      !characterHubDraftHydrated ||
      !characterCompletionJobId ||
      characterReferences?.status === "complete" ||
      characterCardInFlightRef.current
    ) {
      return;
    }

    characterCardInFlightRef.current = true;
    setCharacterCardStatus("running");

    void pollCharacterReferenceCompletionV1(characterCompletionJobId)
      .catch((error: any) => {
        setCharacterCardStatus("error");
        setCreateError(error?.message || String(error));
      })
      .finally(() => {
        characterCardInFlightRef.current = false;
      });
  }, [
    characterHubDraftHydrated,
    characterCompletionJobId,
    characterReferences?.status,
  ]);

  async function generateCharacter() {
    if (sourceMode !== "generated") return;
    const cleanDescription = description.trim();
    if (!cleanDescription || createLoading || characterCreateJobInFlightRef.current) return;

    const requestBody: CharacterCreateRequestBody = {
      model: modelId,
      style: stylePresetId,
      televisionAnimeStyle:
        stylePresetId === "anime" ? televisionAnimeStyleId : "default",
      threeDAnimationStyle:
        stylePresetId === "pixar-3d" ? threeDAnimationStyleId : "default",
      mode,
      description: cleanDescription,
    };
    const submitting: CharacterCreatePersistenceRecord = {
      version: 2,
      status: "submitting",
      requestId: newCharacterCreateRequestId(),
      requestBody,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      styleLabel: selectedDetailedStyleLabel,
    };

    // Save the recovery key before any network request. If Android suspends or
    // kills Chrome immediately after Generate, the same idempotent request can
    // be recovered without submitting duplicate ComfyUI work.
    writeCharacterCreatePersistence(persistenceOwnerKey, submitting);
    characterCreateJobInFlightRef.current = true;
    setCreateLoading(true);
    setCreateError("");
    setCreateMessage(`Submitting ${selectedModel.label} / ${selectedStylePreset.label} to ComfyUI...`);

    try {
      const job = await ensureCharacterCreateSubmission(submitting, true);
      const running: CharacterCreatePersistenceRecord = {
        ...submitting,
        status: "running",
        job,
        updatedAt: Date.now(),
      };
      writeCharacterCreatePersistence(persistenceOwnerKey, running);
      setCreateMessage(
        `ComfyUI job ${job.promptId} is running on ${job.backend || "the selected backend"}...`,
      );

      const imageUrl = await waitForCharacterCreateImage(job);
      if (!characterCreateMountedRef.current) return;
      const upload = await copyCharacterHubImageToUpload(
        imageUrl,
        `character-${job.promptId}.png`,
      );
      const candidate: CharacterCreateCandidate = {
        id: `${job.promptId}-${Date.now()}`,
        imageUrl: upload.fileUrl || imageUrl,
        serverPath: upload.serverPath,
        promptId: job.promptId,
        seed: job.seed,
        backend: job.backend,
        modelLabel: job.modelLabel,
        styleLabel: selectedDetailedStyleLabel,
      };

      writeCharacterCreatePersistence(persistenceOwnerKey, {
        ...running,
        status: "completed",
        candidate,
        updatedAt: Date.now(),
      });
      setCreateCandidates((current) => {
        if (current.some((item) => item.promptId === candidate.promptId)) return current;
        return [candidate, ...current].slice(0, 5);
      });
      setCreateMessage(`Generated ${candidate.modelLabel} / ${candidate.styleLabel} candidate.`);
      if (characterPageIsVisible()) clearCharacterCreatePersistence(persistenceOwnerKey);
    } catch (error: any) {
      const message = error?.message || String(error);
      if (characterCreateErrorIsRetryable(error)) {
        setCreateError("");
        setCreateMessage(
          `Character generation remains saved and will retry when you return. ${message}`.trim(),
        );
      } else {
        clearCharacterCreatePersistence(persistenceOwnerKey);
        setCreateError(message);
        setCreateMessage("");
      }
    } finally {
      characterCreateJobInFlightRef.current = false;
      if (characterCreateMountedRef.current) setCreateLoading(false);
    }
  }

  if (characterFinalizeStep && processedCharacterSource && characterCard) {
    return (
      <CharacterIdentityVoicePanel
        mode={mode}
        sourceMode={sourceMode}
        uploadFraming={sourceMode === "uploaded" ? uploadFraming : undefined}
        originalSourceImagePath={
          sourceMode === "uploaded" ? uploadedSource?.serverPath : undefined
        }
        appearanceSeed={
          sourceMode === "uploaded"
            ? completionPrompt || (isFreeform ? "Uploaded Freeform Character" : "Uploaded Character")
            : description
        }
        processedImage={{
          imageUrl: processedCharacterSource.imageUrl,
          serverPath: processedCharacterSource.serverPath,
        }}
        characterCard={{
          imageUrl: characterCard.imageUrl,
          serverPath: characterCard.serverPath,
        }}
        characterReferences={characterReferences || undefined}
        onBackToCard={() => {
          setCharacterFinalizeStep(false);
          setCreateMessage("Returned to the accepted Character Card. Name, appearance, and voice are not changed until saved.");
        }}
        onSaved={() => {
          void clearCharacterHubDraftV1().finally(() => onBack());
        }}
      />
    );
  }

  if (characterCardStep) {
    return (
      <div className="space-y-4" data-otg="character-card-runtime-step">
        <div className="rounded-[30px] border border-amber-300/20 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.2),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
          <div className="text-xs font-black uppercase tracking-[0.24em] text-amber-200/75">Character Studio</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Character Card</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
            Generate exactly four canonical body-angle references: front, back, left profile, and right profile. Qwen creates the low-resolution angles first; each is then upscaled to a 1080×1920 master and combined into one four-angle Character Card.
          </p>
        </div>

        {expandedCandidate && typeof document !== "undefined" ? createPortal(
          <div className="pointer-events-auto fixed inset-0 z-[100000] isolate flex items-center justify-center bg-black/90 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Expanded Character Card image" onClick={() => setExpandedCandidate(null)}>
            <button
              type="button"
              onClick={() => setExpandedCandidate(null)}
              className="pointer-events-auto fixed z-[100001] inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-white/25 bg-black/85 px-5 text-sm font-black text-white"
              style={{ top: "max(0.75rem, env(safe-area-inset-top))", right: "max(0.75rem, env(safe-area-inset-right))" }}
              data-otg="character-candidate-lightbox-close"
            >
              Close
            </button>
            <img src={expandedCandidate.imageUrl} alt="Expanded Character Card workflow image" draggable={false} onContextMenu={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()} className="max-h-full max-w-full touch-manipulation object-contain select-none" />
          </div>,
          document.body,
        ) : null}

        {createMessage ? <div className="rounded-2xl border border-sky-300/15 bg-sky-300/[0.07] p-3 text-sm leading-6 text-sky-100/80">{createMessage}</div> : null}
        {createError ? <div className="rounded-2xl border border-red-300/20 bg-red-400/[0.08] p-3 text-sm leading-6 text-red-100">{createError}</div> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-5">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">Processed source image</div>
            {processedCharacterSource ? (
              <button type="button" onClick={() => setExpandedCandidate(processedCharacterSource)} className="mt-3 block w-full touch-manipulation rounded-2xl border border-white/10 bg-black/30 p-2" aria-label="Expand processed character source">
                <img src={processedCharacterSource.imageUrl} alt="Processed background-free character source" draggable={false} onContextMenu={(event) => event.preventDefault()} className="mx-auto max-h-[640px] w-full rounded-xl object-contain select-none" />
              </button>
            ) : null}
          </div>

          <div className="rounded-[28px] border border-amber-300/15 bg-amber-300/[0.045] p-5">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-amber-100/70">Four-angle Character Card</div>
            {characterCard ? (
              <button type="button" onClick={() => setExpandedCandidate(characterCard)} className="mt-3 block w-full touch-manipulation rounded-2xl border border-amber-200/20 bg-black/30 p-2" aria-label="Expand completed character card">
                <img src={characterCard.imageUrl} alt="Completed four-angle Character Card" draggable={false} onContextMenu={(event) => event.preventDefault()} className="mx-auto max-h-[640px] w-full rounded-xl object-contain select-none" />
              </button>
            ) : (
              <div className="mt-3 rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-white/45">Create the Character Card to generate four canonical body-angle references and the final four-angle card.</div>
            )}
            {characterCardStatus === "error" ? <p className="mt-3 text-sm text-red-100">Generation failed. The source and candidates are preserved; retry with Create Character Card.</p> : null}
            {characterCardStatus === "accepted" ? <p className="mt-3 text-sm text-emerald-100">Four-angle Character Card accepted. The processed single-character source remains the default/profile image.</p> : null}
          </div>
        </div>

        {/* OTG_CHARACTER_HUB_FOUR_MASTER_PREVIEW_V1 */}
        {characterReferences?.body ? (
          <div className="rounded-[28px] border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/70">
              Four canonical 1080×1920 masters
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {(
                [
                  ["front", "Front"],
                  ["back", "Back"],
                  ["leftProfile", "Left"],
                  ["rightProfile", "Right"],
                ] as const
              ).map(([key, label]) => {
                const asset = characterReferences.body?.[key];
                const url = characterReferenceAssetUrl(asset);
                if (!asset?.serverPath || !url) return null;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setExpandedCandidate({
                        ...(processedCharacterSource as CharacterCreateCandidate),
                        id: `reference-${key}`,
                        imageUrl: url,
                        serverPath: asset.serverPath,
                        promptId: asset.promptId || characterCompletionJobId,
                        modelLabel: `${label} 1080×1920`,
                        styleLabel: "Canonical Character Reference",
                      })
                    }
                    className="rounded-2xl border border-white/10 bg-black/30 p-2"
                  >
                    <img
                      src={url}
                      alt={`${label} character reference`}
                      draggable={false}
                      onContextMenu={(event) => event.preventDefault()}
                      className="aspect-[9/16] w-full rounded-xl object-contain"
                    />
                    <div className="mt-2 text-xs font-bold text-white/65">
                      {label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <CharacterCardRuntimeActions
          hasSource={Boolean(processedCharacterSource?.serverPath)}
          hasCard={Boolean(characterCard?.serverPath)}
          busy={characterCardStatus === "running"}
          gated={false}
          onCreate={createCharacterCard}
          onAccept={acceptCharacterCard}
          onBack={backToCandidates}
        />
      </div>
    );
  }

  if (sourceMode === "uploaded") {
    const completedUpload = selectedCreateCandidate;
    return (
      <div
        className="space-y-4"
        data-otg={isFreeform ? "upload-freeform-character" : "upload-character"}
      >
        <div className="rounded-[30px] border border-sky-300/20 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.22),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.24em] text-sky-200/75">
                Character Gallery
              </div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
                {title}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
                Upload the source, identify its framing, then complete only the missing Character before the shared Character Card and voice stages.
              </p>
            </div>
            <BackButton label="Character Gallery" onClick={onBack} />
          </div>
        </div>

        {isFreeform ? (
          <div className="rounded-2xl border border-cyan-300/25 bg-cyan-400/[0.08] p-4 text-sm leading-6 text-cyan-50" data-otg="freeform-anatomy-notice">
            Unusual anatomy and complete non-humanoid forms are allowed. Your completion description defines the intended Character.
          </div>
        ) : null}

        {createMessage ? (
          <div className="rounded-2xl border border-sky-300/15 bg-sky-300/[0.07] p-3 text-sm leading-6 text-sky-100/80">
            {createMessage}
          </div>
        ) : null}
        {createError ? (
          <div className="rounded-2xl border border-red-300/20 bg-red-400/[0.08] p-3 text-sm leading-6 text-red-100" role="alert">
            {createError}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.78fr)_minmax(300px,1fr)]">
          <section className="rounded-[28px] border border-white/10 bg-white/[0.035] p-5 sm:p-6">
            <label htmlFor={`character-upload-${mode}`} className="text-xs font-black uppercase tracking-[0.2em] text-sky-200/75">
              Character image
            </label>
            <input
              id={`character-upload-${mode}`}
              type="file"
              accept="image/*"
              disabled={createLoading}
              onChange={(event) => void uploadCharacterSource(event.target.files?.[0] || null)}
              className="mt-3 block w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white file:mr-3 file:rounded-lg file:border-0 file:bg-sky-300 file:px-3 file:py-2 file:font-bold file:text-zinc-950"
              data-otg="character-upload-source"
            />

            <div className="mt-4 flex min-h-[360px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35 p-3 sm:min-h-[520px]">
              {uploadedSource ? (
                <img
                  src={uploadedSource.imageUrl}
                  alt="Uploaded Character source"
                  className="max-h-[640px] w-full object-contain object-center"
                  data-otg="character-upload-source-preview"
                />
              ) : (
                <div className="px-4 text-center text-sm text-white/40">Upload an image to begin.</div>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-300/15 bg-sky-400/[0.05] p-5 sm:p-6">
            <fieldset disabled={!uploadedSource || createLoading}>
              <legend className="text-xs font-black uppercase tracking-[0.2em] text-sky-200/75">
                What does the image contain?
              </legend>
              <div className="mt-3 grid grid-cols-3 gap-2" data-otg="character-upload-framing">
                {(
                  [
                    ["head", "Head"],
                    ["half-body", "Half Body"],
                    ["full-body", "Full Body"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center justify-center rounded-xl border px-2 text-center text-sm font-black transition",
                      uploadFraming === value
                        ? "border-sky-200 bg-sky-300 text-zinc-950"
                        : "border-white/15 bg-black/25 text-white/65",
                    )}
                  >
                    <input
                      type="radio"
                      name={`character-upload-framing-${mode}`}
                      value={value}
                      checked={uploadFraming === value}
                      onChange={() => changeUploadFraming(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {uploadFraming === "full-body" ? (
              <div className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.07] p-4">
                <p className="text-sm leading-6 text-emerald-50/80">
                  {isFreeform
                    ? "Full Body means the entire intended Character or form is already visible. Qwen completion is skipped."
                    : "The complete Character is already visible. Qwen completion is skipped."}
                </p>
                <button
                  type="button"
                  onClick={() => void continueFullBodyUpload()}
                  disabled={!uploadedSource || createLoading || Boolean(candidateBusyId)}
                  className="mt-4 min-h-12 w-full rounded-xl bg-emerald-300 px-4 text-sm font-black text-zinc-950 disabled:opacity-40"
                  data-otg="character-upload-full-body-direct"
                >
                  {createLoading || candidateBusyId ? "Processing..." : "Process Full Body & Continue"}
                </button>
              </div>
            ) : (
              <div className="mt-5">
                <label htmlFor={`character-completion-prompt-${mode}`} className="text-xs font-black uppercase tracking-[0.2em] text-sky-200/75">
                  {isFreeform ? "Complete Character description" : "Full body and clothing description"}
                </label>
                <textarea
                  id={`character-completion-prompt-${mode}`}
                  value={completionPrompt}
                  onChange={(event) => setCompletionPrompt(event.target.value)}
                  rows={6}
                  required
                  placeholder={
                    isFreeform
                      ? "Describe the complete intended anatomy or form, including every unusual limb, head, tail, wing, appendage, material, or boundary that should be visible."
                      : "Describe the intended body, proportions, clothing, footwear, and colors while preserving the uploaded face and identity."
                  }
                  className="mt-3 w-full resize-y rounded-2xl border border-sky-300/20 bg-black/35 p-4 text-sm leading-6 text-white outline-none placeholder:text-white/30 focus:border-sky-200/60"
                  data-otg="character-upload-completion-prompt"
                />
                <button
                  type="button"
                  onClick={() => void completeUploadedCharacter()}
                  disabled={!uploadedSource || !completionPrompt.trim() || createLoading}
                  className="mt-4 min-h-12 w-full rounded-xl bg-sky-300 px-4 text-sm font-black text-zinc-950 disabled:opacity-40"
                  data-otg="character-upload-run-completion"
                >
                  {createLoading ? "Completing with Qwen..." : "Complete Character with Qwen"}
                </button>
              </div>
            )}

            {completedUpload && uploadFraming !== "full-body" ? (
              <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-black/30 p-3" data-otg="character-upload-completed-preview">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/70">
                  Completed Character
                </div>
                <div className="mt-3 flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl bg-black/35 p-2">
                  <img
                    src={completedUpload.imageUrl}
                    alt="Qwen completed Character"
                    className="max-h-[600px] w-full object-contain object-center"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void continueCandidateToCharacterCard(completedUpload)}
                  disabled={Boolean(candidateBusyId) || createLoading}
                  className="mt-4 min-h-12 w-full rounded-xl bg-cyan-300 px-4 text-sm font-black text-zinc-950 disabled:opacity-40"
                >
                  {candidateBusyId ? "Processing..." : "Continue to Character Card"}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div
      className="space-y-4"
      data-otg={
        isFreeform
          ? "create-freeform-character-model-setup"
          : "create-character-model-setup"
      }
    >
      <div className="rounded-[30px] border border-sky-300/20 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.22),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-sky-200/75">
              Character Gallery
            </div>

            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {title}
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
              Choose the image model and describe the character you want to
              create.
            </p>
          </div>

          <BackButton label="Character Gallery" onClick={onBack} />
        </div>
      </div>

      {modifyingCandidate ? (
        <CandidateModifyDialog
          candidate={editableCharacterHubCandidate(modifyingCandidate)}
          imageSrc={modifyingCandidate.imageUrl}
          requestedChange={modifyInstruction}
          negativePrompt={modifyNegativePrompt}
          advancedOpen={modifyAdvancedOpen}
          status={candidateEditStatus}
          error={createError}
          onRequestedChange={setModifyInstruction}
          onNegativePrompt={setModifyNegativePrompt}
          onToggleAdvanced={() => setModifyAdvancedOpen((current) => !current)}
          onExpand={() => setExpandedCandidate(modifyingCandidate)}
          onApply={applyCandidateEdit}
          onCancel={closeCandidateEdit}
        />
      ) : null}

      {expandedCandidate && typeof document !== "undefined" ? createPortal(
        <div
          className="pointer-events-auto fixed inset-0 z-[100000] isolate flex items-center justify-center bg-black/90 p-3 sm:p-6"
          data-otg="character-candidate-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded Character candidate"
          onClick={() => setExpandedCandidate(null)}
        >
          <button
            type="button"
            onClick={() => setExpandedCandidate(null)}
            className="pointer-events-auto fixed z-[100001] inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-white/25 bg-black/85 px-5 text-sm font-black text-white shadow-lg transition hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            style={{
              top: "max(0.75rem, env(safe-area-inset-top))",
              right: "max(0.75rem, env(safe-area-inset-right))",
            }}
            data-otg="character-candidate-lightbox-close"
            autoFocus
          >
            Close
          </button>

          <div
            className="relative flex h-full w-full max-w-6xl flex-col"
          >
            <div
              className="mb-3 flex min-h-12 items-center rounded-2xl border border-white/10 bg-black/60 py-3 pl-4 pr-28 backdrop-blur"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-white">
                  {expandedCandidate.modelLabel}
                </div>

                <div className="mt-0.5 text-xs text-white/45">
                  {expandedCandidate.styleLabel} · Seed{" "}
                  {expandedCandidate.seed}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/70">
              <img
                src={expandedCandidate.imageUrl}
                alt={`${expandedCandidate.modelLabel} expanded Character candidate`}
                className="h-full w-full object-contain"
                draggable={false}
                onClick={(event) => event.stopPropagation()}
              />
            </div>

            <div className="mt-3 text-center text-xs text-white/40">
              Tap outside the image viewer or press Close to return.
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
        <div className="rounded-[28px] border border-sky-300/15 bg-sky-400/[0.055] p-5 sm:p-7">
          <label
            htmlFor={`character-model-${mode}`}
            className="text-xs font-black uppercase tracking-[0.2em] text-sky-200/75"
          >
            Image Model
          </label>

          <select
            id={`character-model-${mode}`}
            value={modelId}
            onChange={(event) =>
              setModelId(event.target.value as CharacterModelId)
            }
            className="mt-3 min-h-12 w-full rounded-2xl border border-sky-300/20 bg-black/35 px-4 text-base font-bold text-white outline-none transition focus:border-sky-200/60"
            data-otg="character-image-model-select"
          >
            {CHARACTER_IMAGE_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>

          <label
            htmlFor={`character-style-${mode}`}
            className="mt-6 block text-xs font-black uppercase tracking-[0.2em] text-sky-200/75"
          >
            Art Style Preset
          </label>

          <select
            id={`character-style-${mode}`}
            value={stylePresetId}
            onChange={(event) =>
              setStylePresetId(event.target.value as CharacterStylePresetId)
            }
            className="mt-3 min-h-12 w-full rounded-2xl border border-sky-300/20 bg-black/35 px-4 text-base font-bold text-white outline-none transition focus:border-sky-200/60"
            data-otg="character-style-preset-select"
          >
            {CHARACTER_STYLE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>

          {stylePresetId === "pixar-3d" ? (
            <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.055] p-4" data-otg="character-3d-animation-style-panel">
              <label
                htmlFor={`character-3d-animation-style-${mode}`}
                className="block text-xs font-black uppercase tracking-[0.2em] text-cyan-100/80"
              >
                3D Animation Art Styles
              </label>

              <select
                id={`character-3d-animation-style-${mode}`}
                value={threeDAnimationStyleId}
                onChange={(event) =>
                  setThreeDAnimationStyleId(
                    event.target.value as ThreeDAnimationStyleId,
                  )
                }
                className="mt-3 min-h-12 w-full rounded-2xl border border-cyan-300/20 bg-black/35 px-4 text-base font-bold text-white outline-none transition focus:border-cyan-200/60"
                data-otg="character-3d-animation-style-select"
              >
                {THREE_D_ANIMATION_STYLE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>

              <p className="mt-3 text-xs leading-5 text-white/45">
                {selectedThreeDAnimationStyle.description}
              </p>

              <p className="mt-2 text-[11px] leading-5 text-cyan-100/55">
                Default keeps the regular 3D Animation preset unchanged.
                Alternate choices add only a separate 3D animation visual
                treatment; they do not replace your Character Description.
              </p>
            </div>
          ) : null}

          {stylePresetId === "anime" ? (
            <div className="mt-5 rounded-2xl border border-violet-300/20 bg-violet-400/[0.055] p-4" data-otg="character-television-anime-style-panel">
              <label
                htmlFor={`character-television-anime-style-${mode}`}
                className="block text-xs font-black uppercase tracking-[0.2em] text-violet-100/80"
              >
                Television Anime Art Styles
              </label>

              <select
                id={`character-television-anime-style-${mode}`}
                value={televisionAnimeStyleId}
                onChange={(event) =>
                  setTelevisionAnimeStyleId(
                    event.target.value as TelevisionAnimeStyleId,
                  )
                }
                className="mt-3 min-h-12 w-full rounded-2xl border border-violet-300/20 bg-black/35 px-4 text-base font-bold text-white outline-none transition focus:border-violet-200/60"
                data-otg="character-television-anime-style-select"
              >
                {TELEVISION_ANIME_STYLE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>

              <p className="mt-3 text-xs leading-5 text-white/45">
                {selectedTelevisionAnimeStyle.description}
              </p>

              <p className="mt-2 text-[11px] leading-5 text-violet-100/55">
                Default keeps the regular Anime preset unchanged. Alternate
                choices add only a separate television-anime visual treatment;
                they do not replace your Character Description.
              </p>
            </div>
          ) : null}

          <label
            htmlFor={`character-description-${mode}`}
            className="mt-6 block text-xs font-black uppercase tracking-[0.2em] text-sky-200/75"
          >
            Character Description
          </label>

          <textarea
            id={`character-description-${mode}`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={8}
            placeholder={
              isFreeform
                ? "Describe any character, creature, body plan, form, or design..."
                : "Describe the standard full-body character you want to create..."
            }
            className="mt-3 w-full resize-y rounded-2xl border border-sky-300/20 bg-black/35 p-4 text-base leading-7 text-white outline-none placeholder:text-white/30 focus:border-sky-200/60"
            data-otg="character-description-input"
          />

          <button
            type="button"
            onClick={enhanceCharacterDescription}
            disabled={
              enhanceDescriptionLoading ||
              createLoading ||
              !description.trim()
            }
            className="mt-3 min-h-11 w-full rounded-2xl border border-violet-300/30 bg-violet-400/15 px-5 text-sm font-black text-violet-50 transition hover:bg-violet-400/25 disabled:cursor-not-allowed disabled:opacity-40"
            data-otg="character-description-enhance"
          >
            {enhanceDescriptionLoading
              ? "Enhancing Description..."
              : "Enhance Prompt"}
          </button>

          <div
            className="mt-2 text-xs leading-5 text-white/40"
            data-otg="character-description-enhance-help"
          >
            Expands your idea into specific visual character details. Art Style
            is applied separately when you generate.
          </div>

          <button
            type="button"
            onClick={generateCharacter}
            disabled={createLoading || !description.trim()}
            className="mt-5 min-h-12 w-full rounded-2xl border border-sky-300/30 bg-sky-400/20 px-5 text-base font-black text-sky-50 transition hover:bg-sky-400/30 disabled:cursor-not-allowed disabled:opacity-40"
            data-otg="character-create-generate"
          >
            {createLoading ? "Generating..." : "Generate Character"}
          </button>

          <p className="mt-3 text-xs leading-5 text-white/40">
            Generation uses the selected supplied Turbo workflow, exact
            portrait 1080 x 1920 output, and a fresh random seed. Temporary
            candidates are returned from ComfyUI preview storage and are not
            copied into the normal Gallery.
          </p>

          {createMessage ? (
            <div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-300/[0.07] p-3 text-sm leading-6 text-sky-100/80">
              {createMessage}
            </div>
          ) : null}

          {createError ? (
            <div className="mt-4 rounded-2xl border border-red-300/20 bg-red-400/[0.08] p-3 text-sm leading-6 text-red-100">
              {createError}
            </div>
          ) : null}

          {createCandidates.length > 0 ? (
            <div className="mt-6" data-otg="character-generated-candidates">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-200/75">
                Generated Candidates
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {createCandidates.map((candidate) => {
                  const selected =
                    candidate.id === selectedCreateCandidateId;
                  const busy =
                    candidate.id === candidateBusyId;

                  return (
                    <div
                      key={candidate.id}
                      className={`overflow-hidden rounded-2xl border transition ${
                        selected
                          ? "border-sky-200/80 bg-sky-300/10"
                          : "border-white/10 bg-black/20"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedCandidate(candidate)}
                        className="group relative block w-full touch-manipulation overflow-hidden bg-black"
                        aria-label={`Expand ${candidate.modelLabel} generated character candidate`}
                        data-otg="character-candidate-expand"
                      >
                        <img
                          src={candidate.imageUrl}
                          alt={`${candidate.modelLabel} generated character candidate`}
                          className="aspect-[9/16] w-full bg-black object-contain object-center transition duration-200 group-hover:scale-[1.01]"
                          draggable={false}
                          onContextMenu={(event) => event.preventDefault()}
                        />

                        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-3 pt-8 text-center text-[10px] font-black uppercase tracking-[0.14em] text-white/75 opacity-0 transition group-hover:opacity-100">
                          Tap to expand
                        </div>
                      </button>

                      <div className="space-y-2 p-2">
                        <div className="truncate text-xs font-black text-white">
                          {candidate.modelLabel}
                        </div>

                        <div className="truncate text-[11px] text-white/45">
                          {candidate.styleLabel}
                        </div>

                        <div className="truncate text-[10px] text-white/30">
                          Seed {candidate.seed}
                        </div>

                        {selected ? (
                          <div className="rounded-lg bg-sky-300/15 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-sky-100">
                            Selected for Character Card
                          </div>
                        ) : null}

                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => openCandidateEdit(candidate)}
                            className="rounded-lg border border-violet-300/20 bg-violet-400/10 px-2 py-2 text-[11px] font-bold text-violet-100"
                          >
                            Modify
                          </button>

                          <button
                            type="button"
                            onClick={() => selectCandidate(candidate)}
                            className="rounded-lg border border-sky-300/25 bg-sky-400/15 px-2 py-2 text-[11px] font-bold text-sky-100"
                          >
                            Select
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              saveCandidateForLater(candidate)
                            }
                            className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-2 py-2 text-[11px] font-bold text-emerald-100 disabled:opacity-40"
                          >
                            {busy ? "Saving..." : "Save for Later"}
                          </button>

                          <button
                            type="button"
                            onClick={() => clearCandidate(candidate.id)}
                            className="rounded-lg border border-red-300/20 bg-red-400/10 px-2 py-2 text-[11px] font-bold text-red-100"
                          >
                            Clear
                          </button>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs leading-5 text-white/40">
                  Generated and edited candidates remain available while you review the Character Card.
                </p>
                <ContinueToCharacterCardButton
                  candidate={selectedCreateCandidate ? editableCharacterHubCandidate(selectedCreateCandidate) : null}
                  busy={Boolean(candidateBusyId)}
                  onContinue={continueToCharacterCard}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-[26px] border border-white/10 bg-white/[0.035] p-5">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
              Selected Model
            </div>

            <div className="mt-2 text-2xl font-black text-white">
              {selectedModel.label}
            </div>

            <div className="mt-3 break-all rounded-xl bg-black/30 p-3 font-mono text-xs text-sky-200/80">
              {selectedModel.workflowFile}
            </div>
          </div>

          <div className="rounded-[26px] border border-sky-300/15 bg-sky-400/[0.05] p-5">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-200/70">
              Selected Style
            </div>

            <div className="mt-2 text-2xl font-black text-white">
              {selectedStylePreset.label}
            </div>

            <p className="mt-3 text-sm leading-6 text-white/60">
              {selectedStylePreset.description}
            </p>

            <div className="mt-3 rounded-xl bg-black/30 p-3 text-xs leading-6 text-sky-200/75">
              Prompt hint for later routing: {selectedStylePreset.promptHint}
            </div>
          </div>

          <div
            className="rounded-[26px] border border-white/10 bg-white/[0.03] p-5"
            data-otg="character-output-settings"
          >
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
              Fixed Output
            </div>

            <div className="mt-3 space-y-2 text-sm leading-6 text-white/65">
              <div>
                Resolution: {FIXED_CHARACTER_OUTPUT.width} x{" "}
                {FIXED_CHARACTER_OUTPUT.height}
              </div>
              <div>
                Orientation: {FIXED_CHARACTER_OUTPUT.orientation}
              </div>
              <div>Aspect Ratio: {FIXED_CHARACTER_OUTPUT.aspectRatio}</div>
              <div>Seed: {FIXED_CHARACTER_OUTPUT.seedBehavior}</div>
            </div>
          </div>

          <div className="rounded-[26px] border border-white/10 bg-white/[0.025] p-5 text-xs leading-6 text-white/45">
            Generation uses your Character Description and selected Art Style. {" "}
            {isFreeform
              ? "Freeform stays unrestricted by Standard anatomy and framing rules."
              : "Standard adds full body visible head-to-toe, neutral standing, and no-crop generation guidance."}{" "}
            Output stays fixed at 1080 x 1920 portrait, and every generation
            uses a fresh random seed.
          </div>
        </div>
      </div>
    </div>
  );
}

type CharacterStylePresetId =
  | "cartoon"
  | "anime"
  | "pixar-3d"
  | "unreal-engine"
  | "photorealistic"
  | "cinematic";

const CHARACTER_STYLE_PRESETS: Array<{
  id: CharacterStylePresetId;
  label: string;
  description: string;
  promptHint: string;
}> = [
  {
    id: "cartoon",
    label: "Cartoon",
    description:
      "Stylized cartoon illustration with clean shape language and expressive forms.",
    promptHint: "stylized cartoon illustration",
  },
  {
    id: "anime",
    label: "Anime",
    description:
      "Anime-inspired character rendering with bold silhouettes and stylized facial features.",
    promptHint: "anime character illustration",
  },
  {
    id: "pixar-3d",
    label: "3D Animation",
    description:
      "Family-friendly stylized 3D animated feature look with polished materials and appealing forms.",
    promptHint: "stylized 3D animated feature character render",
  },
  {
    id: "unreal-engine",
    label: "Unreal Engine",
    description:
      "Real-time cinematic game-render look with modern lighting and engine-style surface detail.",
    promptHint: "Unreal Engine character render",
  },
  {
    id: "photorealistic",
    label: "Photorealistic",
    description:
      "Naturalistic image treatment focused on realistic materials, lighting, and detail.",
    promptHint: "photorealistic character portrait",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description:
      "Cinematic image treatment emphasizing dramatic lighting, atmosphere, and film-like composition.",
    promptHint: "cinematic character portrait",
  },
];

const FIXED_CHARACTER_OUTPUT = {
  width: 1080,
  height: 1920,
  orientation: "Portrait",
  aspectRatio: "9:16",
  seedBehavior: "Random every generation",
} as const;

type CharacterCreateJob = {
  promptId: string;
  seed: number;
  outputNodeId: string;
  comfyBaseUrl: string;
  backend: string;
  modelLabel: string;
};

type CharacterCreateCandidate = CharacterCandidateLineage & {
  id: string;
  imageUrl: string;
  serverPath?: string;
  promptId: string;
  seed: number;
  backend: string;
  modelLabel: string;
  styleLabel: string;
  internalPrompt?: string;
  workflowId?: string;
  backgroundFree?: boolean;
};

type SavedForLaterCharacter = {
  id: string;
  imageUrl: string;
  promptId: string;
  seed: number;
  backend: string;
  modelLabel: string;
  styleLabel: string;
  mode: "standard" | "freeform";
  description: string;
  createdAt: string;
};

// OTG_CHARACTER_HUB_DURABLE_FOUR_REFERENCE_V1
type CharacterReferenceAssetV1 = {
  serverPath: string;
  url?: string;
  width: number;
  height: number;
  sourcePath?: string;
  promptId?: string;
};

type CharacterReferencePackageV1 = {
  pipelineVersion: 1;
  status:
    | "pending"
    | "generating_angles"
    | "upscaling"
    | "stitching"
    | "complete"
    | "failed";
  completionJobId?: string;
  anglePromptId?: string;
  upscalePromptIds?: Partial<
    Record<"front" | "back" | "leftProfile" | "rightProfile", string>
  >;
  body?: {
    front?: CharacterReferenceAssetV1;
    back?: CharacterReferenceAssetV1;
    leftProfile?: CharacterReferenceAssetV1;
    rightProfile?: CharacterReferenceAssetV1;
  };
  characterCard?: CharacterReferenceAssetV1;
  completedAt?: string;
  error?: string;
};

function newCharacterHubDraftId() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `character-draft-${random}`;
}

function characterReferenceAssetUrl(asset?: CharacterReferenceAssetV1 | null) {
  if (!asset) return "";
  if (asset.url) return asset.url;
  if (!asset.serverPath) return "";
  return `/api/file?path=${encodeURIComponent(asset.serverPath)}`;
}

function getCharacterHubDeviceId() {
  if (typeof window === "undefined") return "character-web";

  const storageKey = "otg_character_device_id";
  const existing = window.localStorage.getItem(storageKey);

  if (existing) return existing;

  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `character-${crypto.randomUUID()}`
      : `character-${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`;

  window.localStorage.setItem(storageKey, value);
  return value;
}

// OTG_CHARACTER_MOBILE_GENERATION_PERSISTENCE_PHASE10_UI
const CHARACTER_CREATE_PERSISTENCE_KEY = "otg_character_create_pending_v2";
const CHARACTER_CREATE_PERSISTENCE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function characterCreatePersistenceKey(ownerKey: string) {
  const normalized = String(ownerKey || "").trim().toLowerCase();
  return normalized ? `${CHARACTER_CREATE_PERSISTENCE_KEY}:${encodeURIComponent(normalized)}` : "";
}

type CharacterCreateRequestBody = {
  model: string;
  style: string;
  televisionAnimeStyle: string;
  threeDAnimationStyle: string;
  mode: string;
  description: string;
};

type CharacterCreatePersistenceRecord = {
  version: 2;
  status: "submitting" | "running" | "completed";
  requestId: string;
  requestBody: CharacterCreateRequestBody;
  createdAt: number;
  updatedAt: number;
  styleLabel: string;
  job?: CharacterCreateJob;
  candidate?: CharacterCreateCandidate;
};

function newCharacterCreateRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `character-create-${crypto.randomUUID()}`;
  }
  return `character-create-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readCharacterCreatePersistence(ownerKey: string): CharacterCreatePersistenceRecord | null {
  if (typeof window === "undefined") return null;
  const storageKey = characterCreatePersistenceKey(ownerKey);
  if (!storageKey) return null;
  try {
    // The former unscoped key is intentionally never restored into an account.
    window.localStorage.removeItem(CHARACTER_CREATE_PERSISTENCE_KEY);
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CharacterCreatePersistenceRecord;
    if (
      parsed?.version !== 2 ||
      !parsed.requestId ||
      !parsed.requestBody ||
      !["submitting", "running", "completed"].includes(parsed.status)
    ) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    const ageMs = Date.now() - Number(parsed.updatedAt || parsed.createdAt || 0);
    if (!Number.isFinite(ageMs) || ageMs > CHARACTER_CREATE_PERSISTENCE_MAX_AGE_MS) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore unavailable browser storage.
    }
    return null;
  }
}

function writeCharacterCreatePersistence(ownerKey: string, record: CharacterCreatePersistenceRecord) {
  if (typeof window === "undefined") return;
  const storageKey = characterCreatePersistenceKey(ownerKey);
  if (!storageKey) return;
  try {
    window.localStorage.removeItem(CHARACTER_CREATE_PERSISTENCE_KEY);
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ ...record, updatedAt: Date.now() }),
    );
  } catch {
    // Generation remains usable even when browser storage is unavailable.
  }
}

function clearCharacterCreatePersistence(ownerKey: string) {
  if (typeof window === "undefined") return;
  try {
    const storageKey = characterCreatePersistenceKey(ownerKey);
    window.localStorage.removeItem(CHARACTER_CREATE_PERSISTENCE_KEY);
    if (storageKey) window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore unavailable browser storage.
  }
}

function characterPageIsVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function characterCreateErrorIsRetryable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /fetch|network|load failed|timed out recovering|timed out waiting/i.test(message);
}

function characterCreateJobFromPayload(payload: any): CharacterCreateJob | null {
  const promptId = String(payload?.promptId || payload?.prompt_id || "").trim();
  const outputNodeId = String(payload?.outputNodeId || "").trim();
  if (!promptId || !outputNodeId) return null;
  return {
    promptId,
    seed: Number(payload?.seed || 0),
    outputNodeId,
    comfyBaseUrl: String(payload?.comfyBaseUrl || "").trim(),
    backend: String(payload?.backend || "").trim(),
    modelLabel: String(payload?.modelLabel || "Character model").trim(),
  };
}

async function ensureCharacterCreateSubmission(
  persisted: CharacterCreatePersistenceRecord,
  submitFirst: boolean,
) {
  const started = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let shouldPost = submitFirst;
  let lastPostAttempt = 0;

  while (Date.now() - started < timeoutMs) {
    if (shouldPost || Date.now() - lastPostAttempt > 5000) {
      lastPostAttempt = Date.now();
      shouldPost = false;
      try {
        const response = await fetch("/api/characters/create-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          keepalive: true,
          body: JSON.stringify({
            ...persisted.requestBody,
            clientRequestId: persisted.requestId,
          }),
        });
        const json = await response.json().catch(() => null);
        const job = response.ok && json?.ok ? characterCreateJobFromPayload(json) : null;
        if (job) return job;
        if (response.status !== 202 && !response.ok) {
          throw new Error(json?.error || `Character generation submit failed (${response.status}).`);
        }
      } catch (error: any) {
        // A transport failure does not tell us whether the server received the
        // idempotent request. Resolve it through the status endpoint below.
        if (error?.message && !/fetch|network|load failed/i.test(String(error.message))) {
          throw error;
        }
      }
    }

    try {
      const params = new URLSearchParams({
        requestId: persisted.requestId,
        t: Date.now().toString(36),
      });
      const response = await fetch(`/api/characters/create-image/status?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = await response.json().catch(() => null);
      if (response.ok && json?.ok) {
        const record = json.request;
        const job = record?.status === "submitted" ? characterCreateJobFromPayload(record) : null;
        if (job) return job;
        if (record?.status === "failed") {
          throw new Error(record?.error || "Character generation request failed.");
        }
      } else if (response.status === 404) {
        shouldPost = true;
      } else if (json?.error) {
        throw new Error(String(json.error));
      }
    } catch (error: any) {
      if (error?.message && !/fetch|network|load failed/i.test(String(error.message))) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error("Timed out recovering the Character generation submission.");
}

function randomCharacterSeed() {
  const values = new Uint32Array(2);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(values);
    return String(values[0] * 0x100000 + (values[1] & 0xfffff));
  }
  return String(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
}

function editableCharacterHubCandidate(candidate: CharacterCreateCandidate): EditableCharacterCandidate {
  return {
    id: candidate.id,
    label: candidate.modelLabel,
    url: candidate.imageUrl,
    serverPath: candidate.serverPath,
    internalPrompt: candidate.internalPrompt,
    promptId: candidate.promptId,
    workflowId: candidate.workflowId,
    backgroundFree: candidate.backgroundFree,
    sourceCandidateId: candidate.sourceCandidateId,
    rootCandidateId: candidate.rootCandidateId,
    editDepth: candidate.editDepth,
    editInstruction: candidate.editInstruction,
  };
}

async function copyCharacterHubImageToUpload(outputUrl: string, filename: string) {
  const imageResponse = await fetch(outputUrl, { cache: "no-store", credentials: "include" });
  if (!imageResponse.ok) {
    throw new Error(`Could not read the Character image output (${imageResponse.status}).`);
  }
  const blob = await imageResponse.blob();
  const form = new FormData();
  form.set("image", new File([blob], filename, { type: blob.type || "image/png" }));
  const response = await fetch("/api/characters/upload", {
    method: "POST",
    headers: { "x-otg-device-id": getCharacterHubDeviceId() },
    credentials: "include",
    body: form,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || `Could not persist the Character image (${response.status}).`);
  }
  const serverPath = String(json.serverPath || "").trim();
  if (!serverPath) throw new Error("Character image upload did not return a stable server path.");
  return { serverPath, fileUrl: String(json.fileUrl || "").trim() || undefined };
}

async function waitForCharacterWorkflowImage(
  promptId: string,
  selector: { nodeId: string; filenamePrefix: string },
) {
  const started = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  while (Date.now() - started < timeoutMs) {
    const params = new URLSearchParams({
      promptId,
      nodeId: selector.nodeId,
      filenamePrefix: selector.filenamePrefix,
      t: Date.now().toString(36),
    });
    const response = await fetch(`/api/comfy/history-image?${params.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });
    const json = await response.json().catch(() => null);
    if (response.ok && json?.ok) {
      const url = String(json.imageUrl || json.url || "").trim();
      if (url) return { url };
    }
    if (response.status !== 404 && json?.error) throw new Error(String(json.error));
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for Character workflow image ${promptId}.`);
}

async function waitForCharacterCreateImage(job: CharacterCreateJob) {
  const started = Date.now();
  const timeoutMs = 24 * 60 * 60 * 1000;
  while (Date.now() - started < timeoutMs) {
    const params = new URLSearchParams({
      promptId: job.promptId,
      nodeId: job.outputNodeId,
      t: Date.now().toString(36),
    });
    if (job.comfyBaseUrl) params.set("comfyBaseUrl", job.comfyBaseUrl);

    let response: Response;
    try {
      response = await fetch(`/api/comfy/history-image?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });
    } catch {
      // Android Chrome can reject an in-flight poll when the tab is suspended.
      // The ComfyUI job remains valid; resume polling when connectivity returns.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      continue;
    }

    const json = await response.json().catch(() => null);
    if (response.ok && json?.ok) {
      const imageUrl = String(json.imageUrl || json.url || "").trim();
      if (imageUrl) return imageUrl;
    }
    if (response.status !== 404 && json?.error) {
      throw new Error(String(json.error));
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for Character image ${job.promptId}.`);
}

function WorkflowPlaceholder({
  title,
  description,
  onBack,
}: {
  title: string;
  description: string;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4" data-otg="character-phase1-workflow-placeholder">
      <div className="rounded-[30px] border border-sky-300/20 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.22),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-sky-200/75">
              Character Gallery
            </div>

            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {title}
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
              {description}
            </p>
          </div>

          <BackButton label="Character Gallery" onClick={onBack} />
        </div>
      </div>

      <div className="rounded-[28px] border border-sky-300/15 bg-sky-400/[0.055] p-6 sm:p-8">
        <div className="text-xs font-black uppercase tracking-[0.22em] text-sky-200/65">
          Approval checkpoint
        </div>

        <h2 className="mt-3 text-2xl font-black text-white">
          Layout only.
        </h2>

        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/60">
          This Phase 1 screen contains navigation only. No generation, upload,
          character-save, background-removal, character-card, or voice behavior
          is wired into the new user-facing workflow yet.
        </p>
      </div>
    </div>
  );
}

function SavedForLaterGallery({
  onBack,
  onUse,
}: {
  onBack: () => void;
  onUse: (item: SavedForLaterCharacter) => void;
}) {
  const [items, setItems] =
    React.useState<SavedForLaterCharacter[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;

    async function loadSavedCharacters() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          "/api/characters/saved-for-later",
          {
            cache: "no-store",
            credentials: "include",
            headers: {
              "x-otg-device-id": getCharacterHubDeviceId(),
            },
          },
        );

        const json = await response.json().catch(() => null);

        if (!response.ok || !json?.ok) {
          throw new Error(
            json?.error ||
              `Could not load Saved for Later (${response.status}).`,
          );
        }

        if (!cancelled) {
          setItems(Array.isArray(json.items) ? json.items : []);
        }
      } catch (error: any) {
        if (!cancelled) {
          setError(error?.message || String(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSavedCharacters();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="space-y-4"
      data-otg="saved-for-later-character-gallery"
    >
      <div className="rounded-[30px] border border-emerald-300/20 bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.18),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-emerald-200/75">
              Character Gallery
            </div>

            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Saved for Later
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
              Character candidates saved without committing them to a Character Card.
            </p>
          </div>

          <BackButton
            label="Character Gallery"
            onClick={onBack}
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/50">
          Loading saved Character candidates...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-300/20 bg-red-400/[0.08] p-5 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/50">
          Nothing has been saved for later yet.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="overflow-hidden rounded-2xl border border-white/10 bg-black/20"
          >
            <img
              src={item.imageUrl}
              alt={`${item.modelLabel || "Saved"} Character candidate`}
              className="aspect-[9/16] w-full bg-black object-contain object-center"
              draggable={false}
            />

            <div className="space-y-2 p-3">
              <div className="truncate text-sm font-black text-white">
                {item.modelLabel || "Character Candidate"}
              </div>

              <div className="text-xs text-white/45">
                {item.styleLabel || "Saved style"}
              </div>

              <div className="text-[11px] text-white/35">
                {item.mode === "freeform"
                  ? "Freeform Character"
                  : "Standard Character"}
              </div>

              <button
                type="button"
                onClick={() => onUse(item)}
                className="w-full rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-100 transition hover:bg-emerald-400/20"
              >
                Use Character
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FutureGalleryPlaceholder({
  title,
  description,
  onBack,
}: {
  title: string;
  description: string;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-[30px] border border-sky-300/20 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-sky-200/75">
              Character Studio
            </div>

            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {title}
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
              {description}
            </p>
          </div>

          <BackButton label="Galleries" onClick={onBack} />
        </div>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6 text-sm leading-7 text-white/55">
        This gallery is part of the new navigation shell, but its content and
        management workflow will be rebuilt in a later approved phase.
      </div>
    </div>
  );
}

export default function CharacterHubPanel({
  isAdmin = false,
  authenticatedOwnerKey = "",
}: CharacterHubPanelProps) {
  const [view, setView] = React.useState<CharacterHubView>("home");
  const [
    reusableSavedCandidate,
    setReusableSavedCandidate,
  ] = React.useState<CharacterCreateCandidate | null>(null);

  if (view === "legacy") {
    if (!isAdmin) {
      return (
        <div className="space-y-4">
          <BackButton label="Characters" onClick={() => setView("home")} />

          <div className="rounded-[28px] border border-red-400/20 bg-red-500/10 p-6 text-sm font-semibold text-red-100">
            Legacy Characters is restricted to administrators.
          </div>
        </div>
      );
    }

    return (
      <div
        className="space-y-4"
        data-otg="legacy-characters-admin"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-amber-300/20 bg-amber-500/10 p-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-amber-200/75">
              Admin only
            </div>

            <div className="mt-1 text-lg font-black text-white">
              Legacy Characters
            </div>

            <div className="mt-1 text-xs text-white/45">
              Current stable Character implementation preserved unchanged.
            </div>
          </div>

          <BackButton label="New Characters" onClick={() => setView("home")} />
        </div>

        <LegacyCharactersPanel authenticatedOwnerKey={authenticatedOwnerKey} />
      </div>
    );
  }

  if (view === "create-character") {
    return (
      <CharacterCreateSetup
        mode="standard"
        sourceMode="generated"
        persistenceOwnerKey={authenticatedOwnerKey}
        onBack={() => setView("character-gallery")}
        initialCandidate={reusableSavedCandidate}
        onInitialCandidateConsumed={() =>
          setReusableSavedCandidate(null)
        }
      />
    );
  }

  if (view === "create-freeform") {
    return (
      <CharacterCreateSetup
        mode="freeform"
        sourceMode="generated"
        persistenceOwnerKey={authenticatedOwnerKey}
        onBack={() => setView("character-gallery")}
        initialCandidate={reusableSavedCandidate}
        onInitialCandidateConsumed={() =>
          setReusableSavedCandidate(null)
        }
      />
    );
  }

  if (view === "upload-character") {
    return (
      <CharacterCreateSetup
        mode="standard"
        sourceMode="uploaded"
        persistenceOwnerKey={authenticatedOwnerKey}
        onBack={() => setView("character-gallery")}
      />
    );
  }

  if (view === "upload-freeform") {
    return (
      <CharacterCreateSetup
        mode="freeform"
        sourceMode="uploaded"
        persistenceOwnerKey={authenticatedOwnerKey}
        onBack={() => setView("character-gallery")}
      />
    );
  }

  if (view === "saved-for-later") {
    return (
      <SavedForLaterGallery
        onBack={() => setView("character-gallery")}
        onUse={(item) => {
          setReusableSavedCandidate({
            id: `saved-${item.id}`,
            imageUrl: item.imageUrl,
            promptId: item.promptId,
            seed: item.seed,
            backend: item.backend,
            modelLabel: item.modelLabel,
            styleLabel: item.styleLabel,
          });

          setView(
            item.mode === "freeform"
              ? "create-freeform"
              : "create-character",
          );
        }}
      />
    );
  }

  // OTG_BACKGROUND_GALLERY_STUDIO_BRIDGE_V36B
  if (view === "background-gallery") {
    return (
      <LegacyCharactersPanel
        initialBackgroundStudioOpen
        authenticatedOwnerKey={authenticatedOwnerKey}
        onBackgroundStudioClose={() => setView("home")}
      />
    );
  }

  if (view === "asset-gallery") {
    return (
      <FutureGalleryPlaceholder
        title="Asset Gallery"
        description="Reusable production assets will be rebuilt after Character and Background galleries."
        onBack={() => setView("home")}
      />
    );
  }

  if (view === "character-gallery") {
    return (
      <div
        className="space-y-4"
        data-otg="character-gallery-phase1"
      >
        <div className="rounded-[30px] border border-sky-300/20 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.24),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.24em] text-sky-200/75">
                Character Studio
              </div>

              <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
                Character Gallery
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
                Create a character, finish its compact identity and voice, or reopen a saved character from the library below.
              </p>
            </div>

            <BackButton label="Galleries" onClick={() => setView("home")} />
          </div>
        </div>


         {/* OTG_CHARACTER_HUB_GALLERY_DRAFT_SLOT_V1 */}
         <ActiveCharacterDraftCard
           persistenceOwnerKey={authenticatedOwnerKey}
           onResume={(mode, sourceMode) => {
             if (sourceMode === "uploaded") {
               setView(mode === "freeform" ? "upload-freeform" : "upload-character");
               return;
             }
             setView(mode === "freeform" ? "create-freeform" : "create-character");
           }}
         />
         <div
           className="grid gap-4 md:grid-cols-2"
           data-otg="character-gallery-primary-actions"
         >
           <div className="space-y-4">
             <GalleryCard
            eyebrow="Generate"
            title="Create Character"
            description="Create a standard character from a description."
            accent="bg-sky-300"
            onClick={() => setView("create-character")}
          />
             <GalleryCard
            eyebrow="Generate"
            title="Create Freeform Character"
            description="Create a flexible character or creature using the freeform path."
            accent="bg-cyan-300"
            onClick={() => setView("create-freeform")}
          />
           </div>

           <div className="space-y-4">
             <GalleryCard
            eyebrow="Upload"
            title="Upload Character"
            description="Start a standard character from an image on the phone or device."
            accent="bg-blue-300"
            onClick={() => setView("upload-character")}
          />
             <GalleryCard
            eyebrow="Upload"
            title="Upload Freeform Character"
            description="Start a freeform character or creature from an existing image."
            accent="bg-indigo-300"
            onClick={() => setView("upload-freeform")}
          />
           </div>

           <div
             className="md:col-span-2"
             data-otg="character-gallery-saved-for-later-bottom"
           >
             <GalleryCard
             eyebrow="Library"
             title="Saved for Later"
             description="Open Character candidates you deferred and reuse them later."
             accent="bg-emerald-300"
             onClick={() => setView("saved-for-later")}
           />
           </div>
         </div>

         <SavedCharacterLibrary />
      </div>
    );
  }

  return (
    <div
      className="space-y-4"
      data-otg="character-hub-phase1"
    >
      <div className="rounded-[32px] border border-sky-300/25 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.25),transparent_38%),linear-gradient(145deg,rgba(7,28,46,0.97),rgba(2,8,16,0.99))] p-5 shadow-[0_0_55px_rgba(56,189,248,0.09)] sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.25em] text-sky-200/80">
              Character Studio
            </div>

            <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
              Characters
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">
              Create and organize characters, backgrounds, and reusable production
              assets. Character Gallery is the first section being rebuilt.
            </p>
          </div>

          {isAdmin ? (
            <button
              type="button"
              onClick={() => setView("legacy")}
              className="rounded-full border border-amber-300/25 bg-amber-500/10 px-5 py-3 text-sm font-bold text-amber-100 transition hover:bg-amber-500/15"
            >
              Legacy Characters — Admin
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <GalleryCard
          eyebrow="Phase 1"
          title="Character Gallery"
          description="Create or upload standard and freeform characters."
          accent="bg-sky-300"
          onClick={() => setView("character-gallery")}
        />

        <GalleryCard
          eyebrow="Navigation shell"
          title="Background Gallery"
          description="Background creation and management will be rebuilt in a later phase."
          accent="bg-cyan-200"
          onClick={() => setView("background-gallery")}
          status="Preview section →"
        />

        <GalleryCard
          eyebrow="Navigation shell"
          title="Asset Gallery"
          description="Reusable props and production assets will be rebuilt in a later phase."
          accent="bg-blue-300"
          onClick={() => setView("asset-gallery")}
          status="Preview section →"
        />
      </div>
    </div>
  );
}

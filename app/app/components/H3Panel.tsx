"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { H3LoraCatalogEntry } from "@/lib/h3LoraCatalogServer";
import {
  buildH3StudioLockedReferences,
  composeH3StudioFinalPrompt,
  h3StudioPromptFingerprint,
  type H3StudioLoraSelection,
  type H3StudioReferenceDescriptor,
} from "@/lib/h3Studio";
import { H3_MEDIA_ACCEPT } from "@/lib/h3MediaTypes";
import {
  H3_STYLE_PRESETS,
  resolveH3PromptBuilderVisualStyle,
  resolveH3StylePreset,
} from "@/lib/h3StylePresets";
import {
  getH3NativeDimensions,
  getH3ProductionTimeEstimate,
  H3_ORIENTATION_OPTIONS,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_QUALITY_OPTIONS,
  type H3Orientation,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import {
  DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS,
  H3_CAMERA_FEEL_OPTIONS,
  H3_SHOT_FLOW_OPTIONS,
  H3_VISUAL_STYLE_OPTIONS,
} from "@/lib/production/promptOptions";
import type { ProductionV2H3Mode } from "@/lib/production/h3Workflows";

type Mode = ProductionV2H3Mode;
type MediaKind = "image" | "video" | "audio";
type MediaInput = H3StudioReferenceDescriptor & { file: File; url: string };
type JobStatus = {
  id: string;
  status: string;
  statusMessage: string;
  mode: Mode;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: 5 | 10;
  prompt: string;
  backend: string | null;
  backendLabel: string | null;
  workflowId: string | null;
  workflowFile: string | null;
  nativeResolution: string | null;
  etaSeconds: number | null;
  etaMinSeconds: number;
  etaMaxSeconds: number;
  promptId: string | null;
  queueRemaining: number | null;
  progressPercent: number | null;
  currentNode: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  galleryStatus: "pending" | "saving" | "saved" | "failed";
  galleryFileName: string | null;
  galleryUrl: string | null;
  galleryError: string | null;
};

const MODE_OPTIONS: Array<{ id: Mode; label: string; detail: string }> = [
  { id: "h3-text-to-video", label: "Text", detail: "Create from a prompt" },
  {
    id: "h3-image-to-video",
    label: "Image",
    detail: "Animate first or first + last frames",
  },
  {
    id: "h3-reference-to-video",
    label: "Reference",
    detail: "Guide with images, video, and audio",
  },
];
const surface =
  "rounded-[8px] border border-white/10 bg-[#090b15]/90 p-4 shadow-[0_18px_45px_rgba(0,0,0,.22)]";
const field =
  "w-full rounded-[6px] border border-white/15 bg-black/45 px-3 py-2 text-sm text-white outline-none focus:border-violet-300/70";
const command =
  "min-h-10 rounded-[6px] border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:opacity-45";
const primary =
  "border-violet-300/60 bg-violet-300 text-[#090b15] hover:bg-violet-200";
const selectedChoice =
  "!border-violet-300/80 !bg-violet-300/20 text-white shadow-[0_0_0_1px_rgba(196,181,253,.12),0_0_18px_rgba(139,92,246,.18)]";
const REFERENCE_LIMIT_HELP =
  "Up to 9 images, 3 videos, and 3 standalone audio references.";
const QUALITY_LABELS: Record<H3Quality, string> = { lq: "LQ", hq: "HQ" };

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return value >= 60
    ? `${Math.floor(value / 60)}m ${value % 60}s`
    : `${value}s`;
}
function elapsedSeconds(job: JobStatus | null, now: number) {
  return job?.startedAt
    ? Math.max(
        0,
        ((job.completedAt ? Date.parse(job.completedAt) : now) -
          Date.parse(job.startedAt)) /
          1000,
      )
    : 0;
}
function choiceClass(selected: boolean) {
  return selected
    ? selectedChoice
    : "!border-white/10 !bg-[#11172a] text-white hover:!bg-white/[0.08]";
}

function MediaPreview({ item }: { item: MediaInput }) {
  if (item.kind === "image")
    return (
      <img
        src={item.url}
        alt={item.name}
        className="aspect-video w-full rounded-[6px] bg-black object-contain"
      />
    );
  if (item.kind === "video")
    return (
      <video
        src={item.url}
        controls
        preload="metadata"
        className="aspect-video w-full rounded-[6px] bg-black object-contain"
      />
    );
  return (
    <audio src={item.url} controls preload="metadata" className="w-full" />
  );
}

function GalleryPicker({
  kind,
  onPick,
  onClose,
}: {
  kind: "image" | "video";
  onPick: (file: File) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<
    Array<{ name: string; url: string; kind?: string; video?: boolean }>
  >([]);
  const [message, setMessage] = useState("Loading Gallery...");
  useEffect(() => {
    void fetch(`/api/gallery?media=${kind}&sort=newest&per=80`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.files)
            ? data.files
            : [];
        setItems(
          list.filter((item: any) =>
            kind === "video"
              ? item.video === true || item.kind === "video"
              : item.video !== true && item.kind !== "video",
          ),
        );
        setMessage("");
      })
      .catch(() => setMessage("Gallery could not be loaded."));
  }, [kind]);
  async function choose(item: { name: string; url: string }) {
    setMessage("Loading selection...");
    const response = await fetch(item.url, { credentials: "include" });
    if (!response.ok) return setMessage("Gallery media could not be read.");
    const blob = await response.blob();
    onPick(
      new File([blob], item.name || `gallery-${kind}`, { type: blob.type }),
    );
    onClose();
  }
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-3"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[8px] border border-violet-300/30 bg-[#080a13] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black">
            Gallery {kind === "image" ? "Images" : "Videos"}
          </h2>
          <button className={command} onClick={onClose}>
            Close
          </button>
        </div>
        {message ? (
          <p className="text-sm text-white/60">{message}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {items.map((item, index) => (
              <button
                key={`${item.name}-${index}`}
                className="overflow-hidden rounded-[6px] border border-white/10 bg-black text-left"
                onClick={() => void choose(item)}
              >
                {kind === "image" ? (
                  <img
                    src={item.url}
                    alt={item.name}
                    className="aspect-video w-full object-contain"
                  />
                ) : (
                  <video
                    src={item.url}
                    className="aspect-video w-full object-contain"
                    preload="metadata"
                  />
                )}
                <span className="block truncate p-2 text-xs">{item.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function H3Panel() {
  const [mode, setMode] = useState<Mode>("h3-text-to-video");
  const [quality, setQuality] = useState<H3Quality>("lq");
  const [duration, setDuration] = useState<5 | 10>(5);
  const [orientation, setOrientation] =
    useState<H3Orientation>("landscape");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [undoPrompt, setUndoPrompt] = useState("");
  const [scenePrompt, setScenePrompt] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [suggestionDraft, setSuggestionDraft] = useState("");
  const [reviewedFingerprint, setReviewedFingerprint] = useState("");
  const [promptSource, setPromptSource] = useState<"direct" | "builder">(
    "direct",
  );
  const [visualStyle, setVisualStyle] = useState<string>(
    DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.visualStyle,
  );
  const [stylePresetId, setStylePresetId] = useState("none");
  const [cameraFeel, setCameraFeel] = useState<string>(
    DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.cameraFeel,
  );
  const [shotFlow, setShotFlow] = useState<string>(
    DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.shotFlow,
  );
  const [firstImage, setFirstImage] = useState<MediaInput | null>(null);
  const [lastImage, setLastImage] = useState<MediaInput | null>(null);
  const [references, setReferences] = useState<MediaInput[]>([]);
  const [catalog, setCatalog] = useState<H3LoraCatalogEntry[]>([]);
  const [maxLoras, setMaxLoras] = useState(3);
  const [selectedLoras, setSelectedLoras] = useState<H3StudioLoraSelection[]>(
    [],
  );
  const [galleryTarget, setGalleryTarget] = useState<
    "first" | "last" | "reference-image" | "reference-video" | ""
  >("");
  const [enhancing, setEnhancing] = useState("");
  const [enhancementLevel, setEnhancementLevel] = useState<
    "short" | "medium" | "long"
  >("medium");
  const [building, setBuilding] = useState(false);
  const [micState, setMicState] = useState<
    "idle" | "listening" | "processing" | "done" | "error"
  >("idle");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRecordingRef = useRef(false);
  const objectUrlsRef = useRef(new Set<string>());
  const active = Boolean(job && !["completed", "failed"].includes(job.status));
  const estimate = useMemo(
    () =>
      getH3ProductionTimeEstimate(mode, duration, quality, job?.backend as any),
    [mode, duration, quality, job?.backend],
  );
  const descriptors = references.map(
    ({ id, kind, name, description, includeAudio }) => ({
      id,
      kind,
      name,
      description,
      includeAudio,
    }),
  );
  const selectedStylePreset = resolveH3StylePreset(stylePresetId);
  const promptBuilderVisualStyle =
    resolveH3PromptBuilderVisualStyle(stylePresetId, visualStyle);

  const promptContext = {
    mode,
    quality,
    orientation,
    durationSeconds: duration,
    originalPrompt,
    scenePrompt,
    stylePresetId,
    visualStyle: promptBuilderVisualStyle,
    cameraFeel,
    shotFlow,
    firstImageName: firstImage?.name,
    lastImageName: lastImage?.name,
    references: descriptors,
    loras: selectedLoras,
  };
  const currentFingerprint =
    `${h3StudioPromptFingerprint(promptContext)}|stylePreset:${stylePresetId}`;
  const builderPromptStale =
    promptSource === "builder"
    && (!reviewedFingerprint || reviewedFingerprint !== currentFingerprint);
  const generationPrompt =
    promptSource === "builder" ? scenePrompt : originalPrompt;
  const lockedReferences = buildH3StudioLockedReferences(promptContext);
  const exactFinalPrompt = composeH3StudioFinalPrompt(
    lockedReferences,
    generationPrompt,
  );
  const nativeDimensions = getH3NativeDimensions(quality, orientation);
  const canGenerate = Boolean(
    generationPrompt.trim()
      && !builderPromptStale
      && (mode !== "h3-image-to-video" || firstImage)
      && (mode !== "h3-reference-to-video" || references.length),
  );

  useEffect(() => {
    void fetch(`/api/h3/loras?mode=${encodeURIComponent(mode)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        const entries = Array.isArray(data.entries) ? data.entries : [];
        setCatalog(entries);
        setMaxLoras(Number(data.maxSelections) || 3);
        setSelectedLoras((current) => {
          const removed = current.filter(
            (selection) =>
              !entries.some(
                (entry: H3LoraCatalogEntry) => entry.id === selection.id,
              ),
          );
          if (removed.length)
            setMessage(
              `Removed ${removed.map((item) => item.id).join(", ")} because it is not approved or available for ${MODE_OPTIONS.find((item) => item.id === mode)?.label}.`,
            );
          return current.filter((selection) =>
            entries.some(
              (entry: H3LoraCatalogEntry) => entry.id === selection.id,
            ),
          );
        });
      })
      .catch(() =>
        setMessage("The approved H3 LoRA catalog could not be loaded."),
      );
  }, [mode]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!active || !job) return;
    const timer = setInterval(() => void refreshJob(job.id), 4000);
    return () => clearInterval(timer);
  }, [active, job?.id]);
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  function media(file: File, kind: MediaKind): MediaInput {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind,
      file,
      url,
      name: file.name,
      description: "",
      includeAudio: false,
    };
  }
  function release(item: MediaInput | null) {
    if (item) {
      URL.revokeObjectURL(item.url);
      objectUrlsRef.current.delete(item.url);
    }
  }
  function replaceSingle(
    current: MediaInput | null,
    file: File,
    setter: (item: MediaInput | null) => void,
  ) {
    release(current);
    setter(media(file, "image"));
  }
  function addReference(kind: MediaKind, file: File) {
    const limit = kind === "image" ? 9 : 3;
    if (references.filter((item) => item.kind === kind).length >= limit)
      return setMessage(`H3 supports at most ${limit} ${kind} references.`);
    setReferences((current) => [...current, media(file, kind)]);
  }
  function updateReference(id: string, patch: Partial<MediaInput>) {
    setReferences((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  function removeReference(id: string) {
    setReferences((current) => {
      release(current.find((item) => item.id === id) || null);
      return current.filter((item) => item.id !== id);
    });
  }
  function referenceMoveTarget(index: number, delta: number) {
    const kind = references[index]?.kind;
    const matching = references
      .map((item, itemIndex) => (item.kind === kind ? itemIndex : -1))
      .filter((itemIndex) => itemIndex >= 0);
    const position = matching.indexOf(index);
    return matching[position + delta] ?? -1;
  }
  function moveReference(index: number, delta: number) {
    setReferences((current) => {
      const next = [...current];
      const kind = next[index]?.kind;
      const matching = next
        .map((item, itemIndex) => (item.kind === kind ? itemIndex : -1))
        .filter((itemIndex) => itemIndex >= 0);
      const position = matching.indexOf(index);
      const target = matching[position + delta] ?? -1;
      if (target < 0) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function replaceOriginal(value: string) {
    setUndoPrompt(originalPrompt);
    setOriginalPrompt(value);
    setPromptSource("direct");
  }

  async function enhance(level: "short" | "medium" | "long") {
    setEnhancementLevel(level);
    if (!originalPrompt.trim())
      return setMessage("Enter a prompt before enhancing.");
    setEnhancing(level);
    setMessage("");
    try {
      const response = await fetch("/api/enhance-prompt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: originalPrompt,
          enhanceLevel: level,
          contextType: "video",
          mediaMode: "video",
          videoGenerationType: mode,
          durationSeconds: duration,
          workflowLabel: "MiniMax H3",
          selectedStyle: {
            label: promptBuilderVisualStyle,
            prompt: promptBuilderVisualStyle,
          },
          visualContext: descriptors
            .map((item) => `${item.kind}: ${item.description || item.name}`)
            .join("\n"),
        }),
      });
      const data = await response.json();
      const value = String(data.enhancedPrompt || data.prompt || "").trim();
      if (!response.ok || !value)
        throw new Error(data.error || "Enhance Prompt returned no text.");
      replaceOriginal(value);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Prompt enhancement failed.",
      );
    } finally {
      setEnhancing("");
    }
  }

  async function pollPrompt(url: string) {
    for (;;) {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status === "failed")
        throw new Error(data.error || "Ollama Prompt Builder failed.");
      if (data.status === "completed" && data.result?.scenePrompt)
        return String(data.result.scenePrompt);
      setMessage(data.statusMessage || "Ollama is building the H3 prompt...");
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  async function buildPrompt() {
    if (!originalPrompt.trim())
      return setMessage("Write your scene before using Prompt Builder.");
    if (mode === "h3-image-to-video" && !firstImage)
      return setMessage(
        "Choose a First Image before building the Image prompt.",
      );
    setBuilding(true);
    setMessage("Sending the scene to the shared Production Ollama engine...");
    try {
      const response = await fetch("/api/h3/prompt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...promptContext, loras: selectedLoras }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.pollUrl)
        throw new Error(data.error || "Prompt Builder could not start.");
      const value = await pollPrompt(data.pollUrl);
      setSuggestion(value);
      setSuggestionDraft(value);
      setMessage("Ollama suggestion ready. Review it before generation.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Prompt Builder failed.",
      );
    } finally {
      setBuilding(false);
    }
  }
  function acceptPrompt(value: string) {
    const next = value.trim();
    if (!next) return setMessage("The reviewed Scene Prompt cannot be empty.");
    setScenePrompt(next);
    setPromptSource("builder");
    setReviewedFingerprint(
      `${h3StudioPromptFingerprint({
        ...promptContext,
        scenePrompt: next,
      })}|stylePreset:${stylePresetId}`,
    );
    setMessage("Prompt reviewed and ready.");
  }

  function useCurrentRawPrompt() {
    if (!originalPrompt.trim()) {
      return setMessage("Enter a prompt before generating.");
    }
    setPromptSource("direct");
    setMessage("Using your current prompt directly. Prompt Builder is optional.");
  }

  async function mic() {
    if (micState === "listening") {
      recorderRef.current?.stop();
      return;
    }
    try {
      chunksRef.current = [];
      cancelRecordingRef.current = false;
      setMicState("listening");
      setMessage("Listening...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (cancelRecordingRef.current) return setMicState("idle");
        setMicState("processing");
        try {
          const body = new FormData();
          body.set(
            "audio",
            new File(chunksRef.current, `h3-${Date.now()}.webm`, {
              type: "audio/webm",
            }),
          );
          const response = await fetch("/api/ollama-ai/transcribe", {
            method: "POST",
            body,
            credentials: "include",
          });
          const data = await response.json();
          const text = String(data.text || "").trim();
          if (!response.ok || !text)
            throw new Error(
              data.detail || data.error || "No transcript returned.",
            );
          replaceOriginal(
            [originalPrompt.trim(), text].filter(Boolean).join("\n"),
          );
          setMicState("done");
          setMessage("Transcription added. You can edit it before building.");
        } catch (error) {
          setMicState("error");
          setMessage(
            error instanceof Error ? error.message : "Transcription failed.",
          );
        }
      };
      recorder.start();
    } catch (error) {
      setMicState("error");
      setMessage(
        error instanceof Error ? error.message : "Microphone access failed.",
      );
    }
  }
  function cancelMic() {
    cancelRecordingRef.current = true;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setMicState("idle");
    setMessage("Recording cancelled.");
  }
  function updateLora(id: string, strength: number) {
    const entry = catalog.find((item) => item.id === id);
    if (!entry) return;
    const value = Math.max(
      entry.minStrength,
      Math.min(entry.maxStrength, Number(strength.toFixed(2))),
    );
    setSelectedLoras((current) =>
      current.map((item) =>
        item.id === id ? { ...item, strength: value } : item,
      ),
    );
  }
  function addLora(id: string) {
    const entry = catalog.find((item) => item.id === id);
    if (!entry || selectedLoras.some((item) => item.id === id)) return;
    if (selectedLoras.length >= maxLoras)
      return setMessage(
        `You can select at most ${maxLoras} optional H3 LoRAs.`,
      );
    setSelectedLoras((current) => [
      ...current,
      { id, strength: entry.defaultStrength },
    ]);
  }

  async function refreshJob(id = job?.id) {
    if (!id) return;
    const response = await fetch(
      `/api/h3/generation?jobId=${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    const data = await response.json().catch(() => ({}));
    if (data.job) setJob(data.job);
  }
  async function retry() {
    if (!job) return;
    const response = await fetch("/api/h3/generation", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", jobId: job.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.job)
      return setMessage(data.error || "Retry failed.");
    setJob(data.job);
    setNow(Date.now());
  }
  async function generate() {
    if (builderPromptStale)
      return setMessage("The optional Builder prompt changed. Use your current raw prompt or review the Builder result again.");
    if (!generationPrompt.trim())
      return setMessage("Enter a prompt before generating.");
    if (mode === "h3-image-to-video" && !firstImage)
      return setMessage("Choose a First Image.");
    if (mode === "h3-reference-to-video" && !references.length)
      return setMessage("Add at least one reference.");
    const body = new FormData();
    body.set(
      "config",
      JSON.stringify({
        mode,
        quality,
        orientation,
        durationSeconds: duration,
        prompt: generationPrompt,
        stylePresetId,
        optionalLoras: selectedLoras,
        imageDescriptions: references
          .filter((item) => item.kind === "image")
          .map((item) => item.description),
        videoDescriptions: references
          .filter((item) => item.kind === "video")
          .map((item) => item.description),
        audioDescriptions: references
          .filter((item) => item.kind === "audio")
          .map((item) => item.description),
        videoAudioFlags: references
          .filter((item) => item.kind === "video")
          .map((item) => item.includeAudio),
      }),
    );
    if (firstImage) body.append("firstImage", firstImage.file);
    if (lastImage) body.append("lastImage", lastImage.file);
    references
      .filter((item) => item.kind === "image")
      .forEach((item) => body.append("referenceImages", item.file));
    references
      .filter((item) => item.kind === "video")
      .forEach((item) => body.append("referenceVideos", item.file));
    references
      .filter((item) => item.kind === "audio")
      .forEach((item) => body.append("referenceAudios", item.file));
    setMessage("Submitting the H3 prompt...");
    try {
      const response = await fetch("/api/h3/generation", {
        method: "POST",
        credentials: "include",
        body,
      });
      const data = await response.json();
      if (!response.ok || !data.job)
        throw new Error(data.error || "H3 generation could not be submitted.");
      setJob(data.job);
      setNow(Date.now());
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "H3 generation could not be submitted.",
      );
    }
  }
  async function retryGallerySave() {
    if (!job) return;
    const response = await fetch("/api/h3/generation/gallery", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? `Saved ${data.fileName} to Gallery.`
        : data.error || "Could not save video to Gallery.",
    );
    if (response.ok) await refreshJob(job.id);
  }
  async function useAsReference() {
    if (!job?.videoUrl) return;
    const response = await fetch(job.videoUrl);
    const blob = await response.blob();
    addReference(
      "video",
      new File([blob], `h3-result-${job.id}.mp4`, {
        type: blob.type || "video/mp4",
      }),
    );
    setMode("h3-reference-to-video");
    setPromptSource("direct");
    setMessage(
      "Result added as a video reference. Your raw prompt can generate directly; Prompt Builder remains optional.",
    );
  }

  return (
    <div
      className="mx-auto max-w-7xl space-y-4 pb-28 pt-8 md:pt-0"
      data-testid="h3-panel"
    >
      <section className="relative overflow-hidden rounded-[8px] border border-violet-300/20 bg-[linear-gradient(135deg,#100d25_0%,#09101b_55%,#071216_100%)] px-4 py-5 shadow-[0_20px_60px_rgba(76,29,149,.18)]">
        <div className="absolute inset-y-0 right-0 w-1 bg-gradient-to-b from-violet-300 via-cyan-300 to-transparent" />
        <p className="text-xs font-black uppercase text-violet-200">
          MiniMax creation suite
        </p>
        <h1 className="mt-1 text-3xl font-black text-white">H3 Studio</h1>
        <p className="mt-1 text-sm text-white/58">Create with MiniMax H3</p>
        <div
          className="mt-5 grid grid-cols-3 gap-2"
          role="tablist"
          aria-label="H3 generation mode"
        >
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              role="tab"
              aria-selected={mode === option.id}
              onClick={() => setMode(option.id)}
              className={`min-h-20 rounded-[6px] border p-2 text-left transition ${choiceClass(mode === option.id)}`}
            >
              <span className="block text-sm font-black text-white">
                {option.label}
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-white/48">
                {option.detail}
              </span>
            </button>
          ))}
        </div>
      </section>
      {message ? (
        <div className="rounded-[6px] border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
          {message}
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
        <main className="space-y-4">
          <section className={surface}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-violet-200/75">
                  01 / Prompt Workspace
                </p>
                <h2 className="mt-1 text-lg font-black">Your Scene</h2>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-[11px] font-bold ${builderPromptStale ? "bg-amber-300/15 text-amber-100" : promptSource === "builder" ? "bg-emerald-300/15 text-emerald-100" : "bg-cyan-300/15 text-cyan-100"}`}
              >
                {builderPromptStale
                  ? "Optional Builder prompt changed"
                  : promptSource === "builder"
                    ? "Builder prompt selected"
                    : originalPrompt.trim()
                      ? "Direct prompt ready"
                      : "Prompt required"}
              </span>
            </div>
            <textarea
              id="h3-prompt"
              rows={6}
              className={`${field} mt-3 resize-y text-base leading-6`}
              value={originalPrompt}
              onChange={(event) => replaceOriginal(event.target.value)}
              placeholder="Describe the scene, action, camera, dialogue, and sound."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={command} onClick={() => replaceOriginal("")}>
                Clear
              </button>
              <button
                className={command}
                disabled={!undoPrompt}
                onClick={() => {
                  const value = originalPrompt;
                  setOriginalPrompt(undoPrompt);
                  setUndoPrompt(value);
                  setScenePrompt("");
                }}
              >
                Undo
              </button>
            </div>
            <div className="mt-2" role="group" aria-label="Enhancement level">
              <p className="mb-2 text-xs font-bold text-white/50">
                Enhancement level
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(["short", "medium", "long"] as const).map((level) => (
                  <button
                    key={level}
                    aria-pressed={enhancementLevel === level}
                    className={`${command} px-2 ${choiceClass(enhancementLevel === level)}`}
                    disabled={Boolean(enhancing)}
                    onClick={() => void enhance(level)}
                  >
                    {enhancing === level
                      ? "Enhancing..."
                      : `Enhance ${level[0].toUpperCase() + level.slice(1)}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={`${command} ${primary}`}
                disabled={building}
                onClick={() => void buildPrompt()}
              >
                {building
                  ? "Building with Ollama..."
                  : "AI Prompt Builder · Optional"}
              </button>
              <button
                className={command}
                disabled={micState === "processing"}
                onClick={() => void mic()}
              >
                {micState === "listening"
                  ? "Stop Mic"
                  : micState === "processing"
                    ? "Processing..."
                    : "Mic"}
              </button>
              {micState === "listening" ? (
                <button className={command} onClick={cancelMic}>
                  Cancel
                </button>
              ) : null}
              {micState === "error" ? (
                <button className={command} onClick={() => void mic()}>
                  Retry Mic
                </button>
              ) : null}
            </div>
          </section>
          <details className={surface}>
            <summary className="cursor-pointer text-sm font-black">
              Choose the Look
            </summary>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="text-xs text-white/55 md:col-span-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-bold text-white/85">
                      Visual Style Preset
                    </span>
                    <p className="mt-0.5 text-[11px] text-white/40">
                      Choose a visual identity for the entire H3 video.
                    </p>
                  </div>

                  <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/45">
                    {H3_STYLE_PRESETS.length - 1} creative styles
                  </span>
                </div>

                <div
                  className={`mb-3 rounded-xl border px-4 py-3 transition-all ${
                    stylePresetId === "none"
                      ? "border-white/10 bg-black/25"
                      : "border-violet-300/40 bg-gradient-to-r from-violet-500/15 via-fuchsia-500/10 to-cyan-400/10 shadow-[0_0_24px_rgba(139,92,246,.12)]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-200/60">
                        Current preset
                      </p>
                      <p className="mt-1 text-base font-black text-white">
                        {selectedStylePreset?.label || "Default / None"}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold text-white/50">
                        {selectedStylePreset?.subtitle ||
                          "H3 default behavior — no master style prompt added"}
                      </p>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
                        stylePresetId === "none"
                          ? "border-white/15 bg-white/[0.05] text-white/55"
                          : "border-violet-300/45 bg-violet-300/15 text-violet-100"
                      }`}
                    >
                      <span aria-hidden="true">
                        {stylePresetId === "none" ? "○" : "✓"}
                      </span>
                      {stylePresetId === "none" ? "Default" : "Selected"}
                    </span>
                  </div>

                  {selectedStylePreset?.description ? (
                    <p className="mt-2 max-w-4xl text-[11px] leading-relaxed text-white/45">
                      {selectedStylePreset.description}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {H3_STYLE_PRESETS.map((preset) => {
                    const selected = preset.id === stylePresetId;

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setStylePresetId(preset.id)}
                        className={`group relative min-h-[132px] overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 ${
                          selected
                            ? "z-10 -translate-y-0.5 border-violet-300/75 bg-gradient-to-br from-violet-500/25 via-violet-400/10 to-cyan-400/10 shadow-[0_0_0_1px_rgba(196,181,253,.16),0_10px_30px_rgba(124,58,237,.22)] ring-1 ring-violet-300/45"
                            : "border-white/10 bg-[#11172a]/90 hover:-translate-y-0.5 hover:border-violet-300/30 hover:bg-white/[0.08] hover:shadow-[0_8px_22px_rgba(0,0,0,.22)]"
                        }`}
                      >
                        {selected ? (
                          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-violet-200/40 bg-violet-300/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-50 shadow-sm">
                            <span aria-hidden="true">✓</span>
                            Selected
                          </span>
                        ) : null}

                        <div
                          className={`text-sm font-black text-white ${
                            selected ? "pr-20" : ""
                          }`}
                        >
                          {preset.label}
                        </div>

                        <div
                          className={`mt-1 text-[10px] font-bold uppercase tracking-wide ${
                            selected
                              ? "text-violet-100/75"
                              : "text-white/45 group-hover:text-white/55"
                          }`}
                        >
                          {preset.subtitle}
                        </div>

                        <div
                          className={`mt-2 line-clamp-2 text-[11px] leading-relaxed ${
                            selected
                              ? "text-white/65"
                              : "text-white/38 group-hover:text-white/50"
                          }`}
                        >
                          {preset.description}
                        </div>

                        {selected ? (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-violet-200/70 to-transparent"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="text-xs text-white/55">
                Prompt Builder Visual Style
                <select
                  className={`${field} mt-1 ${
                    stylePresetId !== "none" ? "opacity-60" : ""
                  }`}
                  value={promptBuilderVisualStyle}
                  disabled={stylePresetId !== "none"}
                  onChange={(event) => setVisualStyle(event.target.value)}
                >
                  {H3_VISUAL_STYLE_OPTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-white/55">
                Camera Feel
                <select
                  className={`${field} mt-1`}
                  value={cameraFeel}
                  onChange={(event) => setCameraFeel(event.target.value)}
                >
                  {H3_CAMERA_FEEL_OPTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-white/55">
                Shot Flow
                <select
                  className={`${field} mt-1`}
                  value={shotFlow}
                  onChange={(event) => setShotFlow(event.target.value)}
                >
                  {H3_SHOT_FLOW_OPTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          {suggestion ? (
            <section className={surface}>
              <p className="text-xs font-black uppercase text-violet-200/75">
                Ollama Review
              </p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-black">Your Original</h3>
                  <div className="mt-2 min-h-32 whitespace-pre-wrap rounded-[6px] border border-white/10 bg-black/35 p-3 text-sm text-white/70">
                    {originalPrompt}
                  </div>
                  <button
                    className={`${command} mt-2`}
                    onClick={useCurrentRawPrompt}
                  >
                    Keep Original
                  </button>
                </div>
                <div>
                  <h3 className="text-sm font-black">Ollama Suggestion</h3>
                  <textarea
                    rows={8}
                    className={`${field} mt-2 resize-y`}
                    value={suggestionDraft}
                    onChange={(event) => setSuggestionDraft(event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className={`${command} ${primary}`}
                      onClick={() => acceptPrompt(suggestion)}
                    >
                      Use Suggested Prompt
                    </button>
                    <button
                      className={command}
                      onClick={() => acceptPrompt(suggestionDraft)}
                    >
                      Edit Suggested Prompt
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
          {mode === "h3-image-to-video" ? (
            <section className={surface}>
              <p className="text-xs font-black uppercase text-violet-200/75">
                02 / Image Conditioning
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(
                  [
                    ["First Image", true, firstImage, setFirstImage, "first"],
                    ["Last Image", false, lastImage, setLastImage, "last"],
                  ] as const
                ).map(([label, required, item, setter, target]) => (
                  <article
                    key={label}
                    className="rounded-[6px] border border-white/10 bg-black/30 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-black">{label}</h3>
                        <p className="text-xs text-white/45">
                          {required ? "Required" : "Optional when supported"}
                        </p>
                      </div>
                      {item ? (
                        <button
                          className={command}
                          onClick={() => {
                            release(item);
                            setter(null);
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {item ? (
                      <div className="mt-3">
                        <MediaPreview item={item} />
                      </div>
                    ) : (
                      <div className="mt-3 flex aspect-video items-center justify-center rounded-[6px] border border-dashed border-white/15 text-sm text-white/35">
                        No image selected
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <label className={`${command} cursor-pointer`}>
                        Upload
                        <input
                          hidden
                          type="file"
                          accept={H3_MEDIA_ACCEPT.image}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) replaceSingle(item, file, setter);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <button
                        className={command}
                        onClick={() => setGalleryTarget(target)}
                      >
                        Gallery
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {mode === "h3-reference-to-video" ? (
            <section className={surface}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-violet-200/75">
                    02 / Reference Deck
                  </p>
                  <h2 className="mt-1 text-lg font-black">
                    Ordered References
                  </h2>
                  <p className="text-xs text-white/45">
                    {REFERENCE_LIMIT_HELP}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["image", "video", "audio"] as const).map((kind) => (
                    <label key={kind} className={`${command} cursor-pointer`}>
                      + {kind[0].toUpperCase() + kind.slice(1)}
                      <input
                        hidden
                        type="file"
                        accept={H3_MEDIA_ACCEPT[kind]}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) addReference(kind, file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ))}
                  <button
                    className={command}
                    onClick={() => setGalleryTarget("reference-image")}
                  >
                    Gallery Image
                  </button>
                  <button
                    className={command}
                    onClick={() => setGalleryTarget("reference-video")}
                  >
                    Gallery Video
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {references.map((item, index) => (
                  <article
                    key={item.id}
                    className="rounded-[6px] border border-white/10 bg-black/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase text-cyan-200">
                          {item.kind} reference {index + 1}
                        </p>
                        <p className="truncate text-xs text-white/45">
                          {item.name}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className={command}
                          disabled={referenceMoveTarget(index, -1) < 0}
                          onClick={() => moveReference(index, -1)}
                        >
                          Up
                        </button>
                        <button
                          className={command}
                          disabled={referenceMoveTarget(index, 1) < 0}
                          onClick={() => moveReference(index, 1)}
                        >
                          Down
                        </button>
                        <button
                          className={command}
                          onClick={() => removeReference(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <MediaPreview item={item} />
                    </div>
                    <input
                      className={`${field} mt-3`}
                      value={item.description}
                      onChange={(event) =>
                        updateReference(item.id, {
                          description: event.target.value,
                        })
                      }
                      placeholder="Identity, role, motion, or sound use"
                    />
                    {item.kind === "video" ? (
                      <label className="mt-3 flex items-center gap-2 text-sm text-white/70">
                        <input
                          type="checkbox"
                          checked={item.includeAudio === true}
                          onChange={(event) =>
                            updateReference(item.id, {
                              includeAudio: event.target.checked,
                            })
                          }
                        />
                        Use Audio From Video
                      </label>
                    ) : null}
                  </article>
                ))}
              </div>
              {!references.length ? (
                <div className="mt-4 rounded-[6px] border border-dashed border-white/15 py-8 text-center text-sm text-white/35">
                  Add references to begin
                </div>
              ) : null}
            </section>
          ) : null}
          {originalPrompt.trim() || scenePrompt.trim() || lockedReferences ? (
            <details className={surface}>
              <summary className="cursor-pointer text-sm font-black">
                View Exact Final Prompt
              </summary>
              <label className="mt-3 block text-xs font-black uppercase text-white/45">
                Locked References
                <textarea
                  readOnly
                  rows={Math.max(2, lockedReferences.split("\n").length)}
                  className={`${field} mt-1 font-mono text-xs`}
                  value={
                    lockedReferences ||
                    "No locked reference block for Text mode."
                  }
                />
              </label>
              {scenePrompt ? (
                <label className="mt-3 block text-xs font-black uppercase text-white/45">
                  Editable Builder Scene Prompt
                  <textarea
                    rows={10}
                    className={`${field} mt-1 resize-y font-mono text-xs leading-5`}
                    value={scenePrompt}
                    onChange={(event) => setScenePrompt(event.target.value)}
                  />
                </label>
              ) : null}
              <label className="mt-3 block text-xs font-black uppercase text-white/45">
                Exact Final Prompt
                <textarea
                  readOnly
                  rows={10}
                  className={`${field} mt-1 resize-y font-mono text-xs leading-5`}
                  value={exactFinalPrompt}
                />
              </label>
              {builderPromptStale ? (
                <div className="mt-3 rounded-[6px] border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
                  The optional Builder prompt changed. You can review it again or use your current raw prompt directly.
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {scenePrompt ? (
                  <button
                    className={command}
                    onClick={() => acceptPrompt(scenePrompt)}
                  >
                    Review Current Builder Prompt
                  </button>
                ) : null}
                {promptSource === "builder" ? (
                  <button className={command} onClick={useCurrentRawPrompt}>
                    Use Current Raw Prompt
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
        </main>
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className={surface}>
            <p className="text-xs font-black uppercase text-violet-200/75">
              03 / Output
            </p>
            <p className="mb-2 mt-3 text-xs font-bold text-white/50">Quality</p>
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label="H3 quality"
            >
              {H3_QUALITY_OPTIONS.map((value) => (
                <button
                  key={value}
                  aria-pressed={quality === value}
                  className={`${command} text-left ${choiceClass(quality === value)}`}
                  onClick={() => setQuality(value)}
                >
                  <span className="block font-black">
                    {QUALITY_LABELS[value]} · {getH3NativeDimensions(value, orientation).width}x{getH3NativeDimensions(value, orientation).height}
                  </span>
                </button>
              ))}
            </div>
            <p className="mb-2 mt-4 text-xs font-bold text-white/50">
              Duration
            </p>
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label="H3 duration"
            >
              {H3_PRODUCTION_DURATION_OPTIONS.map((value) => (
                <button
                  key={value}
                  aria-pressed={duration === value}
                  className={`${command} ${choiceClass(duration === value)}`}
                  onClick={() => setDuration(value)}
                >
                  {value} sec
                </button>
              ))}
            </div>
            <p className="mb-2 mt-4 text-xs font-bold text-white/50">
              Orientation
            </p>
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label="H3 orientation"
            >
              {H3_ORIENTATION_OPTIONS.map((value) => (
                <button
                  key={value}
                  aria-pressed={orientation === value}
                  className={`${command} ${choiceClass(orientation === value)}`}
                  onClick={() => setOrientation(value)}
                >
                  {value === "landscape" ? "Landscape" : "Portrait"}
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-[6px] border border-white/10 bg-black/30 p-3 text-sm text-white/60">
              <span className="font-semibold text-white/80">Canvas:</span>{" "}
              {nativeDimensions.width}x{nativeDimensions.height}
              <br />
              <span className="font-semibold text-white/80">Estimate:</span> ~
              {formatDuration(estimate.minSeconds)} to{" "}
              {formatDuration(estimate.maxSeconds)}
              <br />
              <span className="text-xs">
                Actual time varies by GPU and queue. Portrait inherits the matching landscape estimate and is not independently benchmarked.
              </span>
            </div>
          </section>
          <details className={surface}>
            <summary className="cursor-pointer text-sm font-black">
              LoRAs and Creative Controls
            </summary>
            <div className="mt-4 rounded-[6px] border border-cyan-300/25 bg-cyan-300/10 p-3">
              <p className="text-sm font-black">MiniMax H3 Turbo 8-step</p>
              <p className="text-xs text-white/60">
                Required | strength 1.0 | locked
              </p>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase text-white/50">
                  Optional H3 LoRAs
                </p>
                <span className="text-xs text-white/40">
                  {selectedLoras.length}/{maxLoras}
                </span>
              </div>
              <select
                className={`${field} mt-2`}
                value=""
                onChange={(event) => addLora(event.target.value)}
              >
                <option value="">+ Add approved LoRA</option>
                {catalog
                  .filter(
                    (entry) =>
                      !selectedLoras.some((item) => item.id === entry.id),
                  )
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.displayName}
                    </option>
                  ))}
              </select>
              {selectedLoras.map((selection) => {
                const entry = catalog.find((item) => item.id === selection.id);
                if (!entry) return null;
                return (
                  <article
                    key={selection.id}
                    className="mt-3 rounded-[6px] border border-white/10 bg-black/30 p-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-black">{entry.displayName}</p>
                        <p className="text-xs text-white/45">
                          {entry.description}
                        </p>
                      </div>
                      <button
                        className={command}
                        onClick={() =>
                          setSelectedLoras((current) =>
                            current.filter((item) => item.id !== selection.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-[40px_1fr_40px_58px] items-center gap-2">
                      <button
                        className={command}
                        aria-label={`Decrease ${entry.displayName}`}
                        onClick={() =>
                          updateLora(selection.id, selection.strength - 0.05)
                        }
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={entry.minStrength}
                        max={entry.maxStrength}
                        step="0.05"
                        value={selection.strength}
                        onChange={(event) =>
                          updateLora(selection.id, Number(event.target.value))
                        }
                      />
                      <button
                        className={command}
                        aria-label={`Increase ${entry.displayName}`}
                        onClick={() =>
                          updateLora(selection.id, selection.strength + 0.05)
                        }
                      >
                        +
                      </button>
                      <input
                        className={`${field} px-2 text-center`}
                        type="number"
                        min={entry.minStrength}
                        max={entry.maxStrength}
                        step="0.05"
                        value={selection.strength}
                        onChange={(event) =>
                          updateLora(selection.id, Number(event.target.value))
                        }
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-white/45">
                      Recommended {entry.recommendedMin}-{entry.recommendedMax}.
                      Available: {entry.discoveredOn.join(", ")}.
                    </p>
                    {entry.triggerWords.length ? (
                      <button
                        className={`${command} mt-2`}
                        onClick={() =>
                          replaceOriginal(
                            [
                              originalPrompt,
                              ...entry.triggerWords.filter(
                                (word) =>
                                  !originalPrompt
                                    .toLowerCase()
                                    .includes(word.toLowerCase()),
                              ),
                            ]
                              .filter(Boolean)
                              .join("\n"),
                          )
                        }
                      >
                        Add recommended trigger words
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </details>
          <button
            className={`${command} ${primary} min-h-14 w-full text-base`}
            disabled={active || !canGenerate}
            onClick={() => void generate()}
          >
            {active
              ? "Generation Running"
              : builderPromptStale
                ? "Use Raw Prompt or Review Builder"
                : !canGenerate
                  ? "Add Prompt and Required Inputs"
                : "Generate Video"}
          </button>
        </aside>
      </div>
      {job ? (
        <section className={surface}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-violet-200/75">
                Live H3 Job
              </p>
              <h2 className="mt-1 text-lg font-black">{job.statusMessage}</h2>
              <p className="mt-1 text-sm text-white/55">
                Elapsed {formatDuration(elapsedSeconds(job, now))} |{" "}
                {job.backendLabel || "GPU assignment pending"}
              </p>
            </div>
            <div className="text-right text-xs text-white/45">
              Job {job.id}
              <br />
              Prompt {job.promptId || "pending"}
              <br />
              {job.nativeResolution || "Resolution pending"}
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-violet-300 transition-all"
              style={{ width: `${job.progressPercent ?? 0}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-white/45">
            <span>
              {job.progressPercent ?? 0}% estimated execution progress
            </span>
            <span>
              Queue remaining: {job.queueRemaining ?? "not reported"} | Node:{" "}
              {job.currentNode || "not reported by ComfyUI"}
            </span>
          </div>
          {job.error ? (
            <div className="mt-4 rounded-[6px] border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
              {job.error}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={command} onClick={() => void refreshJob()}>
              Refresh
            </button>
            <button
              className={command}
              disabled={active}
              onClick={() => void retry()}
            >
              Retry
            </button>
          </div>
          {job.videoUrl ? (
            <div className="mt-4">
              <video
                src={job.videoUrl}
                poster={job.thumbnailUrl || undefined}
                controls
                playsInline
                preload="metadata"
                className="max-h-[70vh] w-full rounded-[6px] bg-black"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`${job.videoUrl}${job.videoUrl.includes("?") ? "&" : "?"}download=1`}
                  download={job.galleryFileName || "MiniMax-H3-video.mp4"}
                  className={command}
                >
                  Download
                </a>
                {job.galleryStatus === "saved" ? (
                  <a className={command} href={job.galleryUrl || "#"}>
                    Saved to Gallery
                  </a>
                ) : job.galleryStatus === "failed" ? (
                  <button className={command} onClick={() => void retryGallerySave()}>
                    Retry Gallery Save
                  </button>
                ) : (
                  <span className="rounded-[6px] border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-bold text-cyan-100">
                    Saving to Gallery...
                  </span>
                )}
                <button
                  className={command}
                  onClick={() => void useAsReference()}
                >
                  Use as Reference
                </button>
              </div>
              {job.galleryError ? (
                <p className="mt-2 text-sm text-amber-100">Gallery save: {job.galleryError}</p>
              ) : null}
              <details className="mt-4 rounded-[6px] border border-white/10 p-3">
                <summary className="cursor-pointer text-sm font-black">
                  Diagnostics
                </summary>
                <dl className="mt-3 grid gap-2 text-sm text-white/60 md:grid-cols-2">
                  <div>
                    <dt className="font-bold text-white/80">Workflow</dt>
                    <dd className="break-all">{job.workflowId}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-white/80">File</dt>
                    <dd className="break-all">{job.workflowFile}</dd>
                  </div>
                  <div className="md:col-span-2">
                    <dt className="font-bold text-white/80">
                      Exact Prompt Used
                    </dt>
                    <dd className="whitespace-pre-wrap">{job.prompt}</dd>
                  </div>
                </dl>
              </details>
            </div>
          ) : null}
        </section>
      ) : null}
      {galleryTarget ? (
        <GalleryPicker
          kind={galleryTarget.includes("video") ? "video" : "image"}
          onClose={() => setGalleryTarget("")}
          onPick={(file) => {
            if (galleryTarget === "first")
              replaceSingle(firstImage, file, setFirstImage);
            else if (galleryTarget === "last")
              replaceSingle(lastImage, file, setLastImage);
            else
              addReference(
                galleryTarget === "reference-video" ? "video" : "image",
                file,
              );
          }}
        />
      ) : null}
    </div>
  );
}

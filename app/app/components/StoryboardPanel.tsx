"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { withDeviceHeader } from "../studio/deviceHeader";

type SceneDraft = {
  id: string;
  title: string;
  prompt: string;
  durationSec: number;
  characterIds?: string[];
  characterNames: string[];
  hardCut: boolean;
};

type SavedCharacterRecord = {
  id: string;
  name: string;
  imagePath: string;
  previewImagePath?: string;
  transparentImagePath?: string;
  description: string;
  voiceStyleDefinition?: string;
  introLine?: string;
};

type SavedScene = {
  card: number;
  imagePath?: string;
  imageUrl?: string;
  videoPath: string;
  videoUrl: string;
  prompt?: string;
  characterNames?: string[];
};

type ProductionSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentCard: number;
  totalCards: number;
  characterCount: number;
  activeStep: string;
  sceneCount: number;
  stitchedVideoPath?: string;
  completedAt?: string;
  status?: "active" | "completed";
};

type PersistedProductionRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  state: {
    productionId: string;
    name: string;
    backgroundImagePath?: string;
    backgroundPrompt?: string;
    positivePrompt?: string;
    negativePrompt?: string;
    timelineGlobalPrompt?: string;
    timelineScenes?: SceneDraft[];
    timelineFps?: number;
    timelineUseVideoReasoning?: boolean;
    timelineUseCrispEnhance?: boolean;
    savedCardVideos?: SavedScene[];
    stitchedVideoPath?: string;
    completedAt?: string;
    status?: "active" | "completed";
    characters?: Array<{ id: string; name: string; descriptor: string; sourceCharacterId?: string; serverPath?: string }>;
  };
};

type PanelMode = "home" | "builder" | "load" | "completed" | "delete";

const PROMPT_RELAY_WORKFLOW_FILE = "internal/production/production_ltx23_prompt_relay_timeline.json";
const DEFAULT_GLOBAL_PROMPT = "cinematic LTX 2.3 production, consistent characters, clear hard cuts between scenes";
const DEFAULT_NEGATIVE_PROMPT = "low quality, blurry, distorted faces, extra limbs, broken hands, unreadable text, flicker";

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileUrlFor(pathValue?: string) {
  const p = String(pathValue || "").trim();
  return p ? `/api/file?path=${encodeURIComponent(p)}` : "";
}

function fallbackProductionId(name: string) {
  const base =
    String(name || "production")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "production";
  return `${base}_${Date.now()}`;
}

function createScene(index = 0, names: string[] = []): SceneDraft {
  return {
    id: makeId("scene"),
    title: `Scene ${index + 1}`,
    prompt: "",
    durationSec: 5,
    characterIds: [],
    characterNames: names,
    hardCut: index > 0,
  };
}

function parseNames(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeScene(scene: Partial<SceneDraft>, index: number, names: string[]): SceneDraft {
  const characterIds = Array.isArray(scene.characterIds) ? scene.characterIds.map((id) => String(id || "").trim()).filter(Boolean).slice(0, 4) : [];
  return {
    id: scene.id || makeId("scene"),
    title: scene.title || `Scene ${index + 1}`,
    prompt: String(scene.prompt || ""),
    durationSec: Math.max(1, Math.min(30, Number(scene.durationSec || 5) || 5)),
    characterIds,
    characterNames: Array.isArray(scene.characterNames) && scene.characterNames.length ? scene.characterNames.slice(0, 4) : names.slice(0, 4),
    hardCut: index > 0 ? scene.hardCut !== false : false,
  };
}

function characterPreviewPath(character: SavedCharacterRecord) {
  return character.previewImagePath || character.transparentImagePath || character.imagePath || "";
}

async function uploadImage(file: File): Promise<{ serverPath: string; previewUrl: string }> {
  const form = new FormData();
  form.append("image", file, file.name);
  const res = await fetch("/api/storyboard/upload", { method: "POST", headers: withDeviceHeader(), body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Upload failed");
  const serverPath = String(data?.serverPath || "");
  if (!serverPath) throw new Error("Upload did not return a server path");
  return { serverPath, previewUrl: fileUrlFor(serverPath) };
}

function pickVideoPath(payload: any) {
  return String(payload?.videoPath || payload?.serverPath || payload?.generatedVideoPath || "");
}

function pickVideoUrl(payload: any, pathValue: string) {
  return String(payload?.videoUrl || payload?.serverUrl || payload?.generatedVideoUrl || (pathValue ? fileUrlFor(pathValue) : ""));
}

function withCacheBust(url: string) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  const joiner = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${joiner}otgTs=${Date.now()}`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/42">{label}</div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
    </div>
  );
}

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-dashed border-white/14 bg-black/30 px-4 py-8 text-center text-sm text-white/48">
      {children}
    </div>
  );
}

export default function StoryboardPanel() {
  const [mode, setMode] = useState<PanelMode>("home");
  const [projectName, setProjectName] = useState("");
  const [productionId, setProductionId] = useState("");
  const [startingImagePath, setStartingImagePath] = useState("");
  const [startingImageUrl, setStartingImageUrl] = useState("");
  const [characterText, setCharacterText] = useState("Character 1");
  const [globalPrompt, setGlobalPrompt] = useState(DEFAULT_GLOBAL_PROMPT);
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  const [fps, setFps] = useState(24);
  const [useVideoReasoning, setUseVideoReasoning] = useState(false);
  const [useCrispEnhance, setUseCrispEnhance] = useState(false);
  const [scenes, setScenes] = useState<SceneDraft[]>(() => [createScene(0, ["Character 1"])]);
  const [savedCharacters, setSavedCharacters] = useState<SavedCharacterRecord[]>([]);
  const [savedVideos, setSavedVideos] = useState<SavedScene[]>([]);
  const [activeVideoPath, setActiveVideoPath] = useState("");
  const [activeVideoUrl, setActiveVideoUrl] = useState("");
  const [stitchedVideoPath, setStitchedVideoPath] = useState("");
  const [stitchedVideoUrl, setStitchedVideoUrl] = useState("");
  const [summaries, setSummaries] = useState<ProductionSummary[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const characterNames = useMemo(() => parseNames(characterText), [characterText]);
  const characterById = useMemo(() => new Map(savedCharacters.map((character) => [character.id, character])), [savedCharacters]);
  const productionCharacters = useMemo(() => {
    const selected = new Map<string, SavedCharacterRecord>();
    scenes.forEach((scene) => {
      (scene.characterIds || []).forEach((id) => {
        const character = characterById.get(id);
        if (character) selected.set(character.id, character);
      });
    });
    return Array.from(selected.values());
  }, [characterById, scenes]);
  const validScenes = useMemo(
    () =>
      scenes
        .map((scene, index) => {
          const normalized = normalizeScene(scene, index, characterNames);
          const selectedNames = (normalized.characterIds || [])
            .map((id) => characterById.get(id)?.name)
            .filter((name): name is string => !!name);
          return selectedNames.length ? { ...normalized, characterNames: selectedNames } : normalized;
        })
        .filter((scene) => scene.prompt.trim()),
    [characterById, scenes, characterNames]
  );
  const totalSeconds = validScenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  const totalFrames = validScenes.reduce((sum, scene) => sum + Math.round(scene.durationSec * fps), 0);
  const comfyTimelinePreview = useMemo(() => {
    const sceneBlocks = validScenes.map((scene, index) => {
      const characters = scene.characterNames.length ? scene.characterNames.join(", ") : "none selected";
      const characterDetails = (scene.characterIds || [])
        .map((id) => characterById.get(id))
        .filter((character): character is SavedCharacterRecord => !!character)
        .map((character) => `${character.name}: ${character.description || "no saved description"}`)
        .join("\n");
      const transition = scene.hardCut && index > 0 ? "hard cut from previous scene" : "opening scene";
      return [
        `SCENE ${index + 1}: ${scene.title || `Scene ${index + 1}`}`,
        `SECONDS: ${scene.durationSec}`,
        `FRAMES: ${Math.round(scene.durationSec * fps)}`,
        `CHARACTERS: ${characters}`,
        characterDetails ? `CHARACTER REFERENCES:\n${characterDetails}` : "",
        `TRANSITION: ${transition}`,
        `PROMPT: ${scene.prompt.trim() || "(empty)"}`,
      ].filter(Boolean).join("\n");
    });

    return [
      `GLOBAL STYLE: ${globalPrompt.trim() || "(empty)"}`,
      `NEGATIVE PROMPT: ${negativePrompt.trim() || "(empty)"}`,
      `FPS: ${fps}`,
      `TOTAL: ${totalSeconds}s / ${totalFrames} frames`,
      "",
      ...sceneBlocks,
    ].join("\n\n");
  }, [characterById, fps, globalPrompt, negativePrompt, totalFrames, totalSeconds, validScenes]);
  const activeSummaries = summaries.filter((item) => item.status !== "completed" && !item.completedAt);
  const completedSummaries = summaries.filter((item) => item.status === "completed" || item.completedAt);

  useEffect(() => {
    void refreshProductions();
    void refreshCharacters();
  }, []);

  async function refreshProductions() {
    setBusy("list");
    setError("");
    try {
      const res = await fetch("/api/production", { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load productions");
      setSummaries(Array.isArray(data?.items) ? data.items : []);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy("");
    }
  }

  async function refreshCharacters() {
    try {
      const res = await fetch("/api/characters", { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load characters");
      setSavedCharacters(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setSavedCharacters([]);
    }
  }

  function resetBuilder(name = "") {
    const names = ["Character 1"];
    setProjectName(name);
    setProductionId(name ? fallbackProductionId(name) : "");
    setStartingImagePath("");
    setStartingImageUrl("");
    setCharacterText(names.join(", "));
    setGlobalPrompt(DEFAULT_GLOBAL_PROMPT);
    setNegativePrompt(DEFAULT_NEGATIVE_PROMPT);
    setFps(24);
    setUseVideoReasoning(false);
    setUseCrispEnhance(false);
    setScenes([createScene(0, names)]);
    setSavedVideos([]);
    setActiveVideoPath("");
    setActiveVideoUrl("");
    setStitchedVideoPath("");
    setStitchedVideoUrl("");
    setNotice("");
    setError("");
  }

  function startNewProduction() {
    resetBuilder(projectName || "Untitled Production");
    setMode("builder");
  }

  function hydrate(record: PersistedProductionRecord) {
    const state = record.state || ({} as PersistedProductionRecord["state"]);
    const names = Array.isArray(state.characters) && state.characters.length ? state.characters.map((item) => item.name).filter(Boolean).slice(0, 4) : ["Character 1"];
    setProductionId(record.id || state.productionId || fallbackProductionId(record.name));
    setProjectName(record.name || state.name || "Untitled Production");
    setStartingImagePath(String(state.backgroundImagePath || ""));
    setStartingImageUrl(state.backgroundImagePath ? fileUrlFor(state.backgroundImagePath) : "");
    setCharacterText(names.join(", "));
    setGlobalPrompt(String(state.timelineGlobalPrompt || DEFAULT_GLOBAL_PROMPT));
    setNegativePrompt(String(state.negativePrompt || DEFAULT_NEGATIVE_PROMPT));
    setFps(Math.max(1, Math.min(60, Number(state.timelineFps || 24) || 24)));
    setUseVideoReasoning(!!state.timelineUseVideoReasoning);
    setUseCrispEnhance(!!state.timelineUseCrispEnhance);
    setScenes(
      Array.isArray(state.timelineScenes) && state.timelineScenes.length
        ? state.timelineScenes.map((scene, index) => normalizeScene(scene, index, names))
        : [createScene(0, names)]
    );
    const videos = Array.isArray(state.savedCardVideos)
      ? state.savedCardVideos
          .filter((item) => item.videoPath)
          .map((item) => ({ ...item, videoUrl: item.videoUrl || fileUrlFor(item.videoPath), imageUrl: item.imageUrl || fileUrlFor(item.imagePath) }))
      : [];
    setSavedVideos(videos);
    setActiveVideoPath(videos[0]?.videoPath || "");
    setActiveVideoUrl(videos[0]?.videoUrl || "");
    setStitchedVideoPath(String(state.stitchedVideoPath || ""));
    setStitchedVideoUrl(state.stitchedVideoPath ? fileUrlFor(state.stitchedVideoPath) : "");
    setNotice("");
    setError("");
    setMode("builder");
  }

  async function loadProduction(id: string) {
    setBusy(`load-${id}`);
    setError("");
    try {
      const res = await fetch(`/api/production?mode=load&productionId=${encodeURIComponent(id)}`, { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load production");
      hydrate(data.production as PersistedProductionRecord);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy("");
    }
  }

  function buildState(status: "active" | "completed" = "active") {
    const id = productionId || fallbackProductionId(projectName || "production");
    return {
      productionId: id,
      name: projectName.trim() || "Untitled Production",
      activeStep: "video",
      currentCard: 1,
      totalCards: 5,
      characterCount: Math.max(1, Math.min(4, productionCharacters.length || characterNames.length)) as 1 | 2 | 3 | 4,
      backgroundPrompt: globalPrompt,
      backgroundPreset: "realistic",
      backgroundImagePath: startingImagePath || undefined,
      backgroundImageMode: startingImagePath ? "upload" : null,
      defaultLens: "35mm",
      defaultMood: "cinematic continuity",
      defaultStyle: "realistic cinematic style",
      defaultIdentity: "Preserve the named characters from the starting image and prompt descriptions.",
      positivePrompt: validScenes.map((scene) => scene.prompt).join("\n\n"),
      negativePrompt,
      timelineGlobalPrompt: globalPrompt,
      timelineScenes: scenes.map((scene, index) => {
        const normalized = normalizeScene(scene, index, characterNames);
        const selectedNames = (normalized.characterIds || [])
          .map((id) => characterById.get(id)?.name)
          .filter((name): name is string => !!name);
        return selectedNames.length ? { ...normalized, characterNames: selectedNames } : normalized;
      }),
      timelineFps: fps,
      timelineUseVideoReasoning: useVideoReasoning,
      timelineUseCrispEnhance: useCrispEnhance,
      usePreviousLength: true,
      usePreviousIdentityLock: true,
      usePreviousStyleLock: true,
      characters: productionCharacters.length
        ? productionCharacters.map((character, index) => ({
            id: `c${index + 1}`,
            name: character.name,
            descriptor: character.description || `Character visible or referenced in ${projectName || "production"}.`,
            sourceCharacterId: character.id,
            serverPath: characterPreviewPath(character),
          }))
        : characterNames.slice(0, 4).map((name, index) => ({ id: `c${index + 1}`, name, descriptor: `Character visible or referenced in ${projectName || "production"}.` })),
      savedCardVideos: savedVideos,
      stitchedVideoPath: stitchedVideoPath || undefined,
      completedAt: status === "completed" ? new Date().toISOString() : undefined,
      status,
    };
  }

  async function saveProduction(status: "active" | "completed" = "active") {
    setBusy("save");
    setError("");
    try {
      const state = buildState(status);
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({ action: "save", production: state }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Save failed");
      const record = data?.production as PersistedProductionRecord;
      if (record?.id) setProductionId(record.id);
      if (record?.name) setProjectName(record.name);
      setNotice(status === "completed" ? "Project completed." : "Production saved.");
      await refreshProductions();
      return true;
    } catch (err: any) {
      setError(err?.message || String(err));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function deleteProduction(id: string) {
    if (!window.confirm("Delete this saved production record? Gallery outputs are not deleted.")) return;
    setBusy(`delete-${id}`);
    setError("");
    try {
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({ action: "delete", productionId: id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      await refreshProductions();
      setNotice("Production deleted.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy("");
    }
  }

  async function handleImageUpload(file: File) {
    setBusy("upload");
    setError("");
    try {
      const uploaded = await uploadImage(file);
      setStartingImagePath(uploaded.serverPath);
      setStartingImageUrl(uploaded.previewUrl);
      setNotice("Starting image loaded.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy("");
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  function updateScene(id: string, patch: Partial<SceneDraft>) {
    setScenes((prev) => prev.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)));
  }

  function toggleSceneCharacter(scene: SceneDraft, character: SavedCharacterRecord, checked: boolean) {
    const currentIds = Array.isArray(scene.characterIds) ? scene.characterIds : [];
    const currentNames = Array.isArray(scene.characterNames) ? scene.characterNames : [];

    if (checked && currentIds.length >= 4 && !currentIds.includes(character.id)) {
      setNotice("Each scene supports up to 4 saved characters.");
      return;
    }

    const nextIds = checked
      ? Array.from(new Set([...currentIds, character.id])).slice(0, 4)
      : currentIds.filter((id) => id !== character.id);
    const nextNames = checked
      ? Array.from(new Set([...currentNames, character.name])).slice(0, 4)
      : currentNames.filter((name) => name !== character.name);

    updateScene(scene.id, { characterIds: nextIds, characterNames: nextNames });
  }

  function addScene(afterId?: string) {
    setScenes((prev) => {
      const nextScene = createScene(prev.length, characterNames);
      if (!afterId) return [...prev, nextScene];
      const index = prev.findIndex((scene) => scene.id === afterId);
      if (index < 0) return [...prev, nextScene];
      return [...prev.slice(0, index + 1), nextScene, ...prev.slice(index + 1)];
    });
  }

  function duplicateScene(id: string) {
    setScenes((prev) => {
      const index = prev.findIndex((scene) => scene.id === id);
      if (index < 0) return prev;
      const clone = { ...prev[index], id: makeId("scene"), title: `${prev[index].title || `Scene ${index + 1}`} copy` };
      return [...prev.slice(0, index + 1), clone, ...prev.slice(index + 1)];
    });
  }

  function removeScene(id: string) {
    setScenes((prev) => {
      const next = prev.filter((scene) => scene.id !== id);
      return next.length ? next : [createScene(0, characterNames)];
    });
  }

  function moveScene(id: string, direction: -1 | 1) {
    setScenes((prev) => {
      const index = prev.findIndex((scene) => scene.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  async function generateBatch() {
    if (!projectName.trim()) {
      setError("Enter a production name first.");
      return;
    }
    if (!startingImagePath) {
      setError("Upload a starting image first.");
      return;
    }
    if (!validScenes.length) {
      setError("Add at least one scene prompt.");
      return;
    }
    setBusy("generate");
    setError("");
    setNotice("Submitting LTX Prompt Relay timeline...");
    try {
      const id = productionId || fallbackProductionId(projectName);
      setProductionId(id);
      const res = await fetch("/api/production/video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({
          productionId: id,
          productionName: projectName,
          cardIndex: savedVideos.length + 1,
          imagePath: startingImagePath,
          positivePrompt: validScenes[0]?.prompt || "",
          negativePrompt,
          timelineGlobalPrompt: globalPrompt,
          timelineScenes: validScenes,
          timelineCharacters: productionCharacters.map((character) => ({
            id: character.id,
            name: character.name,
            description: character.description,
            imagePath: characterPreviewPath(character),
          })),
          timelineFps: fps,
          useVideoReasoning,
          useCrispEnhance,
          durationSec: totalSeconds,
          width: 1280,
          height: 720,
          workflowFile: PROMPT_RELAY_WORKFLOW_FILE,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Timeline generation failed");
      const nextPath = pickVideoPath(data);
      const nextUrl = withCacheBust(pickVideoUrl(data, nextPath));
      if (!nextPath || !nextUrl) throw new Error("Generation did not return a usable video.");
      const entry: SavedScene = {
        card: savedVideos.length + 1,
        imagePath: startingImagePath,
        imageUrl: startingImageUrl,
        videoPath: nextPath,
        videoUrl: nextUrl,
        prompt: validScenes.map((scene, index) => `${index + 1}. ${scene.title} (${scene.durationSec}s): ${scene.prompt}`).join("\n\n"),
        characterNames: productionCharacters.length ? productionCharacters.map((character) => character.name) : characterNames.slice(0, 4),
      };
      const nextVideos = [...savedVideos, entry];
      setSavedVideos(nextVideos);
      setActiveVideoPath(nextPath);
      setActiveVideoUrl(nextUrl);
      setNotice("Batch generated. Review it, save the production, or stitch approved batches.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy("");
    }
  }

  async function stitchVideos() {
    if (!savedVideos.length) {
      setError("Generate at least one batch before stitching.");
      return;
    }
    setBusy("stitch");
    setError("");
    try {
      const id = productionId || fallbackProductionId(projectName);
      const res = await fetch("/api/production/stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({
          productionId: id,
          scenes: savedVideos.map((scene) => ({ card: scene.card, videoPath: scene.videoPath })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Stitch failed");
      const nextPath = String(data?.videoPath || data?.serverPath || "");
      const nextUrl = withCacheBust(String(data?.videoUrl || data?.serverUrl || fileUrlFor(nextPath)));
      if (!nextPath || !nextUrl) throw new Error("Stitch did not return a usable video.");
      setStitchedVideoPath(nextPath);
      setStitchedVideoUrl(nextUrl);
      setNotice("Final video stitched.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy("");
    }
  }

  const home = (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr),360px]">
      <section className="rounded-[22px] border border-white/10 bg-[#0b0d12] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">Production Timeline</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/62">
              Build one production from a starting image and timed LTX 2.3 Prompt Relay scenes. Generate batches, review them, then stitch the approved videos.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetBuilder("Untitled Production");
              setMode("builder");
            }}
            className="rounded-[14px] bg-cyan-400 px-5 py-3 text-sm font-black text-slate-950"
          >
            New Timeline Production
          </button>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <Stat label="Active" value={activeSummaries.length} />
          <Stat label="Completed" value={completedSummaries.length} />
          <Stat label="Workflow" value="LTX 2.3" />
        </div>
      </section>

      <section className="rounded-[22px] border border-white/10 bg-[#11131a] p-5">
        <div className="text-sm font-black uppercase tracking-[0.18em] text-white/50">Project Library</div>
        <div className="mt-4 grid gap-2">
          <button type="button" onClick={() => setMode("load")} className="rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm font-semibold text-white/82">Load Active Production</button>
          <button type="button" onClick={() => setMode("completed")} className="rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm font-semibold text-white/82">Completed Projects</button>
          <button type="button" onClick={() => setMode("delete")} className="rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm font-semibold text-white/82">Delete Production Record</button>
        </div>
      </section>
    </div>
  );

  const listView = (items: ProductionSummary[], action: "load" | "delete") => (
    <section className="rounded-[22px] border border-white/10 bg-[#0b0d12] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black text-white">{action === "load" ? "Load Production" : "Delete Production"}</h2>
        <button type="button" onClick={() => setMode("home")} className="rounded-[12px] border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/78">Back</button>
      </div>
      {items.length ? (
        <div className="grid gap-3">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-white/[0.04] p-4">
              <div>
                <div className="font-semibold text-white">{item.name}</div>
                <div className="mt-1 text-xs text-white/48">
                  {item.sceneCount || 0} saved batch{item.sceneCount === 1 ? "" : "es"} · updated {new Date(item.updatedAt).toLocaleString()}
                </div>
              </div>
              {action === "load" ? (
                <button type="button" onClick={() => void loadProduction(item.id)} className="rounded-[12px] bg-cyan-400 px-4 py-2 text-sm font-black text-slate-950">Load</button>
              ) : (
                <button type="button" onClick={() => void deleteProduction(item.id)} className="rounded-[12px] border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-black text-rose-100">Delete</button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyBox>No productions found.</EmptyBox>
      )}
    </section>
  );

  const builder = (
    <div className="grid gap-4 xl:grid-cols-[300px,minmax(0,1fr),380px]">
      <aside className="space-y-4 rounded-[22px] border border-white/10 bg-[#0b0d12] p-4">
        <div>
          <label className="text-xs font-black uppercase tracking-[0.18em] text-white/42">Production Name</label>
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            className="mt-2 w-full rounded-[14px] border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
            placeholder="Name this production"
          />
        </div>
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-white/42">Starting Image</div>
          {startingImageUrl ? (
            <img src={startingImageUrl} alt="Starting reference" className="mt-2 h-44 w-full rounded-[14px] border border-white/10 bg-black object-contain" />
          ) : (
            <div className="mt-2"><EmptyBox>Upload the first background or starting frame.</EmptyBox></div>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImageUpload(file);
            }}
          />
          <button type="button" onClick={() => imageInputRef.current?.click()} className="mt-3 w-full rounded-[14px] bg-white px-4 py-3 text-sm font-black text-black">
            {busy === "upload" ? "Uploading..." : "Upload Starting Image"}
          </button>
        </div>
        <div>
          <label className="text-xs font-black uppercase tracking-[0.18em] text-white/42">Fallback Character Names</label>
          <textarea
            rows={3}
            value={characterText}
            onChange={(event) => setCharacterText(event.target.value)}
            className="mt-2 w-full rounded-[14px] border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
            placeholder="Sarah, Marcus"
          />
          <div className="mt-2 text-xs text-white/42">Used only when a scene has no saved Characters selected.</div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/42">Saved Characters</div>
            <button type="button" onClick={() => void refreshCharacters()} className="rounded-[10px] border border-white/10 px-2 py-1 text-[11px] font-semibold text-white/64">
              Refresh
            </button>
          </div>
          <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
            {savedCharacters.length ? (
              savedCharacters.slice(0, 24).map((character) => {
                const preview = fileUrlFor(characterPreviewPath(character));
                return (
                  <div key={character.id} className="flex items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.04] p-2">
                    {preview ? (
                      <img src={preview} alt={character.name} className="h-12 w-12 rounded-[10px] border border-white/10 object-cover" />
                    ) : (
                      <div className="h-12 w-12 rounded-[10px] border border-white/10 bg-black/40" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-white">{character.name}</div>
                      <div className="line-clamp-2 text-xs text-white/45">{character.description || "No saved description."}</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[14px] border border-dashed border-white/10 bg-black/30 px-3 py-4 text-xs text-white/45">
                No saved Characters found. Create them in the Characters tab, then refresh here.
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void saveProduction("active")} className="rounded-[14px] border border-cyan-300/30 bg-cyan-500/10 px-3 py-3 text-sm font-black text-cyan-100">Save</button>
          <button type="button" onClick={() => setMode("home")} className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-semibold text-white/78">Exit</button>
        </div>
      </aside>

      <main className="space-y-4">
        <section className="rounded-[22px] border border-white/10 bg-[#0b0d12] p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),120px]">
            <div>
              <label className="text-xs font-black uppercase tracking-[0.18em] text-white/42">Global Style</label>
              <input
                value={globalPrompt}
                onChange={(event) => setGlobalPrompt(event.target.value)}
                className="mt-2 w-full rounded-[14px] border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.18em] text-white/42">FPS</label>
              <select value={fps} onChange={(event) => setFps(Number(event.target.value) || 24)} className="mt-2 w-full rounded-[14px] border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50">
                {[12, 16, 24, 25, 30].map((value) => <option key={value} value={value} className="bg-black">{value}</option>)}
              </select>
            </div>
          </div>
          <textarea
            rows={2}
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
            className="mt-3 w-full rounded-[14px] border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
            placeholder="Negative prompt"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/76">
              <input type="checkbox" checked={useVideoReasoning} onChange={(event) => setUseVideoReasoning(event.target.checked)} />
              Video Reasoning LoRA
            </label>
            <label className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/76">
              <input type="checkbox" checked={useCrispEnhance} onChange={(event) => setUseCrispEnhance(event.target.checked)} />
              Crisp Enhance
            </label>
          </div>
        </section>

        <section className="rounded-[22px] border border-white/10 bg-[#0b0d12] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-white">Scene Timeline</h2>
              <div className="mt-1 text-sm text-white/50">{validScenes.length} scene prompts · {totalSeconds}s · {totalFrames} frames</div>
            </div>
          </div>
          <div className="space-y-3">
            {scenes.map((scene, index) => (
              <div key={scene.id} className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-black uppercase tracking-[0.16em] text-cyan-100">Scene {index + 1}</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={index === 0} onClick={() => moveScene(scene.id, -1)} className="rounded-[10px] border border-white/10 px-3 py-1 text-xs text-white/70 disabled:opacity-30">Up</button>
                    <button type="button" disabled={index === scenes.length - 1} onClick={() => moveScene(scene.id, 1)} className="rounded-[10px] border border-white/10 px-3 py-1 text-xs text-white/70 disabled:opacity-30">Down</button>
                    <button type="button" onClick={() => duplicateScene(scene.id)} className="rounded-[10px] border border-white/10 px-3 py-1 text-xs text-white/70">Copy</button>
                    <button type="button" onClick={() => removeScene(scene.id)} className="rounded-[10px] border border-rose-400/30 px-3 py-1 text-xs text-rose-100">Delete</button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr),150px]">
                  <input value={scene.title} onChange={(event) => updateScene(scene.id, { title: event.target.value })} className="rounded-[14px] border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50" />
                  <div className="rounded-[14px] border border-white/10 bg-black/40 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/42">Seconds</div>
                    <input type="range" min={1} max={30} step={1} value={scene.durationSec} onChange={(event) => updateScene(scene.id, { durationSec: Number(event.target.value) || 5 })} className="mt-2 w-full accent-cyan-400" />
                    <div className="text-sm font-black text-white">{scene.durationSec}s</div>
                  </div>
                </div>
                <textarea
                  rows={5}
                  value={scene.prompt}
                  onChange={(event) => updateScene(scene.id, { prompt: event.target.value })}
                  className="mt-3 w-full rounded-[14px] border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
                  placeholder="Describe this scene, the action, dialogue, camera, and what changes from the prior scene."
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {savedCharacters.length ? (
                    savedCharacters.map((character) => {
                      const ids = Array.isArray(scene.characterIds) ? scene.characterIds : [];
                      const checked = ids.includes(character.id);
                      const disabled = !checked && ids.length >= 4;
                      return (
                        <label
                          key={`${scene.id}-${character.id}`}
                          className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${
                            checked ? "border-cyan-300/45 bg-cyan-400/12 text-cyan-50" : "border-white/10 bg-black/35 text-white/78"
                          } ${disabled ? "opacity-45" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={(event) => toggleSceneCharacter(scene, character, event.target.checked)}
                          />
                          {character.name}
                        </label>
                      );
                    })
                  ) : (
                    characterNames.map((name) => {
                      const checked = scene.characterNames.includes(name);
                      return (
                        <label key={`${scene.id}-${name}`} className="flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-2 text-xs text-white/78">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const next = event.target.checked ? Array.from(new Set([...scene.characterNames, name])).slice(0, 4) : scene.characterNames.filter((item) => item !== name);
                              updateScene(scene.id, { characterNames: next });
                            }}
                          />
                          {name}
                        </label>
                      );
                    })
                  )}
                  <label className="flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-2 text-xs text-white/78">
                    <input type="checkbox" disabled={index === 0} checked={scene.hardCut} onChange={(event) => updateScene(scene.id, { hardCut: event.target.checked })} />
                    Hard cut
                  </label>
                </div>
                <div className="mt-2 text-xs text-white/42">
                  Select up to 4 saved Characters for this scene. Selected characters are injected into the Prompt Relay scene text.
                </div>
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={() => addScene(scene.id)} className="rounded-[14px] bg-cyan-400 px-4 py-2 text-sm font-black text-slate-950">
                    Add Scene
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <aside className="space-y-4">
        <section className="rounded-[22px] border border-white/10 bg-[#0b0d12] p-4">
          <h2 className="text-lg font-black text-white">Generate</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Scenes" value={validScenes.length} />
            <Stat label="Seconds" value={totalSeconds} />
            <Stat label="Frames" value={totalFrames} />
          </div>
          <div className="mt-4 rounded-[16px] border border-white/10 bg-black/35 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/80">ComfyUI Timeline Preview</div>
                <div className="mt-1 text-xs text-white/45">Review the full prompt package before generation.</div>
              </div>
              <div className="rounded-full border border-white/10 px-3 py-1 text-xs font-black text-white/58">{validScenes.length} scenes</div>
            </div>
            <textarea
              readOnly
              rows={12}
              value={comfyTimelinePreview}
              className="mt-3 w-full resize-y rounded-[14px] border border-white/10 bg-black/55 px-3 py-3 font-mono text-xs leading-5 text-white/78 outline-none"
            />
          </div>
          {error ? <div className="mt-3 rounded-[14px] border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
          {notice ? <div className="mt-3 rounded-[14px] border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{notice}</div> : null}
          <button type="button" onClick={() => void generateBatch()} disabled={busy === "generate"} className="mt-4 w-full rounded-[14px] bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-45">
            {busy === "generate" ? "Generating..." : "Generate Timeline Batch"}
          </button>
          <button type="button" onClick={() => void stitchVideos()} disabled={busy === "stitch" || !savedVideos.length} className="mt-3 w-full rounded-[14px] border border-fuchsia-300/30 bg-fuchsia-500/10 px-4 py-3 text-sm font-black text-fuchsia-100 disabled:opacity-45">
            {busy === "stitch" ? "Stitching..." : "Stitch Approved Videos"}
          </button>
          <button type="button" onClick={() => void saveProduction("completed")} disabled={!stitchedVideoPath || busy === "save"} className="mt-3 w-full rounded-[14px] border border-emerald-300/30 bg-emerald-500/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:opacity-45">
            Complete Project
          </button>
        </section>

        <section className="rounded-[22px] border border-white/10 bg-[#0b0d12] p-4">
          <h2 className="text-lg font-black text-white">Review</h2>
          {activeVideoUrl ? (
            <video key={activeVideoUrl} controls className="mt-3 h-56 w-full rounded-[14px] bg-black object-contain">
              <source src={activeVideoUrl} type="video/mp4" />
            </video>
          ) : (
            <div className="mt-3"><EmptyBox>Generated batches appear here.</EmptyBox></div>
          )}
          {stitchedVideoUrl ? (
            <div className="mt-4">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/80">Final stitched video</div>
              <video key={stitchedVideoUrl} controls className="mt-2 h-48 w-full rounded-[14px] bg-black object-contain">
                <source src={stitchedVideoUrl} type="video/mp4" />
              </video>
            </div>
          ) : null}
        </section>

        <section className="rounded-[22px] border border-white/10 bg-[#0b0d12] p-4">
          <h2 className="text-lg font-black text-white">Saved Batches</h2>
          {savedVideos.length ? (
            <div className="mt-3 space-y-2">
              {savedVideos.map((item) => (
                <button key={`${item.card}-${item.videoPath}`} type="button" onClick={() => { setActiveVideoPath(item.videoPath); setActiveVideoUrl(item.videoUrl); }} className="w-full rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm text-white/78">
                  Batch {item.card}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-3"><EmptyBox>No batches generated yet.</EmptyBox></div>
          )}
        </section>
      </aside>
    </div>
  );

  return (
    <div className="relative rounded-[28px] border border-white/10 bg-[#07080d] p-4 text-white shadow-[0_20px_80px_rgba(0,0,0,0.28)] md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-4">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.22em] text-cyan-200/80">Production</div>
          <div className="mt-1 text-sm text-white/52">Simplified storyboard production for LTX 2.3 Prompt Relay.</div>
        </div>
        <button type="button" onClick={() => void refreshProductions()} className="rounded-[12px] border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/78">
          Refresh
        </button>
      </div>
      {mode === "home" ? home : null}
      {mode === "builder" ? builder : null}
      {mode === "load" ? listView(activeSummaries, "load") : null}
      {mode === "completed" ? listView(completedSummaries, "load") : null}
      {mode === "delete" ? listView(summaries, "delete") : null}
    </div>
  );
}

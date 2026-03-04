"use client";

import React, { useEffect, useMemo, useState } from "react";
import { withDeviceHeader } from "../studio/deviceHeader";
import { useFloatingQueue } from "./FloatingQueueProvider";

type StoryboardCount = 1 | 2 | 3 | 4 | 5;

type CharacterSlot = {
  id: string;
  name: string;
  nameLocked?: boolean;
  file?: File;
  previewUrl?: string;
  serverPath?: string; // absolute path on server
  clearedServerPath?: string; // bg-removed absolute path on server
  descriptor: string;
  status?: string;
  error?: string;
};

type SceneRow = {
  id: string;
  ideaText: string;
  inherit: { lens: boolean; identity: boolean; style: boolean; negative: boolean };
  lensText: string;
  identityLockText: string;
  styleLockText: string;

  // Optional per-scene background image => vision text only (not injected as image)
  bgFile?: File;
  bgPreviewUrl?: string;
  bgServerPath?: string;
  bgText?: string;
  bgLoading?: boolean;
  bgError?: string;
};

const MAX_SCENES = 15;

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const LENS_PRESETS = ["24mm", "35mm", "50mm", "85mm"];
const IDENTITY_PRESETS = [
  "Identity/Face lock: match Character 1 exactly; no face drift; same hair, age, outfit",
  "Identity/Face lock: match Character 1 exactly; preserve facial proportions; no identity swap",
  "Identity/Face lock: keep Character 1 facial structure; consistent hairstyle and outfit",
  "Identity/Face lock: strict face match to Character 1; no drift; consistent skin texture",
];
const STYLE_PRESETS = [
  "realistic cinematic style",
  "realistic cinematic style, film grain, shallow depth of field",
  "realistic cinematic style, soft natural lighting, high detail",
  "realistic cinematic style, moody lighting, subtle bloom",
];

function isGif(file?: File) {
  return !!file && (file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif"));
}

function lockCount(n: number): StoryboardCount {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  return 5;
}

async function uploadStoryboardImage(file: File): Promise<{ serverPath: string }> {
  const fd = new FormData();
  fd.append("image", file, file.name);
  const res = await fetch("/api/storyboard/upload", { method: "POST", headers: withDeviceHeader(), body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Upload failed");
  if (!data?.serverPath) throw new Error("Upload did not return serverPath");
  return { serverPath: data.serverPath as string };
}

// Alias used by per-scene background uploads
const uploadImage = uploadStoryboardImage;

async function callVisionPrompt(args: {
  imagePath: string;
  characterName?: string;
  purpose?: "character" | "background";
}): Promise<{ descriptor: string }> {
  const res = await fetch("/api/vision-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...withDeviceHeader() },
    body: JSON.stringify(args),
  });

  // Defensive parsing: avoids `Unexpected token ... is not valid JSON` when the server
  // returns HTML/plain-text (session redirects, proxy errors, etc.).
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) throw new Error(data?.error || text || "Auto prompt failed");
  return { descriptor: (data?.descriptor ?? "").toString() };
}

async function callEnhancePrompt(args: {
  text: string;
  mode: "background" | "scene" | "descriptor";
  context?: string;
}): Promise<{ enhanced: string }> {
  const res = await fetch("/api/enhance-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...withDeviceHeader() },
    body: JSON.stringify(args),
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) throw new Error(data?.error || text || "Enhance failed");
  return { enhanced: (data?.enhanced ?? "").toString() };
}

export default function StoryboardPanel() {
  const fq = useFloatingQueue();
  // null until user chooses 1–5 on the landing card
  const [storyboardCount, setStoryboardCount] = useState<StoryboardCount | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // Defaults
  const [backgroundPrompt, setBackgroundPrompt] = useState("a city Cafe");
  const [defaultLens, setDefaultLens] = useState("35mm");
  const [defaultStyle, setDefaultStyle] = useState("realistic cinematic style");
  const [defaultIdentity, setDefaultIdentity] = useState(
    "Identity/Face lock: match Character 1 exactly; no face drift; same hair, age, outfit"
  );
  const [globalNegative, setGlobalNegative] = useState(
    "face drift, wrong person, extra limbs, deformed hands, blurry, watermark, text, logo, low quality"
  );
  const [enableNegative, setEnableNegative] = useState(true);

  const [scenes, setScenes] = useState<SceneRow[]>([
    {
      id: "s1",
      ideaText: "",
      inherit: { lens: true, identity: true, style: true, negative: true },
      lensText: "",
      identityLockText: "",
      styleLockText: "",
      bgText: "",
      bgLoading: false,
      bgError: "",
    },
  ]);

  const [convertedPrompts, setConvertedPrompts] = useState<string[]>([]);
  const [previewNegative, setPreviewNegative] = useState<string>("");
  const [createStatus, setCreateStatus] = useState<string>("");
  const [createError, setCreateError] = useState<string>("");

  const [sceneLimitError, setSceneLimitError] = useState<string>("");

  const [enhanceBusyKey, setEnhanceBusyKey] = useState<string>("");
  const [enhanceError, setEnhanceError] = useState<string>("");

  const [characters, setCharacters] = useState<CharacterSlot[]>(() =>
    Array.from({ length: 1 }, (_, i) => ({ id: `c${i + 1}`, name: `Character ${i + 1}`, descriptor: "" }))
  );

  const count = storyboardCount ?? 0;

  // Keep number of character slots aligned to storyboardCount
  useEffect(() => {
    if (!storyboardCount) return;

    setCharacters((prev) => {
      const next: CharacterSlot[] = [];
      for (let i = 0; i < storyboardCount; i++) {
        const existing = prev[i];
        if (existing) next.push(existing);
        else next.push({ id: `c${i + 1}`, name: `Character ${i + 1}`, descriptor: "" });
      }

      // cleanup URLs for removed slots
      for (let i = storyboardCount; i < prev.length; i++) {
        const url = prev[i]?.previewUrl;
        if (url) URL.revokeObjectURL(url);
      }
      return next;
    });
  }, [storyboardCount]);

  // Ensure scenes always exist when entering the UI
  useEffect(() => {
    if (!storyboardCount) return;
    setScenes((prev) =>
      prev?.length
        ? prev
        : [
            {
              id: "s1",
              ideaText: "",
              inherit: { lens: true, identity: true, style: true, negative: true },
              lensText: "",
              identityLockText: "",
              styleLockText: "",
              bgText: "",
              bgLoading: false,
              bgError: "",
            },
          ]
    );
  }, [storyboardCount]);

  // Require selected slots to have uploaded serverPath before Create
  const canProceed = useMemo(() => {
    if (!storyboardCount) return false;
    return characters.slice(0, storyboardCount).every((c) => !!c.file && !!c.serverPath);
  }, [characters, storyboardCount]);

  const pickAndAutoPrompt = async (idx: number, file?: File) => {
    setCreateError("");
    setCreateStatus("");
    setConvertedPrompts([]);
    setPreviewNegative("");

    setCharacters((prev) => {
      const next = [...prev];
      const cur = { ...next[idx] };
      if (cur.previewUrl) URL.revokeObjectURL(cur.previewUrl);

      cur.file = file;
      cur.previewUrl = file ? URL.createObjectURL(file) : undefined;
      cur.serverPath = undefined;
      cur.clearedServerPath = undefined;
      cur.descriptor = "";
      cur.error = undefined;
      cur.status = file ? "Uploading image…" : undefined;

      next[idx] = cur;
      return next;
    });

    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type) && !isGif(file)) {
      setCharacters((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], error: "Unsupported image type. Use PNG/JPG/WebP/GIF.", status: undefined };
        return next;
      });
      return;
    }

    try {
      const up = await uploadStoryboardImage(file);

      // set serverPath first
      setCharacters((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], serverPath: up.serverPath, status: "Auto prompting…" };
        return next;
      });

      // read latest name from state at call time (avoid stale closure)
      const currentName = ((): string => {
        const c = characters[idx];
        return (c?.name ?? "").trim();
      })();

      const vp = await callVisionPrompt({
        imagePath: up.serverPath,
        characterName: currentName || undefined,
        purpose: "character",
      });

      setCharacters((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], descriptor: vp.descriptor, status: undefined, error: undefined };
        return next;
      });
    } catch (e: any) {
      setCharacters((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], error: e?.message || String(e), status: undefined };
        return next;
      });
    }
  };

  const removeBackground = async (idx: number) => {
    const slot = characters[idx];
    if (!slot?.serverPath) return;

    setCharacters((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], status: "Removing background…", error: undefined };
      return next;
    });

    try {
      // IMPORTANT: this relies on the patched /api/bg-remove JSON mode
      const res = await fetch("/api/bg-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({ imagePath: slot.serverPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Remove background failed");

      const clearedPath = (data?.bgRemovedPath ?? data?.outputPath ?? data?.serverPath) as string | undefined;
      if (!clearedPath) throw new Error("Remove background did not return a path");

      setCharacters((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], clearedServerPath: clearedPath, status: undefined };
        return next;
      });
    } catch (e: any) {
      setCharacters((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], error: e?.message || String(e), status: undefined };
        return next;
      });
    }
  };

  const runAutoPrompt = async (idx: number) => {
    const slot = characters[idx];
    if (!slot?.serverPath) return;

    setCharacters((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], status: "Auto prompting…", error: undefined };
      return next;
    });

    try {
      const vp = await callVisionPrompt({
        imagePath: slot.serverPath,
        characterName: slot.name?.trim() || undefined,
        purpose: "character",
      });
      setCharacters((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], descriptor: vp.descriptor, status: undefined, error: undefined };
        return next;
      });
    } catch (e: any) {
      setCharacters((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], error: e?.message || String(e), status: undefined };
        return next;
      });
    }
  };

  const clearCharacter = (idx: number) => {
    setCharacters((prev) => {
      const next = [...prev];
      const cur = { ...next[idx] };
      if (cur.previewUrl) URL.revokeObjectURL(cur.previewUrl);
      next[idx] = {
        ...cur,
        file: undefined,
        previewUrl: undefined,
        serverPath: undefined,
        clearedServerPath: undefined,
        descriptor: "",
        status: undefined,
        error: undefined,
      };
      return next;
    });
  };

  const clearDescriptor = (idx: number) => {
    setCharacters((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], descriptor: "" };
      return next;
    });
  };

  const enhanceText = async (key: string, mode: "background" | "scene" | "descriptor", text: string, apply: (v: string) => void, context?: string) => {
    const src = (text || "").trim();
    if (!src) return;
    setEnhanceError("");
    setEnhanceBusyKey(key);
    try {
      const out = await callEnhancePrompt({ text: src, mode, context });
      const next = (out.enhanced || "").trim();
      if (next) apply(next);
    } catch (e: any) {
      setEnhanceError(e?.message || String(e));
    } finally {
      setEnhanceBusyKey("");
    }
  };


  const stripToOneLine = (s: string) => (s || "").replace(/\s+/g, " ").trim();

  // Preview prompt should match what /api/storyboard/create injects into ComfyUI.
  const buildScenePromptPreview = (args: {
    sceneNumber: number;
    lensText: string;
    identityLockText: string;
    styleLockText: string;
    backgroundPrompt?: string;
    ideaText: string;
    characterDescriptors?: string[];
  }) => {
    const loc = args.backgroundPrompt?.trim() ? args.backgroundPrompt.trim() : "";
    const chars = (args.characterDescriptors || []).filter(Boolean);
    const charGlossary = chars.length ? `Characters: ${chars.join(" | ")}.` : "";
    const camera = `The camera holds a steady, cinematic shot (${args.lensText.trim()}).`;
    const action = stripToOneLine(args.ideaText);
    const envLine = [loc, charGlossary, action].filter(Boolean).join(" ");
    return stripToOneLine(
      `Next Scene ${args.sceneNumber}: ${camera} ${envLine} Identity/Face lock: ${args.identityLockText.trim()}. ${args.styleLockText.trim()}`
    );
  };

  const buildResolvedScenePrompts = (descriptors: string[]) => {
    // Preview/create should include all scenes.
    let prevLens = defaultLens;
    let prevId = defaultIdentity;
    let prevStyle = defaultStyle;

    return scenes.map((s, i) => {
      const lens = (s.lensText || "").trim() || (s.inherit?.lens && i > 0 ? prevLens : "") || defaultLens;
      const identity =
        (s.identityLockText || "").trim() || (s.inherit?.identity && i > 0 ? prevId : "") || defaultIdentity;
      const style = (s.styleLockText || "").trim() || (s.inherit?.style && i > 0 ? prevStyle : "") || defaultStyle;

      prevLens = lens;
      prevId = identity;
      prevStyle = style;

      return buildScenePromptPreview({
        sceneNumber: i + 1,
        lensText: lens,
        identityLockText: identity,
        styleLockText: style,
        backgroundPrompt,
        ideaText: s.ideaText || "",
        characterDescriptors: descriptors,
      });
    });
  };

  const workflowFileForCount = (n: StoryboardCount) => {
    if (n === 1) return "storyboard/StoryBoard 1.json"; // repo file name
    return `storyboard/Storyboard ${n}.json`;
  };

  const convertPreview = async () => {
    setCreateError("");
    setCreateStatus("");
    setConvertedPrompts([]);
    setPreviewNegative("");

    if (!storyboardCount) {
      setCreateError("Select a storyboard (1–5) first");
      return;
    }

    const descriptors = characters
      .slice(0, storyboardCount)
      .map((c) => (c.name?.trim() ? `${c.name.trim()}: ${c.descriptor}` : c.descriptor))
      .filter(Boolean);

    // Preview should include all scenes.
    const prompts = buildResolvedScenePrompts(descriptors);

    setConvertedPrompts(prompts);
    setPreviewNegative(enableNegative ? globalNegative : "");
  };

  const createSendToComfy = async () => {
    setCreateError("");
    setCreateStatus("Creating workflow…");

    // Bubble queue widget (filled once validation passes)
    const queueTitle = storyboardCount ? `Storyboard (${storyboardCount} chars)` : "Storyboard";
    let queueId: string | null = null;
    let queueTempId: string | null = null;

    try {
      if (!storyboardCount) throw new Error("Select a storyboard (1–5) first");
      if (scenes.length > MAX_SCENES) throw new Error(`Maximum ${MAX_SCENES} scenes allowed.`);
 
      // Bubble queue widget: add a temp entry immediately after validation.
      queueTempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      queueId = queueTempId;
      fq.add({ id: queueTempId, title: queueTitle, status: "queued" });


      const descriptors = characters
        .slice(0, storyboardCount)
        .map((c) => (c.name?.trim() ? `${c.name.trim()}: ${c.descriptor}` : c.descriptor))
        .filter(Boolean);

      // Build the full multi-scene prompt as a single text block for ComfyUI
      const scenePrompts = buildResolvedScenePrompts(descriptors);
      const fullPrompt = scenePrompts.join("\n\n");

      // IMPORTANT: Inject bg-removed image if present
      const characterImages = characters
        .slice(0, storyboardCount)
        .map((c) => c.clearedServerPath || c.serverPath)
        .filter(Boolean);

      const res = await fetch("/api/storyboard/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({
          storyboardCount,
          workflowFile: workflowFileForCount(storyboardCount),
          characterDescriptors: descriptors,
          characterImages,
          backgroundPrompt,
          globalNegativePrompt: enableNegative ? globalNegative : undefined,
          scenePrompts,
          fullPrompt,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Create failed");

      const promptId = String(data?.promptId || data?.prompt_id || "").trim();
      if (promptId) {
        try { if (queueTempId) fq.remove(queueTempId); } catch {}
        fq.add({ id: promptId, title: queueTitle, status: "queued" });
        queueId = promptId;
      }

      setCreateStatus(`Sent to ComfyUI (prompt_id: ${promptId || "unknown"})`);
    } catch (e: any) {
      setCreateStatus("");
      const msg = e?.message || String(e);
      setCreateError(msg);
      try {
        if (queueId && queueId.startsWith("local-")) fq.remove(queueId);
        else if (queueId) fq.update(queueId, { status: "error", errorMessage: msg });
      } catch {}
    }
  };

  return (
    <div className="otg-card">
      <div className="otg-cardHeader">
        <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="otg-title">Storyboard</div>
          {showConfig ? (
            <button type="button" className="otg-btnGhost" onClick={() => setShowConfig(false)}>
              Back
            </button>
          ) : null}
        </div>
      </div>

      {/* Step 1: choose storyboard count */}
      {!showConfig ? (
        <div className="otg-cardSection">
          <div className="otg-label">Choose your storyboard</div>
          <div className="otg-row otg-gap" style={{ flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={"otg-chip " + (storyboardCount === n ? "otg-chipActive" : "")}
                onClick={() => setStoryboardCount(lockCount(n))}
              >
                {n} character{n === 1 ? "" : "s"}
              </button>
            ))}
          </div>
          <div className="otg-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="otg-btnPrimary"
              disabled={!storyboardCount}
              onClick={() => storyboardCount && setShowConfig(true)}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {/* Step 2: main interface */}
      {showConfig && storyboardCount ? (
        <div className="otg-cardSection">
          <div className="otg-label">Global background/location prompt (optional)</div>
          <div className="otg-row otg-gap" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="otg-input"
              style={{ flex: "1 1 420px" }}
              value={backgroundPrompt}
              onChange={(e) => setBackgroundPrompt(e.target.value)}
            />
            <button
              type="button"
              className="otg-btnGhost"
              disabled={enhanceBusyKey === "bg-global" || !backgroundPrompt.trim()}
              onClick={() => enhanceText("bg-global", "background", backgroundPrompt, setBackgroundPrompt)}
            >
              {enhanceBusyKey === "bg-global" ? "Enhancing…" : "Enhance"}
            </button>
          </div>
          {enhanceError ? <div className="otg-errorText" style={{ marginTop: 8 }}>{enhanceError}</div> : null}

          <div className="otg-label" style={{ marginTop: 12 }}>
            Default lens text
          </div>
          <input className="otg-input" value={defaultLens} onChange={(e) => setDefaultLens(e.target.value)} />
          <div className="otg-row otg-gap" style={{ marginTop: 8, flexWrap: "wrap" }}>
            {LENS_PRESETS.map((p) => (
              <button key={p} type="button" className="otg-pill-ghost" onClick={() => setDefaultLens(p)}>
                {p}
              </button>
            ))}
          </div>

          <div className="otg-label" style={{ marginTop: 12 }}>
            Default style lock
          </div>
          <input className="otg-input" value={defaultStyle} onChange={(e) => setDefaultStyle(e.target.value)} />
          <div className="otg-row otg-gap" style={{ marginTop: 8, flexWrap: "wrap" }}>
            {STYLE_PRESETS.map((p) => (
              <button key={p} type="button" className="otg-pill-ghost" onClick={() => setDefaultStyle(p)}>
                {p}
              </button>
            ))}
          </div>

          <div className="otg-label" style={{ marginTop: 12 }}>
            Default identity/face lock
          </div>
          <input className="otg-input" value={defaultIdentity} onChange={(e) => setDefaultIdentity(e.target.value)} />
          <div className="otg-row otg-gap" style={{ marginTop: 8, flexWrap: "wrap" }}>
            {IDENTITY_PRESETS.map((p) => (
              <button key={p} type="button" className="otg-pill-ghost" onClick={() => setDefaultIdentity(p)}>
                {p}
              </button>
            ))}
          </div>

          <div className="otg-row" style={{ marginTop: 12, alignItems: "center" }}>
            <label className="otg-checkWrap">
              <input type="checkbox" checked={enableNegative} onChange={(e) => setEnableNegative(e.target.checked)} />
              <span>Enable negative prompt</span>
            </label>
          </div>

          {enableNegative ? (
            <textarea className="otg-textarea" value={globalNegative} onChange={(e) => setGlobalNegative(e.target.value)} />
          ) : null}
        </div>
      ) : null}

      {showConfig ? (
        <>
          {/* Characters */}
          {characters.map((c, idx) => (
            <div key={c.id} className="otg-cardSection">
              <div className="otg-label">Character {idx + 1}</div>

              <div className="otg-label">Character name</div>
              <div className="otg-row otg-gap" style={{ alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className="otg-input"
                  style={{ maxWidth: 360, flex: "1 1 220px" }}
                  value={c.name}
                  disabled={!!c.nameLocked}
                  onChange={(e) =>
                    setCharacters((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], name: e.target.value };
                      return next;
                    })
                  }
                />
                <button
                  type="button"
                  className="otg-btnGhost"
                  disabled={!c.name?.trim() || !!c.nameLocked}
                  onClick={() =>
                    setCharacters((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], nameLocked: true };
                      return next;
                    })
                  }
                >
                  Submit
                </button>
                {c.nameLocked ? (
                  <button
                    type="button"
                    className="otg-btnGhost"
                    onClick={() =>
                      setCharacters((prev) => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], nameLocked: false };
                        return next;
                      })
                    }
                  >
                    Edit
                  </button>
                ) : null}
              </div>

              <div className="otg-row otg-gap" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <label className="otg-btnGhost">
                  Choose File
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES.join(",")}
                    style={{ display: "none" }}
                    onChange={(e) => pickAndAutoPrompt(idx, e.target.files?.[0])}
                  />
                </label>

                <button type="button" className="otg-btnGhost" onClick={() => removeBackground(idx)} disabled={!c.serverPath}>
                  Remove background
                </button>

                <button type="button" className="otg-btnGhost" onClick={() => runAutoPrompt(idx)} disabled={!c.serverPath}>
                  Auto prompt
                </button>

                <button type="button" className="otg-btnGhost" onClick={() => clearCharacter(idx)}>
                  Clear
                </button>
              </div>

              <div className="otg-row otg-gap" style={{ marginTop: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="otg-muted" style={{ marginBottom: 6 }}>
                    Original
                  </div>
                  <div className="otg-previewBox">
                    {c.previewUrl ? <img src={c.previewUrl} className="otg-previewImg" alt="original" /> : <div className="otg-muted">Not selected</div>}
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  <div className="otg-muted" style={{ marginBottom: 6 }}>
                    Background removed
                  </div>
                  <div className="otg-previewBox">
                    {c.clearedServerPath ? (
                      <img
                        src={`/api/file?path=${encodeURIComponent(c.clearedServerPath)}`}
                        className="otg-previewImg"
                        alt="bg removed"
                      />
                    ) : (
                      <div className="otg-muted">Not generated</div>
                    )}
                  </div>
                </div>
              </div>

              {c.status ? <div className="otg-muted" style={{ marginTop: 8 }}>{c.status}</div> : null}
              {c.error ? <div className="otg-errorText" style={{ marginTop: 8 }}>{c.error}</div> : null}

              <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                <div className="otg-label">Descriptor (hair / age / outfit / skin/build)</div>
                <div className="otg-row otg-gap" style={{ alignItems: "center" }}>
                  <button
                    type="button"
                    className="otg-btnGhost"
                    disabled={enhanceBusyKey === `desc-${idx}` || !c.descriptor.trim()}
                    onClick={() =>
                      enhanceText(
                        `desc-${idx}`,
                        "descriptor",
                        c.descriptor,
                        (v) =>
                          setCharacters((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], descriptor: v };
                            return next;
                          }),
                        `Character name: ${(c.name || "").trim()}`
                      )
                    }
                  >
                    {enhanceBusyKey === `desc-${idx}` ? "Enhancing…" : "Enhance"}
                  </button>

                  <button type="button" className="otg-btnGhost" onClick={() => clearDescriptor(idx)}>
                    Clear prompt
                  </button>
                </div>
              </div>

              <textarea
                className="otg-textarea"
                value={c.descriptor}
                onChange={(e) =>
                  setCharacters((prev) => {
                    const next = [...prev];
                    next[idx] = { ...next[idx], descriptor: e.target.value };
                    return next;
                  })
                }
                placeholder="e.g., female, 20s–30s, curly dark hair, brown eyes, medium brown skin, bright pink bikini, slim build"
              />
            </div>
          ))}

          {/* Scenes */}
          <div className="otg-cardSection">
            <div className="otg-label">Scenes</div>

            {scenes.map((s, idx) => (
              (() => {
                const isLocked = idx !== scenes.length - 1;
                return (
              <div key={idx} className="otg-sceneCard">
                <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div className="otg-label">Scene {idx + 1}</div>
                  {idx > 0 ? (
                    <button type="button" className="otg-btnGhost" onClick={() => setScenes((p) => p.filter((_, i) => i !== idx))}>
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="sb-inheritRow" style={{ marginTop: 8 }}>
                  <label className="otg-checkWrap">
                    <input
                      type="checkbox"
                      disabled={isLocked}
                      checked={!!s.inherit.lens}
                      onChange={(e) => setScenes((p) => p.map((x, i) => (i === idx ? { ...x, inherit: { ...x.inherit, lens: e.target.checked } } : x)))}
                    />{" "}
                    <span>Use previous lens</span>
                  </label>
                  <label className="otg-checkWrap">
                    <input
                      type="checkbox"
                      disabled={isLocked}
                      checked={!!s.inherit.identity}
                      onChange={(e) =>
                        setScenes((p) => p.map((x, i) => (i === idx ? { ...x, inherit: { ...x.inherit, identity: e.target.checked } } : x)))
                      }
                    />{" "}
                    <span>Use previous identity/face lock</span>
                  </label>
                  <label className="otg-checkWrap">
                    <input
                      type="checkbox"
                      disabled={isLocked}
                      checked={!!s.inherit.style}
                      onChange={(e) => setScenes((p) => p.map((x, i) => (i === idx ? { ...x, inherit: { ...x.inherit, style: e.target.checked } } : x)))}
                    />{" "}
                    <span>Use previous style lock</span>
                  </label>
                  <label className="otg-checkWrap">
                    <input
                      type="checkbox"
                      disabled={isLocked}
                      checked={!!s.inherit.negative}
                      onChange={(e) => setScenes((p) => p.map((x, i) => (i === idx ? { ...x, inherit: { ...x.inherit, negative: e.target.checked } } : x)))}
                    />{" "}
                    <span>Apply negative</span>
                  </label>
                </div>

                <div className="otg-label" style={{ marginTop: 10 }}>
                  Scene idea (what changes)
                </div>
                <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <div className="otg-muted">Text prompt</div>
                  <button
                    type="button"
                    className="otg-btnGhost"
                    disabled={isLocked || enhanceBusyKey === `scene-${idx}` || !s.ideaText.trim()}
                    onClick={() =>
                      enhanceText(
                        `scene-${idx}`,
                        "scene",
                        s.ideaText,
                        (v) => setScenes((p) => p.map((x, i) => (i === idx ? { ...x, ideaText: v } : x))),
                        `Global background: ${backgroundPrompt}`
                      )
                    }
                  >
                    {enhanceBusyKey === `scene-${idx}` ? "Enhancing…" : "Enhance"}
                  </button>
                </div>
                <textarea
                  className="otg-textarea"
                  value={s.ideaText}
                  readOnly={isLocked}
                  onChange={(e) => setScenes((p) => p.map((x, i) => (i === idx ? { ...x, ideaText: e.target.value } : x)))}
                />

                <div className="otg-label" style={{ marginTop: 10 }}>
                  Background image for this scene (optional)
                </div>
                <div className="otg-row otg-gap" style={{ alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={isLocked}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;

                      (async () => {
                        setScenes((p) => p.map((x, i) => (i === idx ? { ...x, bgLoading: true, bgError: "" } : x)));
                        try {
                          const up = await uploadImage(f);
                          const vp = await callVisionPrompt({ imagePath: up.serverPath, purpose: "background" });

                          // Inject new background text into the GLOBAL background prompt box.
                          const bgLine = (vp.descriptor || "").trim();
                          if (bgLine) {
                            setBackgroundPrompt(bgLine.toLowerCase().startsWith("background:") ? bgLine : `Background: ${bgLine}`);
                          }

                          setScenes((p) =>
                            p.map((x, i) => {
                              if (i !== idx) return x;
                              if (x.bgPreviewUrl) URL.revokeObjectURL(x.bgPreviewUrl);
                              return {
                                ...x,
                                bgFile: f,
                                bgServerPath: up.serverPath,
                                bgPreviewUrl: URL.createObjectURL(f),
                                bgText: vp.descriptor,
                                bgLoading: false,
                              };
                            })
                          );
                        } catch (err: any) {
                          setScenes((p) => p.map((x, i) => (i === idx ? { ...x, bgLoading: false, bgError: err?.message || String(err) } : x)));
                        }
                      })();

                      e.currentTarget.value = "";
                    }}
                  />

                  {s.bgLoading ? <span className="otg-muted">Please wait…</span> : null}
                  {s.bgError ? <span className="otg-errorText">{s.bgError}</span> : null}
                </div>

                {s.bgPreviewUrl ? (
                  <div className="otg-previewBox" style={{ marginTop: 10, height: 160, maxHeight: 160 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="otg-previewImg" src={s.bgPreviewUrl} alt="Scene background" />
                  </div>
                ) : null}
                {s.bgText ? <div className="otg-muted" style={{ marginTop: 8 }}>Background: {s.bgText}</div> : null}

                <div className="otg-label" style={{ marginTop: 10 }}>
                  Lens
                </div>
                <input
                  className="otg-input"
                  value={s.lensText}
                  disabled={isLocked}
                  onChange={(e) => setScenes((p) => p.map((x, i) => (i === idx ? { ...x, lensText: e.target.value } : x)))}
                />

                <div className="otg-label" style={{ marginTop: 10 }}>
                  Identity/Face lock
                </div>
                <input
                  className="otg-input"
                  value={s.identityLockText}
                  disabled={isLocked}
                  onChange={(e) => setScenes((p) => p.map((x, i) => (i === idx ? { ...x, identityLockText: e.target.value } : x)))}
                />

                <div className="otg-label" style={{ marginTop: 10 }}>
                  Style lock
                </div>
                <input
                  className="otg-input"
                  value={s.styleLockText}
                  disabled={isLocked}
                  onChange={(e) => setScenes((p) => p.map((x, i) => (i === idx ? { ...x, styleLockText: e.target.value } : x)))}
                />
              </div>
                );
              })()
            ))}

            <div className="otg-row otg-gap" style={{ marginTop: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                className="otg-btnPrimary"
                disabled={scenes.length >= MAX_SCENES}
                onClick={() =>
                  setScenes((p) => {
                    if (p.length >= MAX_SCENES) {
                      setSceneLimitError(`Maximum ${MAX_SCENES} scenes.`);
                      return p;
                    }
                    setSceneLimitError("");
                    return [
                      ...p,
                      {
                        id: `s${p.length + 1}`,
                        ideaText: "",
                        inherit: { lens: true, identity: true, style: true, negative: true },
                        lensText: "",
                        identityLockText: "",
                        styleLockText: "",
                        bgText: "",
                        bgLoading: false,
                        bgError: "",
                      },
                    ];
                  })
                }
              >
                + Add Scene
              </button>

              <button type="button" className="otg-btnGhost" onClick={convertPreview}>
                Preview
              </button>

              <button type="button" className="otg-btnGhost" onClick={createSendToComfy} disabled={!canProceed}>
                Create and Send to ComfyUI
              </button>
            </div>

            {createStatus ? <div className="otg-muted" style={{ marginTop: 10 }}>{createStatus}</div> : null}
            {createError ? <div className="otg-errorText" style={{ marginTop: 10 }}>{createError}</div> : null}
            {sceneLimitError ? <div className="otg-errorText" style={{ marginTop: 10 }}>{sceneLimitError}</div> : null}

            {convertedPrompts.length ? (
              <div style={{ marginTop: 14 }}>
                <div className="otg-label">Preview (sent to ComfyUI)</div>

                <div className="otg-muted" style={{ marginTop: 6, marginBottom: 8 }}>
                  Scene prompts (Create sends all scenes as one prompt)
                </div>

                {convertedPrompts.map((p, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div className="otg-muted" style={{ marginBottom: 4 }}>
                      Scene {i + 1}
                    </div>
                    <div className="otg-textarea" style={{ whiteSpace: "pre-wrap" }}>
                      {p}
                    </div>
                  </div>
                ))}

                {previewNegative ? (
                  <>
                    <div className="otg-muted" style={{ marginTop: 10, marginBottom: 4 }}>
                      Negative prompt
                    </div>
                    <div className="otg-textarea" style={{ whiteSpace: "pre-wrap" }}>
                      {previewNegative}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <style jsx>{`
        .otg-previewBox {
          width: 100%;
          max-height: 220px;
          height: 220px;
          border-radius: 16px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.04);
        }
        .otg-previewImg {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
      `}</style>
    </div>
  );
}
"use client";

import React, { useMemo, useRef, useState } from "react";
import { withDeviceHeader } from "../studio/deviceHeader";

export type ProductionDirectorImportedFrame = {
  imagePath?: string;
  imageUrl?: string;
  prompt?: string;
  label?: string;
};

type DirectorSegment = {
  id: string;
  imagePath: string;
  imageUrl: string;
  prompt: string;
  seconds: number;
  guideStrength: number;
};

type DirectorResponse = {
  ok?: boolean;
  error?: string;
  videoPath?: string;
  videoUrl?: string;
  serverPath?: string;
  serverUrl?: string;
  generatedVideoPath?: string;
  generatedVideoUrl?: string;
};

function createSegment(index: number, frame?: ProductionDirectorImportedFrame): DirectorSegment {
  return {
    id: `director-segment-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    imagePath: String(frame?.imagePath || ""),
    imageUrl: String(frame?.imageUrl || (frame?.imagePath ? `/api/file?path=${encodeURIComponent(String(frame.imagePath))}` : "")),
    prompt: String(frame?.prompt || ""),
    seconds: 2,
    guideStrength: 0.75,
  };
}

function clampSegmentCount(items: DirectorSegment[]): DirectorSegment[] {
  return items.slice(0, 4);
}

function fileUrlFor(pathValue: string): string {
  const path = String(pathValue || "").trim();
  return path ? `/api/file?path=${encodeURIComponent(path)}` : "";
}

function pickVideoPath(payload: DirectorResponse): string {
  return String(payload.videoPath || payload.serverPath || payload.generatedVideoPath || "");
}

function pickVideoUrl(payload: DirectorResponse): string {
  return String(payload.videoUrl || payload.serverUrl || payload.generatedVideoUrl || "");
}

async function uploadDirectorImage(file: File): Promise<{ serverPath: string; previewUrl: string }> {
  const form = new FormData();
  form.append("image", file, file.name);

  const response = await fetch("/api/storyboard/upload", {
    method: "POST",
    headers: withDeviceHeader(),
    body: form,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "Image upload failed.");
  }

  const serverPath = String(data?.serverPath || data?.imagePath || "");
  if (!serverPath) {
    throw new Error("Image upload did not return a server path.");
  }

  return {
    serverPath,
    previewUrl: String(data?.previewUrl || data?.imageUrl || fileUrlFor(serverPath)),
  };
}

export default function ProductionDirectorModeUI({
  productionId,
  productionName,
  importedFrames = [],
}: {
  productionId?: string;
  productionName?: string;
  importedFrames?: ProductionDirectorImportedFrame[];
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [globalPrompt, setGlobalPrompt] = useState("");
  const [durationSec, setDurationSec] = useState(8);
  const [frameRate, setFrameRate] = useState(24);
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [resizeMethod, setResizeMethod] = useState("crop");
  const [customAudio, setCustomAudio] = useState(false);
  const [segments, setSegments] = useState<DirectorSegment[]>(() => [createSegment(0)]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [resultPath, setResultPath] = useState("");

  const selectedSegment = segments[selectedIndex] || segments[0];

  const totalSegmentSeconds = useMemo(
    () => segments.reduce((sum, segment) => sum + Math.max(0, Number(segment.seconds) || 0), 0),
    [segments]
  );

  function updateSelectedSegment(patch: Partial<DirectorSegment>) {
    setSegments((previous) =>
      previous.map((segment, index) => (index === selectedIndex ? { ...segment, ...patch } : segment))
    );
  }

  function handleAddImage() {
    if (segments.length >= 4) {
      setStatus("Director Mode supports up to 4 image segments.");
      return;
    }

    const nextIndex = segments.length;
    setSegments((previous) => clampSegmentCount([...previous, createSegment(nextIndex)]));
    setSelectedIndex(nextIndex);
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }

  function handleDeleteSelected() {
    if (segments.length <= 1) {
      setSegments([createSegment(0)]);
      setSelectedIndex(0);
      setStatus("Segment reset.");
      return;
    }

    setSegments((previous) => previous.filter((_, index) => index !== selectedIndex));
    setSelectedIndex((previous) => Math.max(0, Math.min(previous - 1, segments.length - 2)));
    setStatus("Segment deleted.");
  }

  function handleImportPageFrames() {
    const frames = importedFrames
      .filter((frame) => frame.imagePath || frame.imageUrl)
      .slice(0, 4);

    if (!frames.length) {
      setStatus("No page frames are available to import yet.");
      return;
    }

    setSegments(frames.map((frame, index) => createSegment(index, frame)));
    setSelectedIndex(0);
    setStatus(`${frames.length} page frame${frames.length === 1 ? "" : "s"} imported.`);
  }

  async function handleImageUpload(file: File) {
    setBusy(true);
    setStatus("Uploading image...");
    try {
      const uploaded = await uploadDirectorImage(file);
      updateSelectedSegment({
        imagePath: uploaded.serverPath,
        imageUrl: uploaded.previewUrl,
      });
      setStatus("Image added to selected segment.");
    } catch (error: any) {
      setStatus(error?.message || String(error));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleGenerate() {
    const readySegments = segments
      .map((segment, index) => ({
        index,
        imagePath: segment.imagePath,
        imageUrl: segment.imageUrl,
        prompt: segment.prompt.trim(),
        durationSec: Number(segment.seconds) || 2,
        guideStrength: Number(segment.guideStrength) || 0.75,
      }))
      .filter((segment) => segment.imagePath);

    if (!readySegments.length) {
      setStatus("Add or import at least one image segment before generating.");
      return;
    }

    if (!globalPrompt.trim()) {
      setStatus("Global prompt is required.");
      return;
    }

    setBusy(true);
    setResultUrl("");
    setResultPath("");
    setStatus("Submitting Director workflow...");

    try {
      const response = await fetch("/api/production/animate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...withDeviceHeader(),
        },
        body: JSON.stringify({
          workflowMode: "director",
          mode: "director",
          productionId: productionId || "",
          productionName: productionName || "Untitled Production",
          globalPrompt: globalPrompt.trim(),
          customAudio,
          settings: {
            durationSec,
            frameRate,
            width,
            height,
            resizeMethod,
          },
          segments: readySegments,
        }),
      });

      const data = (await response.json().catch(() => null)) as DirectorResponse | null;
      if (!response.ok) {
        throw new Error(data?.error || "Director video generation failed.");
      }

      const nextPath = pickVideoPath(data || {});
      const nextUrl = pickVideoUrl(data || {}) || (nextPath ? fileUrlFor(nextPath) : "");

      setResultPath(nextPath);
      setResultUrl(nextUrl);
      setStatus(nextUrl || nextPath ? "Director video generated." : "Director request completed.");
    } catch (error: any) {
      setStatus(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-full overflow-hidden rounded-[28px] border border-white/10 bg-black/45 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 pb-4">
        <div>
          <div className="text-lg font-black tracking-[0.14em] text-white">LTX Director</div>
          <div className="mt-2 text-sm text-white/60">
            Multi-image scene direction for up to 4 image segments. Default Animate remains unchanged.
          </div>
        </div>
        <div className="rounded-full border border-cyan-300/25 bg-cyan-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
          Director Mode
        </div>
      </div>

      <div className="grid gap-4 pt-5 xl:grid-cols-[minmax(0,1fr),380px]">
        <div className="space-y-4">
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <label className="text-sm font-semibold text-white/85">Global prompt</label>
            <textarea
              rows={6}
              value={globalPrompt}
              onChange={(event) => setGlobalPrompt(event.target.value)}
              placeholder="Describe the full scene, camera intent, motion, subject continuity, and visual style."
              className="mt-3 w-full rounded-[22px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <label className="space-y-2 rounded-[20px] border border-white/10 bg-white/5 p-3 text-sm text-white/75">
              <span className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">Duration seconds</span>
              <input type="number" min={1} max={60} value={durationSec} onChange={(event) => setDurationSec(Number(event.target.value) || 8)} className="w-full rounded-[14px] border border-white/10 bg-black/45 px-3 py-2 text-white outline-none" />
            </label>
            <label className="space-y-2 rounded-[20px] border border-white/10 bg-white/5 p-3 text-sm text-white/75">
              <span className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">Frame rate</span>
              <input type="number" min={1} max={60} value={frameRate} onChange={(event) => setFrameRate(Number(event.target.value) || 24)} className="w-full rounded-[14px] border border-white/10 bg-black/45 px-3 py-2 text-white outline-none" />
            </label>
            <label className="space-y-2 rounded-[20px] border border-white/10 bg-white/5 p-3 text-sm text-white/75">
              <span className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">Width</span>
              <input type="number" min={256} max={2048} step={64} value={width} onChange={(event) => setWidth(Number(event.target.value) || 1280)} className="w-full rounded-[14px] border border-white/10 bg-black/45 px-3 py-2 text-white outline-none" />
            </label>
            <label className="space-y-2 rounded-[20px] border border-white/10 bg-white/5 p-3 text-sm text-white/75">
              <span className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">Height</span>
              <input type="number" min={256} max={2048} step={64} value={height} onChange={(event) => setHeight(Number(event.target.value) || 720)} className="w-full rounded-[14px] border border-white/10 bg-black/45 px-3 py-2 text-white outline-none" />
            </label>
            <label className="space-y-2 rounded-[20px] border border-white/10 bg-white/5 p-3 text-sm text-white/75 md:col-span-2">
              <span className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">Resize method</span>
              <select value={resizeMethod} onChange={(event) => setResizeMethod(event.target.value)} className="w-full rounded-[14px] border border-white/10 bg-black/45 px-3 py-2 text-white outline-none">
                <option value="crop" className="bg-[#090910]">Crop</option>
                <option value="pad" className="bg-[#090910]">Pad</option>
                <option value="stretch" className="bg-[#090910]">Stretch</option>
                <option value="contain" className="bg-[#090910]">Contain</option>
              </select>
            </label>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Timeline</div>
                <div className="mt-1 text-xs text-white/45">Up to 4 image segments. Current total: {totalSegmentSeconds}s.</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleAddImage} disabled={busy || segments.length >= 4} className="rounded-full border border-cyan-300/30 bg-cyan-500/12 px-4 py-2 text-sm font-black text-cyan-100 disabled:opacity-45">
                  Add Image
                </button>
                <button type="button" onClick={handleImportPageFrames} disabled={busy} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/82 disabled:opacity-45">
                  Import Page Frames
                </button>
                <button type="button" onClick={handleDeleteSelected} disabled={busy} className="rounded-full border border-rose-300/25 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 disabled:opacity-45">
                  Delete
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImageUpload(file);
              }}
            />

            <div className="grid gap-3 md:grid-cols-4">
              {segments.map((segment, index) => (
                <button
                  key={segment.id}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className={[
                    "rounded-[20px] border p-3 text-left transition",
                    selectedIndex === index
                      ? "border-cyan-300/45 bg-cyan-500/14 text-white"
                      : "border-white/10 bg-black/30 text-white/72 hover:bg-white/5",
                  ].join(" ")}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase tracking-[0.16em]">Segment {index + 1}</span>
                    <span className="h-2 w-2 rounded-full bg-cyan-300/70" />
                  </div>
                  {segment.imageUrl ? (
                    <img src={segment.imageUrl} alt={`Director segment ${index + 1}`} className="h-24 w-full rounded-[14px] bg-black/45 object-contain" />
                  ) : (
                    <div className="flex h-24 items-center justify-center rounded-[14px] border border-dashed border-white/12 bg-black/35 text-xs text-white/40">
                      No image
                    </div>
                  )}
                  <div className="mt-2 text-xs text-white/48">{segment.seconds}s guide {segment.guideStrength}</div>
                </button>
              ))}
            </div>
          </div>

          {selectedSegment ? (
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Selected segment {selectedIndex + 1}</div>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/82 disabled:opacity-45">
                  Upload / Replace Image
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-[260px,minmax(0,1fr)]">
                <div className="rounded-[20px] border border-white/10 bg-black/35 p-3">
                  {selectedSegment.imageUrl ? (
                    <img src={selectedSegment.imageUrl} alt={`Selected segment ${selectedIndex + 1}`} className="h-[220px] w-full rounded-[16px] object-contain" />
                  ) : (
                    <div className="flex h-[220px] items-center justify-center rounded-[16px] border border-dashed border-white/12 text-sm text-white/40">
                      Upload an image for this segment.
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-2 text-sm text-white/75">
                      <span className="font-semibold text-white/85">Seconds</span>
                      <input type="number" min={1} max={30} value={selectedSegment.seconds} onChange={(event) => updateSelectedSegment({ seconds: Number(event.target.value) || 2 })} className="w-full rounded-[18px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none" />
                    </label>
                    <label className="space-y-2 text-sm text-white/75">
                      <span className="font-semibold text-white/85">Guide strength</span>
                      <input type="number" min={0} max={1.5} step={0.05} value={selectedSegment.guideStrength} onChange={(event) => updateSelectedSegment({ guideStrength: Number(event.target.value) || 0 })} className="w-full rounded-[18px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none" />
                    </label>
                  </div>

                  <label className="block space-y-2 text-sm text-white/75">
                    <span className="font-semibold text-white/85">Segment prompt</span>
                    <textarea
                      rows={7}
                      value={selectedSegment.prompt}
                      onChange={(event) => updateSelectedSegment({ prompt: event.target.value })}
                      placeholder="Describe what should happen during this segment."
                      className="w-full rounded-[22px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                    />
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/78">
              <input type="checkbox" checked={customAudio} onChange={(event) => setCustomAudio(event.target.checked)} />
              <span>Custom Audio {customAudio ? "ON" : "OFF"}</span>
            </label>
            <button type="button" onClick={() => void handleGenerate()} disabled={busy} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white disabled:opacity-45">
              {busy ? "Generating..." : "Generate Director Video"}
            </button>
          </div>

          {status ? (
            <div className="rounded-[18px] border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
              {status}
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Director output</div>
            {resultUrl ? (
              <video key={resultUrl} controls className="mt-3 h-[260px] w-full rounded-[20px] bg-black object-contain">
                <source src={resultUrl} type="video/mp4" />
              </video>
            ) : (
              <div className="mt-3 rounded-[20px] border border-dashed border-white/12 bg-black/35 px-4 py-16 text-center text-sm text-white/42">
                Generated Director video preview appears here.
              </div>
            )}
            {resultPath ? <div className="mt-3 break-all text-xs text-white/42">{resultPath}</div> : null}
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm text-white/62">
            <div className="font-black uppercase tracking-[0.18em] text-white/72">Payload target</div>
            <div className="mt-2 rounded-[14px] border border-white/10 bg-black/35 px-3 py-2 font-mono text-xs text-cyan-100/85">
              /api/production/animate
            </div>
            <div className="mt-3">
              Sends <span className="font-mono text-cyan-100/85">workflowMode: "director"</span> with global prompt, settings, custom audio flag, and up to 4 segment payloads.
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
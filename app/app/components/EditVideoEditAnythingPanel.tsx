
"use client";

import React from "react";
import { cn } from "@/lib/cn";
import type {LtxStudioRuntimeTool} from "@/lib/ltxStudiosRuntime";
import {LTX_STUDIO_LABELS,LTX_STUDIO_HELP} from "@/lib/ltxStudiosUi";

type GalleryVideoItem = {
  fileName?: string;
  name?: string;
  sourceName?: string;
  url?: string;
  video?: boolean;
  kind?: "image" | "video";
  source?: "user" | "device" | string;
  scope?: string;
  sizeBytes?: number;
  size?: number;
  meta?: {
    renamedName?: string | null;
    originalName?: string | null;
    durationSeconds?: number | null;
    width?: number | null;
    height?: number | null;
  };
};

type SelectedVideo = {
  source: "upload" | "gallery";
  file?: File;
  fileName: string;
  title: string;
  previewUrl: string;
  scope?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
};

type EditTask = "add" | "remove" | "replace" | "convert_style" | "obscura_remova";

type LtxEditResult = {
  ok: boolean;
  jobId: string;
  promptId?: string;
  fileName: string;
  url: string;
  galleryUrl?: string;
  saved?: boolean;
  durationSeconds?: number;
  fps?: number;
  longerSide?: number;
  sourceVideoName?: string;
  task?: EditTask;
  instruction?: string;
  hdrMasterUrl?:string;
  exrArchiveUrl?:string;
};

type LivePreviewPayload = {
  imageUrl?: string;
  mimeType?: string;
  step?: number | null;
  total?: number | null;
  updatedAt?: number;
};

type Props = {
  onRefreshGallery?: () => void;
  studioTool?: LtxStudioRuntimeTool;
};

const taskLabels: Record<EditTask, string> = {
  add: "Add object / detail",
  remove: "Remove object / detail",
  replace: "Replace subject / object",
  convert_style: "Convert style",
  obscura_remova: "Remove foreground obstruction",
};

const taskExamples: Record<EditTask, string> = {
  add: "Add a small black dog sitting beside the person, interacting naturally with the existing motion.",
  remove: "Remove the object on the table while preserving the camera movement and scene lighting.",
  replace: "Replace the red car with a black sports car while keeping the same road motion and camera angle.",
  convert_style: "Convert the video into a clean cinematic anime style while preserving the original movement and composition.",
  obscura_remova: "Remove the foreground obstruction and reveal the clean scene behind it with stable camera motion.",
};

function cleanTitle(value: string) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function displayVideoName(item: GalleryVideoItem) {
  return String(item.meta?.renamedName || item.name || item.sourceName || item.fileName || "Gallery video").trim();
}

function galleryLookupName(item: GalleryVideoItem) {
  return String(item.fileName || item.sourceName || item.name || "").trim();
}

function isVideoItem(item: GalleryVideoItem) {
  const name = galleryLookupName(item).toLowerCase();
  return Boolean(item.video || item.kind === "video" || /\.(mp4|webm|mov|mkv|avi)$/i.test(name));
}

function formatDuration(value?: number | null) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown";
  if (seconds < 60) return `${seconds.toFixed(1)} sec`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${rem}`;
}

function withDownload(url?: string) {
  if (!url) return "#";
  return url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
}

export default function EditVideoEditAnythingPanel({ onRefreshGallery, studioTool }: Props) {
  const imageInput=studioTool==="ingredients"||studioTool==="slow-motion-control"||studioTool==="cinemagraph";
  const isAlpha=studioTool==="alpha-gen";
  const isPromptless=isAlpha||studioTool==="sdr-to-hdr";
  const toolName=studioTool ? LTX_STUDIO_LABELS[studioTool] : "LTX Edit Anything";
  const resultName=isAlpha?"Alpha matte":`${toolName} result`;
  const [selectedVideo, setSelectedVideo] = React.useState<SelectedVideo | null>(null);
  const [lookFile,setLookFile]=React.useState<File|null>(null);
  const [lookUrl,setLookUrl]=React.useState("");
  React.useEffect(()=>{if(!lookFile){setLookUrl("");return;}const url=URL.createObjectURL(lookFile);setLookUrl(url);return()=>URL.revokeObjectURL(url);},[lookFile]);
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const [galleryBusy, setGalleryBusy] = React.useState(false);
  const [galleryError, setGalleryError] = React.useState("");
  const [galleryVideos, setGalleryVideos] = React.useState<GalleryVideoItem[]>([]);

  const [task, setTask] = React.useState<EditTask>("add");
  const [instruction, setInstruction] = React.useState(studioTool&&!isAlpha?"":taskExamples.add);
  const [negativePrompt, setNegativePrompt] = React.useState("warped faces, broken limbs, flicker, low quality, blurry, watermark, text overlay, unstable motion");
  const [outputTitle, setOutputTitle] = React.useState(studioTool ? `ltx25_${studioTool.replaceAll("-","_")}` : "ltx_edit_anything");
  const [durationSeconds, setDurationSeconds] = React.useState(studioTool ? 2 : 5);
  const [fps, setFps] = React.useState(24);
  const [speed,setSpeed]=React.useState(0.2);
  const [longerSide, setLongerSide] = React.useState(studioTool ? 512 : 1024);
  const [useVideoReasoning, setUseVideoReasoning] = React.useState(false);
  const [obscuraStrength, setObscuraStrength] = React.useState(2.3);
  const invalidSpeed=studioTool==="slow-motion-control"&&(!Number.isFinite(speed)||speed<0.025||speed>1);
  const maxFrames=studioTool==="restore"?97:145;
  const invalidDuration=Boolean(studioTool&&(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds*fps>maxFrames));

  const [busy, setBusy] = React.useState(false);
  const [cancelBusy,setCancelBusy]=React.useState(false);
  const cancelRef=React.useRef(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [result, setResult] = React.useState<LtxEditResult | null>(null);
  const [liveJobId, setLiveJobId] = React.useState("");
  const [livePromptId, setLivePromptId] = React.useState("");
  const [liveProgressPercent, setLiveProgressPercent] = React.useState(0);
  const [livePreview, setLivePreview] = React.useState<LivePreviewPayload | null>(null);

  React.useEffect(() => {
    return () => {
      if (selectedVideo?.source === "upload" && selectedVideo.previewUrl) {
        URL.revokeObjectURL(selectedVideo.previewUrl);
      }
    };
  }, [selectedVideo]);

  async function loadGalleryVideos() {
    setGalleryOpen(true);
    setGalleryBusy(true);
    setGalleryError("");
    try {
      const response = await fetch("/api/gallery", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Gallery load failed.");
      const raw = Array.isArray(data?.items) ? data.items : Array.isArray(data?.files) ? data.files : [];
      setGalleryVideos(raw.filter((item:GalleryVideoItem)=>imageInput ? !isVideoItem(item)&&/\.(png|jpe?g|webp)$/i.test(galleryLookupName(item)) : isVideoItem(item)));
    } catch (error: any) {
      setGalleryError(error?.message || "Gallery load failed.");
      setGalleryVideos([]);
    } finally {
      setGalleryBusy(false);
    }
  }

  function selectGalleryVideo(item: GalleryVideoItem) {
    const name = galleryLookupName(item);
    const url = String(item.url || "");
    if (!name || !url) {
      setGalleryError("Selected Gallery item is missing a file name or URL.");
      return;
    }
    setSelectedVideo({
      source: "gallery",
      fileName: name,
      title: displayVideoName(item),
      previewUrl: url,
      scope: String(item.source || item.scope || ""),
      durationSeconds: Number(item.meta?.durationSeconds || 0) || undefined,
      width: Number(item.meta?.width || 0) || undefined,
      height: Number(item.meta?.height || 0) || undefined,
      sizeBytes: Number(item.sizeBytes || item.size || 0) || undefined,
    });
    setGalleryOpen(false);
    setResult(null);
    setStatus(`Selected Gallery ${imageInput?"image":"video"} for ${toolName}.`);
  }

  function onUploadVideo(file?: File | null) {
    if (!file) return;
    if (!(imageInput ? /\.(png|jpe?g|webp)$/i : /\.(mp4|webm|mov|mkv|avi)$/i).test(file.name || "")) {
      setStatus(imageInput ? "Use a PNG, JPEG, or WEBP image." : "Use a video file: MP4, WEBM, MOV, MKV, or AVI.");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setSelectedVideo({
      source: "upload",
      file,
      fileName: file.name || "uploaded_video.mp4",
      title: file.name || "Uploaded video",
      previewUrl,
      sizeBytes: file.size,
    });
    setResult(null);
    setStatus(`Uploaded source ${imageInput?"image":"video"} for ${toolName}.`);
  }

  function applyExample(nextTask: EditTask) {
    setTask(nextTask);
    setInstruction(taskExamples[nextTask]);
  }

  React.useEffect(() => {
    if (!busy || !liveJobId || !livePromptId) return;

    let cancelled = false;

    async function pollLiveEdit() {
      try {
        const [progressResponse, jobResponse] = await Promise.all([
          fetch(`/api/progress?promptId=${encodeURIComponent(livePromptId)}`, {
            cache: "no-store",
            credentials: "include",
          }).catch(() => null),
          fetch(`/api/edit-video/ltx-edit?jobId=${encodeURIComponent(liveJobId)}`, {
            cache: "no-store",
            credentials: "include",
          }),
        ]);

        const progressData = progressResponse ? await progressResponse.json().catch(() => null) : null;
        const jobData = await jobResponse.json().catch(() => ({}));
        if (cancelled) return;

        const preview = progressData?.approximatePreview && typeof progressData.approximatePreview === "object"
          ? progressData.approximatePreview as LivePreviewPayload
          : jobData?.approximatePreview && typeof jobData.approximatePreview === "object"
            ? jobData.approximatePreview as LivePreviewPayload
            : null;
        if (preview?.imageUrl) setLivePreview(preview);

        const percent = Number(progressData?.progressPercent ?? progressData?.percent ?? jobData?.progressPercent ?? 0);
        if (Number.isFinite(percent)) setLiveProgressPercent(Math.max(0, Math.min(100, Math.round(percent))));

        if (!jobResponse.ok || jobData?.ok === false) {
          throw new Error(jobData?.error || "LTX Edit Anything status failed.");
        }

        const statusText = String(jobData?.status || "").toLowerCase();
        if (statusText === "complete" || statusText === "completed" || jobData?.url) {
          setResult(jobData as LtxEditResult);
          setBusy(false);
          setLiveJobId("");
          setLivePromptId("");
          setLiveProgressPercent(100);
          setStatus(`${resultName} is ready. Preview it, then save to Gallery or download.`);
          return;
        }

        if (statusText === "canceled") {
          setBusy(false);
          setLiveJobId("");
          setLivePromptId("");
          setStatus(`${toolName} canceled.`);
          return;
        }

        if(!cancelRef.current)setStatus(statusText==="canceling"?"Cancellation requested; waiting for backend clearance.":"Editing video in ComfyUI. Live preview updates when sampler frames arrive.");
      } catch (error: any) {
        if (cancelled) return;
        setBusy(false);
        setStatus(error?.message || "LTX Edit Anything failed.");
      }
    }

    void pollLiveEdit();
    const timer = window.setInterval(() => void pollLiveEdit(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busy, liveJobId, livePromptId]);

  async function cancelLiveEdit() {
    if (!liveJobId || cancelRef.current) return;
    cancelRef.current=true;setCancelBusy(true);
    setStatus("Cancellation requested; waiting for backend clearance...");
    try {
      const response=await fetch("/api/edit-video/ltx-edit", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jobId: liveJobId }),
      });
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||"Cancellation could not be confirmed.");
      if(data.status==="canceled") {
        setBusy(false);setLiveJobId("");setLivePromptId("");setLivePreview(null);
        setStatus(`${toolName} canceled. Backend queue clearance confirmed.`);
      }else if(data.status==="complete"||data.status==="completed") {
        setResult(data);setBusy(false);setLiveJobId("");setLivePromptId("");setStatus("Generation completed before cancellation; result is ready.");
      }
    } catch(error) {
      setStatus(error instanceof Error?error.message:"Cancellation failed; the backend may still be running.");
    } finally {
      cancelRef.current=false;setCancelBusy(false);
    }
  }

  async function runEdit() {
    if(invalidSpeed||invalidDuration){setStatus("Check motion speed and duration. LTX Studios supports at most 145 frames.");return;}
    if (!selectedVideo) {
      setStatus(`Choose or upload a source ${imageInput?"image":"video"} first.`);
      return;
    }
    if(studioTool==="layout-to-render"&&!lookFile){setStatus("Choose the finished look image for the layout video.");return;}
    const text = isPromptless?"Reference-driven conversion.":instruction.trim();
    if (!text) {
      setStatus("Enter an edit instruction first.");
      return;
    }

    const seconds = Math.max(1, Math.min(30, Number(durationSeconds) || 5));
    const rate = Math.max(8, Math.min(60, Number(fps) || 24));
    const side = Math.max(512, Math.min(1536, Number(longerSide) || 1024));
    const cleanOutput = cleanTitle(outputTitle || "ltx_edit_anything") || "ltx_edit_anything";

    setBusy(true);
    setResult(null);
    setLiveJobId("");
    setLivePromptId("");
    setLivePreview(null);
    setLiveProgressPercent(0);
    setStatus(`Submitting ${toolName} workflow to ComfyUI...`);

    try {
      const form = new FormData();
      form.set("video_source", selectedVideo.source);
      form.set("video_title", selectedVideo.title || selectedVideo.fileName);
      form.set("video_name", selectedVideo.fileName);
      form.set("video_scope", selectedVideo.scope || "");
      if (selectedVideo.source === "upload" && selectedVideo.file) {
        form.set("video_file", selectedVideo.file, selectedVideo.file.name || "uploaded_video.mp4");
      }
      form.set("task", task);
      if (studioTool) form.set("studioTool", studioTool);
      if(studioTool==="layout-to-render"&&lookFile)form.set("look_file",lookFile,lookFile.name);
      form.set("instruction", text);
      form.set("negativePrompt", negativePrompt);
      form.set("outputTitle", cleanOutput);
      form.set("durationSeconds", String(seconds));
      form.set("fps", String(rate));
      if(studioTool==="slow-motion-control")form.set("speed",String(speed));
      form.set("longerSide", String(side));
      form.set("useVideoReasoning", useVideoReasoning ? "true" : "false");
      form.set("obscuraStrength", String(obscuraStrength));
      form.set("livePreview", "true");

      const response = await fetch("/api/edit-video/ltx-edit", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || JSON.stringify(data));
      }
      if (response.status === 202 || data?.running || data?.status === "running") {
        const nextJobId = String(data.jobId || "");
        const nextPromptId = String(data.promptId || "");
        if (!nextJobId || !nextPromptId) throw new Error("LTX Edit Anything did not return a live preview job.");
        setLiveJobId(nextJobId);
        setLivePromptId(nextPromptId);
        setStatus("Editing video in ComfyUI. Live preview updates when sampler frames arrive.");
        return;
      }

      setResult(data as LtxEditResult);
      setBusy(false);
      setStatus(`${resultName} is ready. Preview it, then save to Gallery or download.`);
    } catch (error: any) {
      setStatus(error?.message || "LTX Edit Anything failed.");
      setBusy(false);
    } finally {
      // Async live-preview submissions keep busy=true until the status poll completes.
    }
  }

  async function saveToGallery() {
    if (!result || result.saved) return;
    setSaveBusy(true);
    setStatus("Saving LTX edited video to Gallery...");
    try {
      const response = await fetch("/api/edit-video/ltx-edit-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: result.jobId,
          fileName: result.fileName,
          title: cleanTitle(outputTitle || result.fileName),
          sourceVideoName: selectedVideo?.title || selectedVideo?.fileName || result.sourceVideoName,
          task,
          instruction,
          negativePrompt,
          durationSeconds,
          fps,
          longerSide,
          useVideoReasoning,
          obscuraStrength: task === "obscura_remova" ? obscuraStrength : undefined,
          studioTool,
          speed:studioTool==="slow-motion-control"?speed:undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Save to Gallery failed.");
      setResult((current) => current ? { ...current, fileName: String(data.fileName || current.fileName), galleryUrl: String(data.url || ""), saved: true } : current);
      onRefreshGallery?.();
      setStatus("Saved LTX edited video to Gallery.");
    } catch (error: any) {
      setStatus(error?.message || "Save to Gallery failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-4 md:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/78">{studioTool ? toolName : "Video Editing"}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
            {studioTool&&LTX_STUDIO_HELP[studioTool] ? LTX_STUDIO_HELP[studioTool] : isAlpha ? "Generate a black-and-white foreground matte. Empty text conditioning; maximum 145 frames." : studioTool==="ingredients"?"Use a reference-sheet image to preserve subjects and objects in a new LTX 2.5 video. Describe the reference sheet and the generated action separately.":studioTool==="colorization"?"Restore color to grayscale footage with the LTX 2.5 Colorization IC-LoRA. Describe the grayscale reference, then use COLORIZE with the desired colors.":studioTool==="slow-motion-control"?"Animate a starting image with controlled physical motion speed. Playback remains 24fps; motion conditioning is 24 divided by speed. Describe the action normally without speed keywords.":"Use LTX 2.3 Edit Anything for prompt-driven edits on an existing video."}
          </p>
        </div>
        <div className="w-full max-w-sm">
          <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Output name</label>
          <input
            value={outputTitle}
            onChange={(event) => setOutputTitle(cleanTitle(event.target.value))}
            className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
            placeholder="ltx_edit_anything"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/60">Step 1</p>
              <h3 className="mt-1 text-xl font-black text-white">{imageInput?"Choose source image":"Choose source video"}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                {imageInput?"Upload Image":"Upload Video"}
                <input type="file" accept={imageInput?"image/png,image/jpeg,image/webp":"video/mp4,video/webm,video/quicktime,video/x-matroska,video/*"} className="hidden" onChange={(event) => {onUploadVideo(event.target.files?.[0]);event.currentTarget.value="";}} />
              </label>
              <button
                type="button"
                onClick={() => void loadGalleryVideos()}
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
              >
                Choose from Gallery
              </button>
            </div>
          </div>

          {selectedVideo ? (
            <div className="mt-4 rounded-[20px] border border-white/10 bg-black/35 p-3">
              {imageInput?<img src={selectedVideo.previewUrl} alt={`${toolName} source reference`} className="aspect-video w-full rounded-[16px] bg-black object-contain"/>:<video src={selectedVideo.previewUrl} controls preload="metadata" className="aspect-video w-full rounded-[16px] bg-black object-contain" />}
              <p className="mt-3 break-words text-sm font-bold text-white">{selectedVideo.title}</p>
              <p className="mt-1 text-xs text-white/45">
                Source: {selectedVideo.source} · {imageInput?"Reference image":`Duration: ${formatDuration(selectedVideo.durationSeconds)}`}
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-[20px] border border-dashed border-white/15 bg-black/25 p-5 text-sm text-white/55">
              {imageInput?"Select the reference image to use for this video.":"Select a short source video."}
            </div>
          )}
          {studioTool==="layout-to-render"?<div className="mt-4 rounded-2xl border border-white/15 p-3"><label className="block text-sm font-semibold">Finished look image (independent reference at frame -1)<input aria-label="Layout finished look image" type="file" accept="image/png,image/jpeg,image/webp" className="mt-2 block w-full text-sm" onChange={event=>{setLookFile(event.target.files?.[0]||null);event.currentTarget.value="";}}/></label>{lookUrl?<img src={lookUrl} alt="Finished look reference" className="mt-2 max-h-64 w-full object-contain"/>:null}<p className="mt-2 text-xs text-white/55">Use the finished appearance matching the layout framing, not the grayscale layout frame. The second stage doubles the selected base dimensions.</p></div>:null}
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/60">Step 2</p>
          <h3 className="mt-1 text-xl font-black text-white">{isAlpha ? "Matte output settings" : "Scene instruction"}</h3>

          {!isPromptless ? <>
          {!studioTool ? <><div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Task</label>
              <select
                value={task}
                onChange={(event) => applyExample(event.target.value as EditTask)}
                className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40"
              >
                {Object.entries(taskLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="flex min-h-[54px] items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/75">
              <span>Use Video Reasoning LoRA</span>
              <input
                type="checkbox"
                checked={useVideoReasoning}
                onChange={(event) => setUseVideoReasoning(event.target.checked)}
              />
            </label>
            {task === "obscura_remova" ? (
              <div className="rounded-[18px] border border-white/10 bg-black/25 px-4 py-3">
                <div className="flex items-center justify-between text-sm text-white/75">
                  <span>Obscura strength</span>
                  <span>{obscuraStrength.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={3}
                  step={0.1}
                  value={obscuraStrength}
                  onChange={(event) => setObscuraStrength(Number(event.target.value) || 2.3)}
                  className="mt-3 w-full"
                />
              </div>
            ) : (
              <div className="rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm leading-5 text-white/55">
                Video Reasoning is useful for physics, object motion, and temporal stability.
              </div>
            )}
          </div></> : null}

          <label className="mt-4 block text-xs font-black uppercase tracking-[0.18em] text-white/45">Instruction</label>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={5}
            className="mt-2 w-full rounded-[20px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
            placeholder="Example: Add birds flying over the lake while preserving the original camera movement."
          />

          <label className="mt-4 block text-xs font-black uppercase tracking-[0.18em] text-white/45">Negative prompt</label>
          <textarea
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-[20px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
          />
          </> : null}

          {studioTool==="slow-motion-control"?<label className="mt-4 block text-sm font-semibold">Physical motion speed
            <input aria-label="Physical motion speed" type="number" min={0.025} max={1} step={0.025} value={speed} onChange={event=>setSpeed(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/15 bg-black/30 p-3"/>
            <span className="mt-1 block text-xs text-white/55">{invalidSpeed?"Enter a speed between 0.025 and 1.":`Motion conditioning: ${(24/speed).toFixed(1)}fps · playback: 24fps`}</span>
          </label>:null}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Duration</label>
              <input
                type="number"
                min={1}
                max={studioTool?maxFrames/fps:30}
                value={durationSeconds}
                onChange={(event) => setDurationSeconds(Number(event.target.value))}
                className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">FPS</label>
              <input
                type="number"
                min={8}
                max={60}
                value={fps}
                disabled={studioTool==="slow-motion-control"}
                onChange={(event) => setFps(Number(event.target.value))}
                className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Long side</label>
              <input
                type="number"
                min={512}
                max={1536}
                step={64}
                value={longerSide}
                onChange={(event) => setLongerSide(Number(event.target.value))}
                className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40"
              />
            </div>
          </div>
          {studioTool?<p className="mt-2 text-xs text-white/55">Video lengths snap to the model's 8k+1 frame grid and cannot exceed the source clip. Exact output duration is shown after rendering.</p>:null}

          <button
            type="button"
            onClick={() => void runEdit()}
            disabled={busy || !selectedVideo || (!isPromptless&&!instruction.trim()) || (studioTool==="layout-to-render"&&!lookFile) || invalidSpeed || invalidDuration}
            className={cn(
              "mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full px-5 py-3 text-base font-black transition",
              busy || !selectedVideo || (!isPromptless&&!instruction.trim()) || (studioTool==="layout-to-render"&&!lookFile) || invalidSpeed || invalidDuration
                ? "cursor-not-allowed border border-white/10 bg-white/5 text-white/35"
                : "border border-purple-300/30 bg-[linear-gradient(90deg,rgba(145,92,255,0.75),rgba(40,200,255,0.45))] text-white shadow-[0_0_28px_rgba(120,95,255,0.22)] hover:brightness-110",
            )}
          >
            {busy ? "Processing Video..." : `Run ${toolName}`}
          </button>

          {busy && liveJobId ? (
            <button
              type="button"
              onClick={() => void cancelLiveEdit()}
              disabled={cancelBusy}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-red-300/25 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-50 transition hover:bg-red-500/15"
            >
              {cancelBusy?"Cancelling...":"Cancel"}
            </button>
          ) : null}

          {status ? <div className="mt-4 rounded-[18px] border border-white/10 bg-black/35 px-4 py-3 text-sm text-white/70">{status}</div> : null}
        </div>
      </div>

      {busy && livePreview?.imageUrl ? (
        <div className="mt-5 rounded-[24px] border border-purple-300/15 bg-purple-400/[0.05] p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            {String(livePreview.mimeType || "").startsWith("video/") ? (
              <video
                key={livePreview.updatedAt || livePreview.imageUrl}
                src={livePreview.imageUrl}
                controls
                muted
                autoPlay
                loop
                className="aspect-video w-full rounded-[18px] bg-black object-contain xl:max-w-2xl"
              />
            ) : (
              <img
                src={livePreview.imageUrl}
                alt="Live LTX Edit Anything sampler preview"
                className="aspect-video w-full rounded-[18px] bg-black object-contain xl:max-w-2xl"
              />
            )}
            <div className="flex-1">
              <h3 className="text-xl font-black text-white">Approximate Preview</h3>
              <p className="mt-2 text-sm leading-6 text-white/62">
                Live sampler preview while ComfyUI is editing. Final output replaces this preview after completion.
              </p>
              <p className="mt-2 text-xs text-white/42">
                Progress: {liveProgressPercent}%
                {livePreview.step !== null && livePreview.step !== undefined && livePreview.total !== null && livePreview.total !== undefined
                  ? ` - Step ${livePreview.step}/${livePreview.total}`
                  : ""}
              </p>
              {livePromptId ? <p className="mt-2 break-all font-mono text-xs text-white/35">Prompt ID: {livePromptId}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 rounded-[24px] border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            <video src={result.galleryUrl || result.url} controls preload="metadata" className="aspect-video w-full rounded-[18px] bg-black object-contain xl:max-w-2xl" />
            <div className="flex-1">
              <h3 className="text-xl font-black text-white">{isAlpha ? "Foreground alpha matte" : resultName}</h3>
              <p className="mt-2 break-words text-sm text-white/62">{result.fileName}</p>
              <p className="mt-2 text-xs text-white/42">Task: {studioTool ? toolName : taskLabels[result.task || task]} · Duration: {formatDuration(result.durationSeconds || durationSeconds)}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a href={withDownload(result.galleryUrl || result.url)} className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => void saveToGallery()}
                  disabled={saveBusy || result.saved}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {result.saved ? "Saved to Gallery" : saveBusy ? "Saving..." : studioTool==="sdr-to-hdr"?"Save Preview to Gallery":"Save to Gallery"}
                </button>
                <button type="button" onClick={() => setResult(null)} className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  Clear Result
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {result?.hdrMasterUrl?<div className="flex flex-wrap gap-3 rounded-2xl border border-white/15 p-3"><a href={result.hdrMasterUrl} download className="min-h-11 rounded-full border border-white/20 px-4 py-3">Download 10-bit HLG HDR master</a>{result.exrArchiveUrl?<a href={result.exrArchiveUrl} download className="min-h-11 rounded-full border border-white/20 px-4 py-3">Download ACEScg EXR archive</a>:null}<p className="text-xs text-white/60">The in-page player and Gallery preview are tone-mapped SDR; the separate master and EXR files retain HDR.</p></div>:null}
      {galleryOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/82 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl rounded-[28px] border border-white/10 bg-[#080812] p-4 shadow-2xl md:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200/70">Gallery picker</p>
                <h3 className="mt-1 text-2xl font-black text-white">Choose source {imageInput?"image":"video"}</h3>
                <p className="mt-1 text-sm text-white/55">Preview the {imageInput?"image":"video"} first, then select it.</p>
              </div>
              <button type="button" onClick={() => setGalleryOpen(false)} className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Close
              </button>
            </div>

            {galleryBusy ? <p className="mt-5 text-sm text-white/60">Loading Gallery videos...</p> : null}
            {galleryError ? <div className="mt-5 rounded-[18px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/85">{galleryError}</div> : null}
            {!galleryBusy && !galleryError && galleryVideos.length === 0 ? <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/62">No Gallery videos found.</div> : null}

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {galleryVideos.map((item) => {
                const name = displayVideoName(item);
                const key = `${item.source || item.scope || "gallery"}:${galleryLookupName(item)}`;
                return (
                  <div key={key} className="rounded-[22px] border border-white/10 bg-black/35 p-3">
                    {imageInput?<img src={item.url} alt={displayVideoName(item)} className="aspect-video w-full rounded-[18px] bg-black object-contain"/>:<video src={item.url} controls muted preload="metadata" className="aspect-video w-full rounded-[18px] bg-black object-contain" />}
                    <p className="mt-3 break-words text-sm font-semibold text-white/82">{name}</p>
                    <p className="mt-1 text-xs text-white/42">{String(item.source || item.scope || "gallery")}</p>
                    <button type="button" onClick={() => selectGalleryVideo(item)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15">
                      Use This {imageInput?"Image":"Video"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

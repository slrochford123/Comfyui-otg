"use client";

import * as React from "react";
import { useFloatingQueue } from "./FloatingQueueProvider";
import OtgMultiAngleControl from "./OtgMultiAngleControl";

type AnglesTab = "camera" | "mesh" | "model" | "trellis";
type MeshViewMode = "mesh" | "texture";
type MeshAssistStatus = "idle" | "preparing" | "processing" | "ready" | "partial" | "failed";

type SavedSlot = {
  id: string;
  label: string;
  modelUrl: string;
  previewSupported: boolean;
  ext?: string;
  kind: "mesh" | "model" | "trellis";
};

type VaultKind = "mesh" | "model" | "trellis";

type VaultItem = {
  id: string;
  kind: VaultKind;
  name: string;
  modelUrl: string;
  ext?: string;
  previewSupported: boolean;
  createdAt: string;
};

function formatAdvancedProgressDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const TAB_META: Record<AnglesTab, { label: string; help: string }> = {
  camera: {
    label: "Camera",
    help: "Default tab. Uses the existing Angles workflow and an OTG recreation of the ComfyUI multi-angle camera widget.",
  },
  mesh: {
    label: "3D Mesh",
    help: "Runs Hunyuan 3D v2.1 and keeps the same camera rig under the mesh preview so the user can orbit the generated result.",
  },
  model: {
    label: "3D Model",
    help: "Runs SPAR3D through the wrapper path. Generated model loads back into the same OTG viewer controls.",
  },
  trellis: {
    label: "Trellis 2",
    help: "Tab shell only in this patch. The button exists now, but the backend route is not wired yet.",
  },
};

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function getOrCreateDeviceId() {
  if (typeof window === "undefined") return "desktop_default";
  const k = "otg_device_id";
  let id = "";
  try {
    id = localStorage.getItem(k) || "";
  } catch {}
  if (!id) {
    try {
      id = crypto.randomUUID();
      localStorage.setItem(k, id);
    } catch {
      id = `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      try {
        localStorage.setItem(k, id);
      } catch {}
    }
  }
  return id;
}

function mapHorizontalDeg(h: number) {
  const v = Math.round(h);
  return clamp(Math.round(v), -30, 60);
}

function mapVerticalDeg(v: number) {
  const vv = Math.round(v);
  return clamp(Math.round(v), -30, 60);
}

function mapZoom(z: number) {
  return clamp(5 + z, 1, 10);
}

const ORBIT_BASE_RADIUS = 2.25;
const ORBIT_ZOOM_STEP = 0.28;
const SLOT_LIMIT = 2;
const TEMP_SLOTS_STORAGE_KEY = "otg_angles_temp_slots_v1";

function modelViewerOrbit(horizontal: number, vertical: number, zoom: number) {
  const theta = clamp(Math.round(horizontal), -180, 180);
  const phi = clamp(90 - Math.round(vertical), 10, 170);
  const radius = clamp(ORBIT_BASE_RADIUS - zoom * ORBIT_ZOOM_STEP, 0.8, 4.0);
  return `${theta}deg ${phi}deg ${radius.toFixed(2)}m`;
}

function modelExtFromUrl(url: string) {
  const match = url.match(/\.([a-z0-9]+)(?:$|\?)/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function canPreviewInModelViewer(url: string) {
  return /\.(glb|gltf)(?:$|\?)/i.test(url);
}

function EndpointBadge({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        color: "rgba(255,255,255,0.78)",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(0,229,255,0.18)",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "#00e5ff", display: "inline-block" }} />
      {label}
    </div>
  );
}

function pushSavedSlot(existing: SavedSlot[], slot: SavedSlot, nextOverwriteIndex: number) {
  const base = existing.filter((item) => item.modelUrl !== slot.modelUrl).slice(0, SLOT_LIMIT);
  if (base.length < SLOT_LIMIT) {
    return { slots: [...base, slot].slice(0, SLOT_LIMIT), nextIndex: base.length === 0 ? 1 : 0 };
  }
  const next = [...base];
  const idx = clamp(nextOverwriteIndex, 0, SLOT_LIMIT - 1);
  next[idx] = slot;
  return { slots: next, nextIndex: (idx + 1) % SLOT_LIMIT };
}

function slotSummaryLabel(kind: VaultKind, index: number) {
  if (kind === "mesh") return `Mesh ${index + 1}`;
  if (kind === "model") return `Model ${index + 1}`;
  return `Trellis ${index + 1}`;
}

export default function AnglesPanel() {
  const fq = useFloatingQueue();
  const [mvReady, setMvReady] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await import("@google/model-viewer");
        if (mounted) setMvReady(true);
      } catch {
        if (mounted) setMvReady(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const mvRef = React.useRef<any>(null);
  const syncingFromSlidersRef = React.useRef(false);
  const sseRef = React.useRef<EventSource | null>(null);
  const progressStartedAtRef = React.useRef(0);

  const [activeTab, setActiveTab] = React.useState<AnglesTab>("camera");
  const [file, setFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string>("");

  const [horizontal, setHorizontal] = React.useState<number>(0);
  const [vertical, setVertical] = React.useState<number>(0);
  const [zoom, setZoom] = React.useState<number>(0);

  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [progressPct, setProgressPct] = React.useState<number>(0);
  const [progressMsg, setProgressMsg] = React.useState<string>("Idle");

  const [meshBusy, setMeshBusy] = React.useState(false);
  const [meshBlenderBusy, setMeshBlenderBusy] = React.useState(false);
  const [meshMsg, setMeshMsg] = React.useState("");
  const [meshModelUrl, setMeshModelUrl] = React.useState("");
  const [meshJobId, setMeshJobId] = React.useState("");
  const [meshTexturedModelUrl, setMeshTexturedModelUrl] = React.useState("");
  const [meshViewMode, setMeshViewMode] = React.useState<MeshViewMode>("mesh");
  const [meshAssistUploadId, setMeshAssistUploadId] = React.useState("");
  const [meshAssistStatus, setMeshAssistStatus] = React.useState<MeshAssistStatus>("idle");
  const [meshAssistMsg, setMeshAssistMsg] = React.useState("");
  const [meshSlots, setMeshSlots] = React.useState<SavedSlot[]>([]);

  const [modelBusy, setModelBusy] = React.useState(false);
  const [modelMsg, setModelMsg] = React.useState("");
  const [model3dUrl, setModel3dUrl] = React.useState("");
  const [model3dPreviewSupported, setModel3dPreviewSupported] = React.useState(false);
  const [modelSlots, setModelSlots] = React.useState<SavedSlot[]>([]);
  const [trellisSlots, setTrellisSlots] = React.useState<SavedSlot[]>([]);
  const meshNextOverwriteRef = React.useRef(0);
  const modelNextOverwriteRef = React.useRef(0);
  const trellisNextOverwriteRef = React.useRef(0);
  const [vaultOpen, setVaultOpen] = React.useState(false);
  const [vaultItems, setVaultItems] = React.useState<VaultItem[]>([]);
  const [vaultBusy, setVaultBusy] = React.useState(false);
  const [vaultMsg, setVaultMsg] = React.useState("");
  const [vaultSaveTarget, setVaultSaveTarget] = React.useState<SavedSlot | null>(null);
  const [vaultSaveName, setVaultSaveName] = React.useState("");
  const [vaultSaveBusy, setVaultSaveBusy] = React.useState(false);

  const meshAssistTokenRef = React.useRef(0);

  const stopProgressStream = React.useCallback(() => {
    try {
      sseRef.current?.close();
    } catch {}
    sseRef.current = null;
  }, []);

  const startProgressStream = React.useCallback(
    (opts?: { promptId?: string | null }) => {
      const deviceId = getOrCreateDeviceId();
      const promptId = opts?.promptId ?? null;

      setProgressPct(0);
      setProgressMsg("Generating...");
      progressStartedAtRef.current = Date.now();
      stopProgressStream();

      const url = `/api/comfy-events?clientId=${encodeURIComponent(deviceId)}`;
      const es = new EventSource(url);
      sseRef.current = es;

      const safeJson = (s: string) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      };

      es.onmessage = (ev) => {
        const payload = safeJson(ev.data);
        if (!payload) return;

        if (Array.isArray(payload)) {
          if (payload[0] === "__ws_open") setProgressMsg("Connected...");
          return;
        }

        const type = String(payload.type || "");
        const data = payload.data || payload;
        const pid = data?.prompt_id ? String(data.prompt_id) : null;
        if (promptId && pid && pid !== promptId) return;

        if (type === "execution_start") {
          setProgressMsg("Starting...");
          try {
            if (promptId) fq.update(promptId, { status: "running" });
          } catch {}
        }

        if (type === "progress") {
          const v = Number(data?.value);
          const m = Number(data?.max);
          if (Number.isFinite(v) && Number.isFinite(m) && m > 0) {
            const pct = Math.max(0, Math.min(100, Math.round((v / m) * 100)));
            const elapsed = progressStartedAtRef.current ? Date.now() - progressStartedAtRef.current : 0;
            const eta = pct > 0 && pct < 100 ? Math.round((elapsed * (100 - pct)) / pct) : 0;
            setProgressPct(pct);
            setProgressMsg(`Generating... ${pct}% | elapsed ${formatAdvancedProgressDuration(elapsed)} | ETA ${eta ? formatAdvancedProgressDuration(eta) : "--"}`);
          }
        }

        if (type === "progress_state") {
          const nodes = data?.nodes && typeof data.nodes === "object" ? data.nodes : {};
          const runningNode = Object.values(nodes).find((node: any) => String(node?.state || "").toLowerCase() === "running") as any;
          const v = Number(runningNode?.value);
          const m = Number(runningNode?.max);
          if (Number.isFinite(v) && Number.isFinite(m) && m > 0) {
            const pct = Math.max(0, Math.min(100, Math.round((v / m) * 100)));
            const elapsed = progressStartedAtRef.current ? Date.now() - progressStartedAtRef.current : 0;
            const eta = pct > 0 && pct < 100 ? Math.round((elapsed * (100 - pct)) / pct) : 0;
            setProgressPct(pct);
            setProgressMsg(`Generating... ${pct}% | elapsed ${formatAdvancedProgressDuration(elapsed)} | ETA ${eta ? formatAdvancedProgressDuration(eta) : "--"}`);
          }
        }

        if (type === "executing" && data?.node === null) {
          setProgressPct(100);
          setProgressMsg("Done.");
          try {
            if (promptId) fq.update(promptId, { status: "complete" });
          } catch {}
          stopProgressStream();
        }
      };
    },
    [fq, stopProgressStream]
  );

  React.useEffect(() => {
    if (!file) {
      if (imagePreviewUrl) {
        try {
          URL.revokeObjectURL(imagePreviewUrl);
        } catch {}
      }
      setImagePreviewUrl("");
      setMeshModelUrl("");
      setMeshJobId("");
      setMeshTexturedModelUrl("");
      setMeshViewMode("mesh");
      setMeshMsg("");
      setMeshAssistUploadId("");
      setMeshAssistStatus("idle");
      setMeshAssistMsg("");
      setModel3dUrl("");
      setModelMsg("");
      setModel3dPreviewSupported(false);
      return;
    }

    const u = URL.createObjectURL(file);
    setImagePreviewUrl(u);
    return () => {
      try {
        URL.revokeObjectURL(u);
      } catch {}
    };
  }, [file]);

  React.useEffect(() => {
    return () => stopProgressStream();
  }, [stopProgressStream]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(TEMP_SLOTS_STORAGE_KEY) || "";
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const safe = (arr: any, kind: VaultKind): SavedSlot[] =>
        Array.isArray(arr)
          ? arr
              .filter((item) => item && typeof item.modelUrl === "string")
              .slice(0, SLOT_LIMIT)
              .map((item: any, index: number) => ({
                id: String(item.id || `${kind}-${index}-${Date.now()}`),
                label: String(item.label || slotSummaryLabel(kind, index)),
                modelUrl: String(item.modelUrl || ""),
                previewSupported: Boolean(item.previewSupported),
                ext: typeof item.ext === "string" ? item.ext : modelExtFromUrl(String(item.modelUrl || "")),
                kind,
              }))
          : [];
      const mesh = safe(parsed?.mesh, "mesh");
      const model = safe(parsed?.model, "model");
      const trellis = safe(parsed?.trellis, "trellis");
      setMeshSlots(mesh);
      setModelSlots(model);
      setTrellisSlots(trellis);
      meshNextOverwriteRef.current = mesh.length >= SLOT_LIMIT ? 0 : mesh.length % SLOT_LIMIT;
      modelNextOverwriteRef.current = model.length >= SLOT_LIMIT ? 0 : model.length % SLOT_LIMIT;
      trellisNextOverwriteRef.current = trellis.length >= SLOT_LIMIT ? 0 : trellis.length % SLOT_LIMIT;
    } catch {}
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        TEMP_SLOTS_STORAGE_KEY,
        JSON.stringify({ mesh: meshSlots, model: modelSlots, trellis: trellisSlots })
      );
    } catch {}
  }, [meshSlots, modelSlots, trellisSlots]);

  const activeMeshModelUrl = meshViewMode === "texture" && meshTexturedModelUrl ? meshTexturedModelUrl : meshModelUrl;
  const currentModelUrl = activeTab === "mesh" ? activeMeshModelUrl : activeTab === "model" ? model3dUrl : "";
  const orbit = modelViewerOrbit(horizontal, vertical, zoom);
  const imageTransform = `translate(${clamp(horizontal * 0.55, -95, 95)}px, ${clamp(-vertical * 0.9, -72, 72)}px) scale(${(1 + clamp(zoom * 0.08, -0.25, 0.45)).toFixed(3)})`;

  const sharedInputStageStyle: React.CSSProperties = {
    width: "100%",
    marginTop: 10,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "rgba(255,255,255,0.03)",
    borderRadius: 16,
    padding: 12,
    overflow: "hidden",
    minHeight: 280,
    position: "relative",
  };

  const sharedInputImageStyle: React.CSSProperties = {
    maxWidth: "100%",
    height: "auto",
    objectFit: "contain",
    transform: imageTransform,
    transition: busy || meshBusy || modelBusy ? "transform 220ms ease-out" : "transform 120ms ease-out",
    transformOrigin: "center center",
    willChange: "transform",
    userSelect: "none",
    pointerEvents: "none",
  };

  React.useEffect(() => {
    const el = mvRef.current;
    if (!el || !currentModelUrl) return;

    syncingFromSlidersRef.current = true;
    try {
      el.cameraOrbit = orbit;
    } catch {
      try {
        el.setAttribute("camera-orbit", orbit);
      } catch {}
    }
    requestAnimationFrame(() => {
      syncingFromSlidersRef.current = false;
    });
  }, [orbit, currentModelUrl]);

  React.useEffect(() => {
    const el = mvRef.current;
    if (!el || !currentModelUrl) return;

    let raf = 0;
    const toDeg = (x: number) => {
      if (!Number.isFinite(x)) return NaN;
      return Math.abs(x) <= Math.PI * 4 ? (x * 180) / Math.PI : x;
    };

    const onCameraChange = () => {
      if (syncingFromSlidersRef.current) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          const o = el.getCameraOrbit?.();
          if (!o) return;

          const thetaDeg = toDeg(Number(o.theta));
          const phiDeg = toDeg(Number(o.phi));
          const radius = Number(o.radius);
          if (!Number.isFinite(thetaDeg) || !Number.isFinite(phiDeg) || !Number.isFinite(radius)) return;

          const nextHorizontal = clamp(Math.round(thetaDeg), -180, 180);
          const nextVertical = clamp(Math.round(90 - phiDeg), -30, 60);
          const nextZoom = clamp(Math.round(((ORBIT_BASE_RADIUS - radius) / ORBIT_ZOOM_STEP) * 10) / 10, -5, 5);

          setHorizontal((prev) => (Math.abs(prev - nextHorizontal) >= 1 ? nextHorizontal : prev));
          setVertical((prev) => (Math.abs(prev - nextVertical) >= 1 ? nextVertical : prev));
          setZoom((prev) => (Math.abs(prev - nextZoom) >= 0.1 ? nextZoom : prev));
        } catch {}
      });
    };

    el.addEventListener("camera-change", onCameraChange as any);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("camera-change", onCameraChange as any);
    };
  }, [currentModelUrl]);

  const resetPosition = () => {
    setHorizontal(0);
    setVertical(0);
    setZoom(0);
  };

  const handleCreate = async () => {
    if (!file) {
      setMsg("Please upload an image first.");
      return;
    }

    setBusy(true);
    setMsg("");
    setProgressPct(0);
    setProgressMsg("Submitting...");

    const deviceId = getOrCreateDeviceId();
    const tempQueueId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let queueId: string = tempQueueId;
    fq.add({ id: tempQueueId, title: "Angles", status: "queued" });

    try {
      const fd = new FormData();
      fd.append("workflowId", "presets/angles");
      fd.append("prompt", "");
      fd.append("negativePrompt", "");
      fd.append("imageA", file, file.name);
      fd.append("angleHorizontal", String(mapHorizontalDeg(horizontal)));
      fd.append("angleVertical", String(mapVerticalDeg(vertical)));
      fd.append("angleZoom", String(mapZoom(zoom)));

      const res = await fetch("/api/comfy", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": deviceId },
        body: fd,
      });

      let j: any = null;
      try {
        j = await res.clone().json();
      } catch {
        j = null;
      }
      if (!res.ok) throw new Error(j?.error || j?.detail || `Create failed (${res.status})`);

      const promptId = j?.prompt_id ? String(j.prompt_id) : null;
      if (promptId) {
        try {
          fq.remove(tempQueueId);
        } catch {}
        fq.add({ id: promptId, title: "Angles", status: "queued" });
        queueId = promptId;
      }
      startProgressStream({ promptId });
      setMsg("Submitted to ComfyUI. Output will appear in Gallery.");
      setProgressMsg("Generating...");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to submit.");
      try {
        if (queueId && queueId.startsWith("local-")) fq.remove(queueId);
        else if (queueId) fq.update(queueId, { status: "error" });
      } catch {}
      stopProgressStream();
      setProgressMsg("Idle");
      setProgressPct(0);
    } finally {
      setBusy(false);
    }
  };

    const startMeshAssistUpload = React.useCallback(async (selectedFile: File, uploadId: string, token: number) => {
    const deviceId = getOrCreateDeviceId();
    setMeshAssistStatus("processing");
    setMeshAssistMsg("Generating angle assist on 127.0.0.1:8288...");

    try {
      const fd = new FormData();
      fd.append("image", selectedFile, selectedFile.name);
      fd.append("uploadId", uploadId);
      const res = await fetch("/api/angles/multiview-assist", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": deviceId },
        body: fd,
      });
      const text = await res.text();
      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        j = null;
      }
      if (token !== meshAssistTokenRef.current) return;
      if (res.status === 401) {
        setMeshAssistStatus("failed");
        setMeshAssistMsg("Session expired. Please log in again.");
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !j?.ok) throw new Error(j?.error || text || `Angle assist failed (${res.status})`);
      const nextStatus = String(j.status || "ready") as MeshAssistStatus;
      const readyCount = Number(j.readyCount || 0);
      const expectedCount = Number(j.expectedCount || 8);
      setMeshAssistStatus(nextStatus);
      setMeshAssistMsg(
        nextStatus === "ready"
          ? `Angle assist ready (${readyCount}/${expectedCount} views).`
          : nextStatus === "partial"
            ? `Angle assist partial (${readyCount}/${expectedCount} views). Blender will use what exists.`
            : `Angle assist status: ${nextStatus}.`
      );
    } catch (e: any) {
      if (token !== meshAssistTokenRef.current) return;
      setMeshAssistStatus("failed");
      setMeshAssistMsg(e?.message || "Angle assist failed.");
    }
  }, []);

  const handleFilePicked = React.useCallback((selectedFile: File | null) => {
    const token = meshAssistTokenRef.current + 1;
    meshAssistTokenRef.current = token;
    setFile(selectedFile);
    setMeshAssistUploadId("");
    setMeshAssistStatus("idle");
    setMeshAssistMsg("");

    if (!selectedFile) return;

    const uploadId = `mv_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    setMeshAssistUploadId(uploadId);
    setMeshAssistStatus("preparing");
    setMeshAssistMsg("Queueing angle assist...");
    void startMeshAssistUpload(selectedFile, uploadId, token);
  }, [startMeshAssistUpload]);

const handleGenerateMesh = async () => {
    if (!file) {
      setMeshMsg("Please upload an image first.");
      return;
    }
    const deviceId = getOrCreateDeviceId();
    setMeshBusy(true);
    setMeshMsg("Sending image to Hunyuan 3D v2.1 on 100.109.254.63:8188...");
    setMeshModelUrl("");
    setMeshJobId("");
    setMeshTexturedModelUrl("");
    setMeshViewMode("mesh");

    try {
      const fd = new FormData();
      fd.append("image", file, file.name);
      if (meshAssistUploadId) fd.append("multiviewUploadId", meshAssistUploadId);
      const res = await fetch("/api/angles/preview-3d", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": deviceId },
        body: fd,
      });
      const text = await res.text();
      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        j = null;
      }
      if (res.status === 401) {
        setMeshMsg("Session expired. Please log in again.");
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !j?.ok) throw new Error(j?.error || text || `3D mesh failed (${res.status})`);
      const nextUrl = String(j.modelUrl || "");
      const nextJobId = String(j.jobId || j.promptId || "");
      const multiView = j?.multiView || null;
      if (multiView?.status) {
        const nextStatus = String(multiView.status || "idle") as MeshAssistStatus;
        setMeshAssistStatus(nextStatus);
        if (nextStatus === "ready") {
          setMeshAssistMsg(`Angle assist ready (${Number(multiView.readyCount || 0)}/8 views).`);
        } else if (nextStatus === "partial") {
          setMeshAssistMsg(`Angle assist partial (${Number(multiView.readyCount || 0)}/8 views). Blender will use what exists.`);
        } else if (nextStatus === "failed" && multiView.error) {
          setMeshAssistMsg(String(multiView.error));
        }
      }
      setMeshModelUrl(nextUrl);
      setMeshJobId(nextJobId);
      setMeshSlots((prev) => {
        const result = pushSavedSlot(
          prev,
          {
            id: `mesh-${Date.now()}`,
            label: slotSummaryLabel("mesh", meshNextOverwriteRef.current),
            modelUrl: nextUrl,
            previewSupported: canPreviewInModelViewer(nextUrl),
            ext: modelExtFromUrl(nextUrl),
            kind: "mesh",
          },
          meshNextOverwriteRef.current
        );
        meshNextOverwriteRef.current = result.nextIndex;
        return result.slots;
      });
      setMeshMsg("3D mesh preview ready.");
      setActiveTab("mesh");
    } catch (e: any) {
      setMeshModelUrl("");
      setMeshJobId("");
      setMeshTexturedModelUrl("");
      setMeshViewMode("mesh");
      setMeshMsg(e?.message || "3D mesh failed.");
    } finally {
      setMeshBusy(false);
    }
  };

  const handleSendMeshToBlender = async () => {
    if (!meshJobId || !meshModelUrl) {
      setMeshMsg("Generate a mesh first.");
      return;
    }
    const deviceId = getOrCreateDeviceId();
    setMeshBlenderBusy(true);
    setMeshMsg("Sending mesh and source image to Blender on the main PC...");

    try {
      const res = await fetch("/api/angles/blender-texture", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-device-id": deviceId,
        },
        body: JSON.stringify({ jobId: meshJobId }),
      });
      const text = await res.text();
      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        j = null;
      }
      if (res.status === 401) {
        setMeshMsg("Session expired. Please log in again.");
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !j?.ok) throw new Error(j?.error || text || `Blender texture failed (${res.status})`);
      const nextTexturedUrl = String(j.texturedModelUrl || "");
      if (!nextTexturedUrl) throw new Error("Blender did not return a textured model URL.");
      setMeshTexturedModelUrl(nextTexturedUrl);
      setMeshViewMode("texture");
      const usedViews = Array.isArray(j?.multiViewUsed) ? j.multiViewUsed.length : 0;
      setMeshMsg(usedViews > 0 ? `Textured model ready. Blender used ${usedViews} angle assist views.` : "Textured model ready.");
    } catch (e: any) {
      setMeshMsg(e?.message || "Blender texture failed.");
    } finally {
      setMeshBlenderBusy(false);
    }
  };

  const handleMeshViewModeChange = React.useCallback(
    (nextMode: MeshViewMode) => {
      if (nextMode === "texture" && !meshTexturedModelUrl) {
        setMeshMsg("Please send to Blender first.");
        return;
      }
      setMeshViewMode(nextMode);
    },
    [meshTexturedModelUrl]
  );

  const handleGenerateModel = async () => {
    if (!file) {
      setModelMsg("Please upload an image first.");
      return;
    }
    const deviceId = getOrCreateDeviceId();
    setModelBusy(true);
    setModelMsg("Sending image to SPAR3D wrapper on 100.109.254.63:7861...");
    setModel3dUrl("");
    setModel3dPreviewSupported(false);

    try {
      const fd = new FormData();
      fd.append("image", file, file.name);
      const res = await fetch("/api/angles/model-3d", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": deviceId },
        body: fd,
      });
      const text = await res.text();
      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        j = null;
      }
      if (res.status === 401) {
        setModelMsg("Session expired. Please log in again.");
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !j?.ok) throw new Error(j?.error || text || `3D model failed (${res.status})`);
      const nextUrl = String(j.modelUrl || "");
      const previewSupported = Boolean(j.previewSupported);
      const modelExt = String(j.modelExt || modelExtFromUrl(nextUrl) || "");
      setModel3dUrl(nextUrl);
      setModel3dPreviewSupported(previewSupported);
      setModelSlots((prev) => {
        const result = pushSavedSlot(
          prev,
          {
            id: `model-${Date.now()}`,
            label: slotSummaryLabel("model", modelNextOverwriteRef.current),
            modelUrl: nextUrl,
            previewSupported,
            ext: modelExt,
            kind: "model",
          },
          modelNextOverwriteRef.current
        );
        modelNextOverwriteRef.current = result.nextIndex;
        return result.slots;
      });
      setModelMsg(
        previewSupported
          ? "3D model ready."
          : `3D model ready as ${modelExt || "a file"}. Preview in-browser is limited for this format.`
      );
      setActiveTab("model");
    } catch (e: any) {
      setModel3dUrl("");
      setModel3dPreviewSupported(false);
      setModelMsg(e?.message || "3D model failed.");
    } finally {
      setModelBusy(false);
    }
  };

  const loadVault = React.useCallback(async () => {
    setVaultBusy(true);
    setVaultMsg("");
    try {
      const res = await fetch("/api/angles/vault", { credentials: "include", cache: "no-store" });
      const text = await res.text();
      let j: any = null;
      try { j = text ? JSON.parse(text) : null; } catch { j = null; }
      if (!res.ok || !j?.ok) throw new Error(j?.error || text || `Vault load failed (${res.status})`);
      setVaultItems(Array.isArray(j.items) ? j.items : []);
    } catch (e: any) {
      setVaultMsg(e?.message || "Failed to load vault.");
    } finally {
      setVaultBusy(false);
    }
  }, []);

  const openVaultSave = React.useCallback((slot: SavedSlot) => {
    setVaultSaveTarget(slot);
    setVaultSaveName("");
    setVaultMsg("");
    setVaultOpen(true);
  }, []);

  const submitVaultSave = React.useCallback(async () => {
    if (!vaultSaveTarget) return;
    const name = vaultSaveName.trim();
    if (!name) {
      setVaultMsg("Model name is required before saving to vault.");
      return;
    }
    setVaultSaveBusy(true);
    setVaultMsg("");
    try {
      const res = await fetch("/api/angles/vault", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: vaultSaveTarget.kind,
          name,
          modelUrl: vaultSaveTarget.modelUrl,
          ext: vaultSaveTarget.ext || modelExtFromUrl(vaultSaveTarget.modelUrl),
          previewSupported: vaultSaveTarget.previewSupported,
        }),
      });
      const text = await res.text();
      let j: any = null;
      try { j = text ? JSON.parse(text) : null; } catch { j = null; }
      if (!res.ok || !j?.ok) throw new Error(j?.error || text || `Vault save failed (${res.status})`);
      setVaultItems(Array.isArray(j.items) ? j.items : []);
      setVaultSaveTarget(null);
      setVaultSaveName("");
      setVaultMsg("Saved to vault.");
    } catch (e: any) {
      setVaultMsg(e?.message || "Failed to save to vault.");
    } finally {
      setVaultSaveBusy(false);
    }
  }, [vaultSaveName, vaultSaveTarget]);

  const deleteVaultItem = React.useCallback(async (id: string) => {
    setVaultBusy(true);
    setVaultMsg("");
    try {
      const res = await fetch("/api/angles/vault", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const text = await res.text();
      let j: any = null;
      try { j = text ? JSON.parse(text) : null; } catch { j = null; }
      if (!res.ok || !j?.ok) throw new Error(j?.error || text || `Vault delete failed (${res.status})`);
      setVaultItems(Array.isArray(j.items) ? j.items : []);
    } catch (e: any) {
      setVaultMsg(e?.message || "Failed to delete vault item.");
    } finally {
      setVaultBusy(false);
    }
  }, []);

  React.useEffect(() => {
    if (vaultOpen) loadVault();
  }, [vaultOpen, loadVault]);

  const clearAll = () => {
    setFile(null);
    setMsg("");
    setMeshMsg("");
    setModelMsg("");
    setMeshModelUrl("");
    setMeshJobId("");
    setMeshTexturedModelUrl("");
    setMeshViewMode("mesh");
    setMeshAssistUploadId("");
    setMeshAssistStatus("idle");
    setMeshAssistMsg("");
    setModel3dUrl("");
    setModel3dPreviewSupported(false);
    setTrellisSlots([]);
    setProgressPct(0);
    setProgressMsg("Idle");
    stopProgressStream();
    resetPosition();
    setActiveTab("camera");
  };

  const showProgress = progressPct > 0 || (busy && progressMsg !== "Idle");

  const modelViewerEl =
    currentModelUrl && mvReady && canPreviewInModelViewer(currentModelUrl)
      ? React.createElement("model-viewer", {
          ref: mvRef,
          src: currentModelUrl,
          style: {
            width: "100%",
            height: 420,
            background: "rgba(0,0,0,0.6)",
            borderRadius: 12,
          },
          "camera-controls": true,
          "touch-action": "pan-y",
          "camera-orbit": orbit,
          "interaction-prompt": "none",
        } as any)
      : null;

  const viewerAndControls = (opts: {
    title: string;
    description?: string;
    modelUrl: string;
    busyState: boolean;
    statusText: string;
    previewSupported?: boolean;
    headerControls?: React.ReactNode;
  }) => (
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 14, alignItems: "start" }}>
      <div className="otg-card" style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div className="otg-cardTitle" style={{ fontSize: 14 }}>{opts.title}</div>
          {opts.headerControls ? <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{opts.headerControls}</div> : null}
        </div>

        <div
          style={{
            width: "100%",
            marginTop: 12,
            background: "rgba(255,255,255,0.03)",
            borderRadius: 16,
            padding: 12,
            overflow: "hidden",
            minHeight: 446,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          {modelViewerEl && opts.modelUrl === currentModelUrl ? (
            modelViewerEl
          ) : opts.modelUrl ? (
            <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
              <div className="otg-help">
                {canPreviewInModelViewer(opts.modelUrl)
                  ? mvReady
                    ? "Loading 3D viewer..."
                    : "Loading 3D viewer..."
                  : `Preview is not supported for ${modelExtFromUrl(opts.modelUrl) || "this file type"} in the built-in viewer.`}
              </div>
              <a
                href={opts.modelUrl}
                target="_blank"
                rel="noreferrer"
                className="otg-btnGhost"
                style={{ borderRadius: 999, padding: "10px 14px", textDecoration: "none" }}
              >
                Open model file
              </a>
            </div>
          ) : (
            <div className="otg-muted">
              {opts.busyState ? "Working..." : "Upload an image and run this tab to generate a 3D result."}
            </div>
          )}
        </div>

        {opts.statusText ? <div className="otg-help" style={{ marginTop: 10 }}>{opts.statusText}</div> : null}
      </div>

      <OtgMultiAngleControl
        horizontal={horizontal}
        vertical={vertical}
        zoom={zoom}
        disabled={opts.busyState || !opts.modelUrl || !opts.previewSupported}
        onHorizontalChange={setHorizontal}
        onVerticalChange={setVertical}
        onZoomChange={setZoom}
        onReset={resetPosition}
        title="OTG Multi-Angle Camera"
        showHelperText={false}
        showPromptText={false}
        showGestureHint={false}
      />
    </div>
  );

  const savedSlotsRail = (opts: {
    title: string;
    items: SavedSlot[];
    onLoad: (item: SavedSlot) => void;
    onDelete: (item: SavedSlot) => void;
    onSaveToVault: (item: SavedSlot) => void;
    emptyText: string;
  }) => (
    <div className="otg-card" style={{ padding: 12 }}>
      <div className="otg-cardTitle" style={{ fontSize: 14 }}>{opts.title}</div>
      <div className="otg-help" style={{ marginTop: 6 }}>Two rolling temp slots only. New results overwrite slot 1, then slot 2, then repeat. Use Save to Vault to keep a model permanently.</div>

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {opts.items.length ? (
          opts.items.map((item, index) => (
            <div
              key={item.id}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto auto auto",
                gap: 8,
                alignItems: "center",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                padding: 10,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{`Slot ${index + 1}`}</div>
                <div className="otg-help" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.ext || "3D file"} · {item.previewSupported ? "viewer-ready" : "file-only"}
                </div>
              </div>
              <button type="button" className="otg-btnGhost" onClick={() => opts.onLoad(item)} style={{ borderRadius: 999, padding: "8px 12px" }}>
                Load
              </button>
              <button type="button" className="otg-btnGhost" onClick={() => opts.onSaveToVault(item)} style={{ borderRadius: 999, padding: "8px 12px" }}>
                Save to Vault
              </button>
              <button type="button" className="otg-btnGhost" onClick={() => opts.onDelete(item)} style={{ borderRadius: 999, padding: "8px 12px" }}>
                Delete
              </button>
            </div>
          ))
        ) : (
          <div className="otg-help">{opts.emptyText}</div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="otg-card" style={{ padding: 16 }}>
        <div className="otg-cardTitle">Angles is now split into Camera, 3D Mesh, 3D Model, and Trellis 2</div>
        <div className="otg-help" style={{ marginTop: 6 }}>
          Upload one image and reuse it across every Angles mode. Camera stays the default tab. Mesh and Model now reuse the same OTG multi-angle control under the preview.
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
          disabled={busy || meshBusy || meshBlenderBusy || modelBusy}
          style={{ display: "none" }}
        />

        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="otg-btnGhost"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || meshBusy || meshBlenderBusy || modelBusy}
            style={{ borderRadius: 999, padding: "10px 14px" }}
          >
            Choose image
          </button>
          <div className="otg-help" style={{ marginTop: 0, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file?.name || "No file chosen"}
          </div>
          <EndpointBadge label="Mesh target: 100.109.254.63:8188" />
          <EndpointBadge label="SPAR3D wrapper: 100.109.254.63:7861" />
          <EndpointBadge label="Angle assist: 127.0.0.1:8288" />
          <button
            type="button"
            className="otg-btnGhost"
            onClick={() => setVaultOpen(true)}
            style={{ borderRadius: 999, padding: "10px 14px", display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <span aria-hidden="true">🏦</span>
            Vault
          </button>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["camera", "mesh", "model", "trellis"] as AnglesTab[]).map((tabId) => {
            const active = activeTab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                className={active ? "otg-btnPrimary" : "otg-btnGhost"}
                onClick={() => setActiveTab(tabId)}
                style={{ borderRadius: 999, padding: "10px 14px" }}
              >
                {TAB_META[tabId].label}
              </button>
            );
          })}
        </div>
        <div className="otg-help" style={{ marginTop: 10 }}>{TAB_META[activeTab].help}</div>

        {activeTab === "camera" ? (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 14 }}>
            <div className="otg-card" style={{ padding: 12 }}>
              <div className="otg-cardTitle" style={{ fontSize: 14 }}>Input Image</div>
              {imagePreviewUrl ? (
                <div style={{ ...sharedInputStageStyle, minHeight: 520 }}>
                  <img src={imagePreviewUrl} alt="input" draggable={false} style={sharedInputImageStyle} />
                </div>
              ) : (
                <div className="otg-help" style={{ marginTop: 10 }}>Upload an image to start using the Angles camera controls.</div>
              )}
            </div>

            <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
              <OtgMultiAngleControl
                horizontal={horizontal}
                vertical={vertical}
                zoom={zoom}
                disabled={busy}
                onHorizontalChange={setHorizontal}
                onVerticalChange={setVertical}
                onZoomChange={setZoom}
                onReset={resetPosition}
                title="Qwen-style Multi-Angle Camera"
                showHelperText={false}
                showPromptText={false}
                showGestureHint={false}
              />

              <div className="otg-card" style={{ padding: 12 }}>
                <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                  <button type="button" className="otg-btnPrimary" onClick={handleCreate} disabled={busy} style={{ flex: 1 }}>
                    {busy ? "Creating..." : "Create"}
                  </button>
                  <button type="button" className="otg-btnGhost" onClick={clearAll} disabled={busy || meshBusy || meshBlenderBusy || modelBusy}>
                    Clear
                  </button>
                </div>
                {msg ? <div className="otg-help" style={{ marginTop: 10 }}>{msg}</div> : null}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "mesh" ? (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            {viewerAndControls({
              title: "3D Mesh Preview",
              modelUrl: activeMeshModelUrl,
              busyState: meshBusy || meshBlenderBusy,
              statusText: meshMsg,
              previewSupported: !!activeMeshModelUrl && canPreviewInModelViewer(activeMeshModelUrl),
              headerControls: (
                <div
                  style={{
                    display: "inline-flex",
                    padding: 4,
                    gap: 4,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <button
                    type="button"
                    className={meshViewMode === "mesh" ? "otg-btnPrimary" : "otg-btnGhost"}
                    onClick={() => handleMeshViewModeChange("mesh")}
                    style={{ borderRadius: 999, padding: "8px 12px" }}
                  >
                    Mesh
                  </button>
                  <button
                    type="button"
                    className={meshViewMode === "texture" ? "otg-btnPrimary" : "otg-btnGhost"}
                    onClick={() => handleMeshViewModeChange("texture")}
                    style={{ borderRadius: 999, padding: "8px 12px" }}
                  >
                    Texture
                  </button>
                </div>
              ),
            })}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
              <div className="otg-card" style={{ padding: 12 }}>
                <div className="otg-cardTitle" style={{ fontSize: 14 }}>Mesh Job</div>

                {imagePreviewUrl ? (
                  <div style={sharedInputStageStyle}>
                    <img src={imagePreviewUrl} alt="mesh input" draggable={false} style={sharedInputImageStyle} />
                  </div>
                ) : (
                  <div className="otg-help" style={{ marginTop: 10 }}>Upload an image before generating a mesh preview.</div>
                )}

                <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button type="button" className="otg-btnPrimary" onClick={handleGenerateMesh} disabled={!file || meshBusy || meshBlenderBusy} style={{ flex: 1 }}>
                      {meshBusy ? "Generating Mesh..." : "Generate Mesh"}
                    </button>
                    <button
                      type="button"
                      className="otg-btnGhost"
                      onClick={handleSendMeshToBlender}
                      disabled={!meshModelUrl || !meshJobId || meshBusy || meshBlenderBusy}
                      style={{ borderRadius: 999, padding: "10px 14px" }}
                    >
                      {meshBlenderBusy ? "Sending to Blender..." : "Send to Blender"}
                    </button>
                    <button type="button" className="otg-btnGhost" onClick={clearAll} disabled={busy || meshBusy || meshBlenderBusy || modelBusy}>
                      Clear
                    </button>
                  </div>
                  <div className="otg-help">
                    Mesh keeps the original GLB. Texture becomes available after Blender returns the textured GLB for this current mesh job.
                  </div>
                  <div className="otg-help">
                    Angle assist ({meshAssistStatus}): {meshAssistMsg || "Waiting for image upload."}
                  </div>
                </div>
              </div>

              {savedSlotsRail({
                title: "Saved Meshes",
                items: meshSlots,
                onLoad: (item) => {
                  setMeshModelUrl(item.modelUrl);
                  setMeshJobId("");
                  setMeshTexturedModelUrl("");
                  setMeshViewMode("mesh");
                  setMeshAssistUploadId("");
                  setMeshAssistStatus("idle");
                  setMeshAssistMsg("");
                  setMeshMsg("Loaded saved mesh slot. Generate a fresh mesh before sending to Blender.");
                  setActiveTab("mesh");
                },
                onDelete: (item) => {
                  setMeshSlots((prev) => prev.filter((slot) => slot.id !== item.id));
                  if (meshModelUrl === item.modelUrl) {
                    setMeshModelUrl("");
                    setMeshJobId("");
                    setMeshTexturedModelUrl("");
                    setMeshViewMode("mesh");
                    setMeshAssistUploadId("");
                    setMeshAssistStatus("idle");
                    setMeshAssistMsg("");
                  }
                },
                onSaveToVault: openVaultSave,
                emptyText: "No saved mesh results yet. Generate a mesh to fill slot 1, then slot 2.",
              })}
            </div>
          </div>
        ) : null}

        {activeTab === "model" ? (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            {viewerAndControls({
              title: "3D Model Result",
              modelUrl: model3dUrl,
              busyState: modelBusy,
              statusText: modelMsg,
              previewSupported: model3dPreviewSupported,
            })}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
              <div className="otg-card" style={{ padding: 12 }}>
                <div className="otg-cardTitle" style={{ fontSize: 14 }}>SPAR3D Job</div>

                {imagePreviewUrl ? (
                  <div style={sharedInputStageStyle}>
                    <img src={imagePreviewUrl} alt="spar3d input" draggable={false} style={sharedInputImageStyle} />
                  </div>
                ) : (
                  <div className="otg-help" style={{ marginTop: 10 }}>Upload an image before generating a 3D model.</div>
                )}

                {model3dUrl && !model3dPreviewSupported ? (
                  <div style={{ marginTop: 12 }}>
                    <a href={model3dUrl} target="_blank" rel="noreferrer" className="otg-btnGhost" style={{ borderRadius: 999, padding: "10px 14px", textDecoration: "none", textAlign: "center", display: "inline-flex" }}>
                      Open generated model file
                    </a>
                  </div>
                ) : null}

                <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                  <button type="button" className="otg-btnPrimary" onClick={handleGenerateModel} disabled={!file || modelBusy} style={{ flex: 1 }}>
                    {modelBusy ? "Generating Model..." : "Generate 3D Model"}
                  </button>
                  <button type="button" className="otg-btnGhost" onClick={clearAll} disabled={busy || meshBusy || meshBlenderBusy || modelBusy}>
                    Clear
                  </button>
                </div>
              </div>

              {savedSlotsRail({
                title: "Saved Models",
                items: modelSlots,
                onLoad: (item) => {
                  setModel3dUrl(item.modelUrl);
                  setModel3dPreviewSupported(item.previewSupported);
                  setActiveTab("model");
                },
                onDelete: (item) => {
                  setModelSlots((prev) => prev.filter((slot) => slot.id !== item.id));
                  if (model3dUrl === item.modelUrl) {
                    setModel3dUrl("");
                    setModel3dPreviewSupported(false);
                  }
                },
                onSaveToVault: openVaultSave,
                emptyText: "No saved model results yet. Generate a model to fill slot 1, then slot 2.",
              })}
            </div>
          </div>
        ) : null}

        {activeTab === "trellis" ? (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 14, alignItems: "start" }}>
              <div className="otg-card" style={{ padding: 12 }}>
                <div className="otg-cardTitle" style={{ fontSize: 14 }}>Trellis 2 Result</div>
                <div style={{ ...sharedInputStageStyle, minHeight: 446 }}>
                  {imagePreviewUrl ? (
                    <img src={imagePreviewUrl} alt="trellis input" draggable={false} style={sharedInputImageStyle} />
                  ) : (
                    <div className="otg-help">Upload an image first. This same shared upload will be reused here when Trellis 2 is wired.</div>
                  )}
                </div>
              </div>

              <OtgMultiAngleControl
                horizontal={horizontal}
                vertical={vertical}
                zoom={zoom}
                disabled
                onHorizontalChange={setHorizontal}
                onVerticalChange={setVertical}
                onZoomChange={setZoom}
                onReset={resetPosition}
                title="OTG Multi-Angle Camera"
                showHelperText={false}
                showPromptText={false}
                showGestureHint={false}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
              <div className="otg-card" style={{ padding: 12 }}>
                <div className="otg-cardTitle" style={{ fontSize: 14 }}>Trellis 2 Job</div>
                <div className="otg-help" style={{ marginTop: 6 }}>
                  Still missing: Trellis 2 workflow JSON, the TEST backend target, output file type, and the OTG proxy route that should run it.
                </div>
                <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                  <button type="button" className="otg-btnPrimary" disabled style={{ flex: 1, opacity: 0.65 }}>
                    Generate Trellis 2
                  </button>
                  <button type="button" className="otg-btnGhost" onClick={clearAll} disabled={busy || meshBusy || meshBlenderBusy || modelBusy}>
                    Clear
                  </button>
                </div>
              </div>

              {savedSlotsRail({
                title: "Saved Trellis 2",
                items: trellisSlots,
                onLoad: () => {},
                onDelete: (item) => {
                  setTrellisSlots((prev) => prev.filter((slot) => slot.id !== item.id));
                },
                onSaveToVault: openVaultSave,
                emptyText: "No Trellis 2 results yet. Once the backend route exists, it will also cycle through two temp slots.",
              })}
            </div>
          </div>
        ) : null}

        {vaultOpen ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.72)",
              zIndex: 90,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
            onClick={() => {
              if (!vaultSaveBusy) {
                setVaultOpen(false);
                setVaultSaveTarget(null);
                setVaultSaveName("");
              }
            }}
          >
            <div
              className="otg-card"
              style={{ width: "min(1040px, 100%)", maxHeight: "85vh", overflow: "auto", padding: 16 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="otg-cardTitle">Vault</div>
                  <div className="otg-help" style={{ marginTop: 6 }}>Permanent storage for Mesh, 3D Model, and Trellis results. Saving requires a model name.</div>
                </div>
                <button type="button" className="otg-btnGhost" onClick={() => { setVaultOpen(false); setVaultSaveTarget(null); setVaultSaveName(""); }} style={{ borderRadius: 999, padding: "8px 12px" }}>Close</button>
              </div>

              {vaultSaveTarget ? (
                <div className="otg-card" style={{ padding: 12, marginTop: 14 }}>
                  <div className="otg-cardTitle" style={{ fontSize: 14 }}>Save to Vault</div>
                  <div className="otg-help" style={{ marginTop: 6 }}>Enter a name before saving this {vaultSaveTarget.kind === "model" ? "3D model" : vaultSaveTarget.kind} permanently.</div>
                  <input
                    type="text"
                    value={vaultSaveName}
                    onChange={(e) => setVaultSaveName(e.target.value)}
                    placeholder="Required model name"
                    style={{ width: "100%", marginTop: 10, borderRadius: 12, padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}
                    disabled={vaultSaveBusy}
                  />
                  <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                    <button type="button" className="otg-btnPrimary" onClick={submitVaultSave} disabled={vaultSaveBusy || !vaultSaveName.trim()}>{vaultSaveBusy ? "Saving..." : "Save to Vault"}</button>
                    <button type="button" className="otg-btnGhost" onClick={() => { if (!vaultSaveBusy) { setVaultSaveTarget(null); setVaultSaveName(""); } }}>Cancel</button>
                  </div>
                </div>
              ) : null}

              {vaultMsg ? <div className="otg-help" style={{ marginTop: 10 }}>{vaultMsg}</div> : null}

              <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
                {(["mesh", "model", "trellis"] as VaultKind[]).map((kind) => {
                  const items = vaultItems.filter((item) => item.kind === kind);
                  const title = kind === "mesh" ? "Mesh Vault" : kind === "model" ? "3D Model Vault" : "Trellis Vault";
                  return (
                    <div key={kind} className="otg-card" style={{ padding: 12 }}>
                      <div className="otg-cardTitle" style={{ fontSize: 14 }}>{title}</div>
                      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                        {items.length ? items.map((item) => (
                          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 8, alignItems: "center", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", padding: 10 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                              <div className="otg-help" style={{ marginTop: 4 }}>{item.ext || "3D file"} · {new Date(item.createdAt).toLocaleString()}</div>
                            </div>
                            <button type="button" className="otg-btnGhost" onClick={() => { if (kind === "mesh") { setMeshModelUrl(item.modelUrl); setActiveTab("mesh"); } else if (kind === "model") { setModel3dUrl(item.modelUrl); setModel3dPreviewSupported(item.previewSupported); setActiveTab("model"); } else { setActiveTab("trellis"); } setVaultOpen(false); }} style={{ borderRadius: 999, padding: "8px 12px" }}>Load</button>
                            <button type="button" className="otg-btnGhost" onClick={() => deleteVaultItem(item.id)} style={{ borderRadius: 999, padding: "8px 12px" }}>Delete</button>
                          </div>
                        )) : <div className="otg-help">No saved items yet.</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {showProgress ? (
          <div className="otg-card" style={{ marginTop: 14, padding: 12 }}>
            <div className="otg-cardTitle" style={{ fontSize: 14 }}>Progress</div>
            <div className="otg-help" style={{ marginTop: 6 }}>{progressMsg}</div>
            <div style={{ marginTop: 10, width: "100%", height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${progressPct}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #8b5cf6, #06b6d4)" }} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

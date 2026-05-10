"use client";

import * as React from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import OtgMultiAngleControl from "./OtgMultiAngleControl";
import AnglesDirectorCameraControl from "./AnglesDirectorCameraControl";

type AnglesTab = "camera" | "model" | "textures";
type ViewerLoadState = "idle" | "loading" | "loaded" | "error";
type AnglesImageResult = { label: string; url: string; filename?: string };
// OTG_ANGLES_GALLERY_PICKER: Gallery image picker for Angles Camera tab.
type AnglesGalleryImageItem = {
  name?: string;
  fileName?: string;
  filename?: string;
  sourceName?: string;
  title?: string;
  url?: string;
  imageUrl?: string;
  src?: string;
  kind?: string;
  meta?: {
    renamedName?: string | null;
    originalName?: string | null;
  };
  video?: boolean;
};

const TAB_META: Record<AnglesTab, { label: string; help: string }> = {
  camera: {
    label: "Camera",
    help: "Upload the source image here. Upload automatically starts the base Hunyuan 3D build on port 8080.",
  },
  model: {
    label: "3D Model",
    help: "Shows the base 3D model generated from the original uploaded image by Hunyuan 3D on port 8080.",
  },
  textures: {
    label: "Textures",
    help: "Shows the textured 3D model generated from the same image family through the Hunyuan 3D texturing pass on port 8080.",
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

function extractModelPathFromUrl(url: string) {
  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.searchParams.get("path") || parsed.pathname || url;
  } catch {
    return url;
  }
}

function modelExtFromUrl(url: string) {
  const target = extractModelPathFromUrl(url);
  const match = target.match(/\.([a-z0-9]+)$/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function canPreviewInViewer(url: string) {
  return /\.(glb|gltf)$/i.test(extractModelPathFromUrl(url));
}

// OTG_ANGLES_CLIENT_FRESH_IMAGE_URL_V2
function freshAnglesImageUrl(urlValue: string) {
  if (!urlValue) return "";
  const separator = urlValue.includes("?") ? "&" : "?";
  return urlValue + separator + "clientV=" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function normalizeAnglesImages(json: any): AnglesImageResult[] {
  const raw = Array.isArray(json?.images)
    ? json.images
    : Array.isArray(json?.imageFiles)
      ? json.imageFiles
      : Array.isArray(json?.outputs)
        ? json.outputs
        : [];

  return raw
    .map((item: any, index: number) => {
      if (typeof item === "string") {
        return { label: `Angle ${index + 1}`, url: freshAnglesImageUrl(item) };
      }
      const url = String(item?.url || item?.imageUrl || item?.src || item?.path || "");
      const label = String(item?.label || item?.title || item?.filename || `Angle ${index + 1}`);
      const filename = item?.filename ? String(item.filename) : undefined;
      return { label, url: freshAnglesImageUrl(url), filename };
    })
    .filter((item: AnglesImageResult) => item.url);
}


function anglesGalleryImageUrl(item: AnglesGalleryImageItem) {
  return String(item?.url || item?.imageUrl || item?.src || "");
}

function anglesGalleryImageName(item: AnglesGalleryImageItem) {
  const metaName = item?.meta?.renamedName || item?.meta?.originalName;
  return String(metaName || item?.sourceName || item?.fileName || item?.filename || item?.name || item?.title || "gallery-image.png");
}

function isAnglesGalleryImage(item: AnglesGalleryImageItem) {
  if (!item) return false;
  if (item.video === true) return false;
  const kind = String(item.kind || "").toLowerCase();
  if (kind === "video") return false;
  if (kind === "image") return true;
  const target = (anglesGalleryImageName(item) + " " + anglesGalleryImageUrl(item)).toLowerCase().split("?")[0];
  return /.(png|jpg|jpeg|webp|gif|bmp)$/i.test(target);
}

function safeAnglesGalleryImageFilename(item: AnglesGalleryImageItem) {
  const raw = anglesGalleryImageName(item).trim() || "gallery-image.png";
  const cleaned = raw.replace(/[\/:*?"<>|]+/g, "_");
  return /.(png|jpg|jpeg|webp|gif|bmp)$/i.test(cleaned) ? cleaned : cleaned + ".png";
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

export default function AnglesPanel() {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const viewerMountRef = React.useRef<HTMLDivElement | null>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<OrbitControls | null>(null);
  const mixerRef = React.useRef<THREE.AnimationMixer | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const clockRef = React.useRef(new THREE.Clock());
  const targetRef = React.useRef(new THREE.Vector3());
  const baseDistanceRef = React.useRef(3);
  const suppressSyncRef = React.useRef(false);
  const horizontalRef = React.useRef(0);
  const verticalRef = React.useRef(0);
  const zoomRef = React.useRef(0);

  const [activeTab, setActiveTab] = React.useState<AnglesTab>("camera");
  const [file, setFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState("");
  const [galleryPickerOpen, setGalleryPickerOpen] = React.useState(false);
  const [galleryPickerBusy, setGalleryPickerBusy] = React.useState(false);
  const [galleryPickerMsg, setGalleryPickerMsg] = React.useState("");
  const [galleryPickerItems, setGalleryPickerItems] = React.useState<AnglesGalleryImageItem[]>([]);

  const [anglesBusy, setAnglesBusy] = React.useState(false);
  const [anglesMsg, setAnglesMsg] = React.useState("Angles image pass: not started");
  const [anglesImages, setAnglesImages] = React.useState<AnglesImageResult[]>([]);

  const [horizontal, setHorizontal] = React.useState(0);
  const [vertical, setVertical] = React.useState(0);
  const [zoom, setZoom] = React.useState(0);

  const [baseBusy, setBaseBusy] = React.useState(false);
  const [baseMsg, setBaseMsg] = React.useState("Upload an image to begin.");
  const [baseJobId, setBaseJobId] = React.useState("");
  const [baseModelUrl, setBaseModelUrl] = React.useState("");
  const [basePreviewSupported, setBasePreviewSupported] = React.useState(false);

  const [textureBusy, setTextureBusy] = React.useState(false);
  const [textureMsg, setTextureMsg] = React.useState("Texture pass: not started");
  const [texturedModelUrl, setTexturedModelUrl] = React.useState("");
  const [texturedPreviewSupported, setTexturedPreviewSupported] = React.useState(false);

  const [viewerLoadState, setViewerLoadState] = React.useState<ViewerLoadState>("idle");
  const [viewerLoadMessage, setViewerLoadMessage] = React.useState("");

  const currentModelUrl = activeTab === "textures" ? texturedModelUrl : activeTab === "model" ? baseModelUrl : "";
  const currentPreviewSupported = activeTab === "textures" ? texturedPreviewSupported : basePreviewSupported;
  const [isMobileLayout, setIsMobileLayout] = React.useState(false);

  const panelGridTemplateColumns = isMobileLayout ? "1fr" : "1.05fr 0.95fr";
  const sourcePreviewHeight = isMobileLayout ? 320 : 520;
  const viewerStageHeight = isMobileLayout ? 300 : 420;
  const viewerShellHeight = isMobileLayout ? 324 : 446;

  React.useEffect(() => {
    const updateLayout = () => {
      setIsMobileLayout(window.innerWidth <= 900);
    };
    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  React.useEffect(() => {
    horizontalRef.current = horizontal;
    verticalRef.current = vertical;
    zoomRef.current = zoom;
  }, [horizontal, vertical, zoom]);

  React.useEffect(() => {
    if (!file) {
      setImagePreviewUrl((prev) => {
        if (prev) {
          try {
            URL.revokeObjectURL(prev);
          } catch {}
        }
        return "";
      });
      return;
    }

    const next = URL.createObjectURL(file);
    setImagePreviewUrl((prev) => {
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch {}
      }
      return next;
    });

    return () => {
      try {
        URL.revokeObjectURL(next);
      } catch {}
    };
  }, [file]);

  const disposeViewer = React.useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    try {
      controlsRef.current?.dispose();
    } catch {}
    controlsRef.current = null;
    try {
      mixerRef.current?.stopAllAction();
    } catch {}
    mixerRef.current = null;
    const renderer = rendererRef.current;
    if (renderer) {
      try {
        renderer.dispose();
      } catch {}
      try {
        renderer.domElement.remove();
      } catch {}
    }
    rendererRef.current = null;
    sceneRef.current = null;
    cameraRef.current = null;
    const mount = viewerMountRef.current;
    if (mount) mount.innerHTML = "";
  }, []);

  const syncStateFromCamera = React.useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    const target = targetRef.current;
    const offset = camera.position.clone().sub(target);
    const radius = Math.max(offset.length(), 0.0001);
    const theta = THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z));
    const phi = Math.acos(clamp(offset.y / radius, -1, 1));
    const verticalDeg = clamp(90 - THREE.MathUtils.radToDeg(phi), -30, 60);
    const zoomValue = clamp((1.8 - radius / Math.max(baseDistanceRef.current, 0.01)) / 0.12, -5, 5);

    suppressSyncRef.current = true;
    setHorizontal(clamp(Math.round(theta), -180, 180));
    setVertical(Math.round(verticalDeg));
    setZoom(Number(zoomValue.toFixed(2)));
    requestAnimationFrame(() => {
      suppressSyncRef.current = false;
    });
  }, []);

  const applyCameraFromState = React.useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!camera || !controls || !renderer || !scene) return;

    const target = targetRef.current.clone();
    const baseDistance = Math.max(baseDistanceRef.current, 0.5);
    const radius = Math.max(baseDistance * clamp(1.8 - zoomRef.current * 0.12, 0.7, 2.8), 0.35);
    const theta = THREE.MathUtils.degToRad(horizontalRef.current);
    const phi = THREE.MathUtils.degToRad(90 - clamp(verticalRef.current, -30, 60));
    const sinPhi = Math.sin(phi);
    const offset = new THREE.Vector3(
      radius * sinPhi * Math.sin(theta),
      radius * Math.cos(phi),
      radius * sinPhi * Math.cos(theta)
    );

    suppressSyncRef.current = true;
    controls.target.copy(target);
    camera.position.copy(target.clone().add(offset));
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(() => {
      suppressSyncRef.current = false;
    });
  }, []);

  React.useEffect(() => {
    if (viewerLoadState !== "loaded") return;
    if (suppressSyncRef.current) return;
    applyCameraFromState();
  }, [horizontal, vertical, zoom, viewerLoadState, applyCameraFromState]);

  React.useEffect(() => {
    if (!currentModelUrl) {
      disposeViewer();
      setViewerLoadState("idle");
      setViewerLoadMessage("");
      return;
    }
    if (!canPreviewInViewer(currentModelUrl)) {
      disposeViewer();
      setViewerLoadState("error");
      setViewerLoadMessage(`Preview is not supported for ${modelExtFromUrl(currentModelUrl) || "this file type"}.`);
      return;
    }

    const mount = viewerMountRef.current;
    if (!mount) return;

    disposeViewer();
    setViewerLoadState("loading");
    setViewerLoadMessage("Loading 3D model...");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);

    const width = Math.max(mount.clientWidth || 320, 320);
    const height = Math.max(mount.clientHeight || viewerStageHeight, 280);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight(0xffffff, 0x1e293b, 2.1);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(5, 6, 8);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x60a5fa, 1.1);
    fillLight.position.set(-5, 3, -4);
    scene.add(fillLight);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.9;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.75;
    controls.screenSpacePanning = true;
    controls.enablePan = true;
    controlsRef.current = controls;

    controls.addEventListener("change", () => {
      if (!suppressSyncRef.current) {
        syncStateFromCamera();
      }
    });

    let cancelled = false;
    const loader = new GLTFLoader();

    const animate = () => {
      if (cancelled) return;
      frameRef.current = requestAnimationFrame(animate);
      const delta = clockRef.current.getDelta();
      if (mixerRef.current) mixerRef.current.update(delta);
      controls.update();
      renderer.render(scene, camera);
    };

    loader.load(
      currentModelUrl,
      (gltf) => {
        if (cancelled) return;
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) {
          setViewerLoadState("error");
          setViewerLoadMessage("GLB loaded but no scene was found.");
          return;
        }

        root.traverse((obj: any) => {
          if (obj.isMesh) {
            obj.castShadow = false;
            obj.receiveShadow = false;
            if (obj.material) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach((m: any) => {
                  if (m) m.side = THREE.DoubleSide;
                });
              } else {
                obj.material.side = THREE.DoubleSide;
              }
            }
          }
        });

        scene.add(root);

        const box = new THREE.Box3().setFromObject(root);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) {
          sphere.center.set(0, 0, 0);
          sphere.radius = 1;
        }
        targetRef.current.copy(sphere.center);
        baseDistanceRef.current = Math.max(sphere.radius * 0.85, 0.8);
        controls.target.copy(sphere.center);
        camera.near = Math.max(sphere.radius / 100, 0.01);
        camera.far = Math.max(sphere.radius * 30, 100);
        camera.updateProjectionMatrix();

        if (gltf.animations?.length) {
          const mixer = new THREE.AnimationMixer(root);
          gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
          mixerRef.current = mixer;
        } else {
          mixerRef.current = null;
        }

        const onResize = () => {
          const mountEl = viewerMountRef.current;
          if (!mountEl || !rendererRef.current || !cameraRef.current || !sceneRef.current) return;
          const nextWidth = Math.max(mountEl.clientWidth || 640, 320);
          const nextHeight = Math.max(mountEl.clientHeight || viewerStageHeight, 280);
          rendererRef.current.setSize(nextWidth, nextHeight, false);
          cameraRef.current.aspect = nextWidth / nextHeight;
          cameraRef.current.updateProjectionMatrix();
        };
        window.addEventListener("resize", onResize);
        (renderer as any).__otg_onResize = onResize;

        setViewerLoadState("loaded");
        setViewerLoadMessage("Viewer connected to the current GLB.");
        applyCameraFromState();
        animate();
      },
      undefined,
      (error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load 3D model.";
        setViewerLoadState("error");
        setViewerLoadMessage(message);
      }
    );

    return () => {
      cancelled = true;
      const activeRenderer = rendererRef.current as any;
      if (activeRenderer?.__otg_onResize) {
        window.removeEventListener("resize", activeRenderer.__otg_onResize);
      }
      disposeViewer();
    };
  }, [currentModelUrl, disposeViewer, syncStateFromCamera, applyCameraFromState, viewerStageHeight]);

  const resetPosition = React.useCallback(() => {
    setHorizontal(0);
    setVertical(0);
    setZoom(0);
  }, []);

  const startTextureGeneration = React.useCallback(async (jobId: string, deviceId: string) => {
    setTextureBusy(true);
    setTextureMsg("Generating textured 3D model on Hunyuan 3D port 8080...");
    setTexturedModelUrl("");
    setTexturedPreviewSupported(false);
    try {
      const res = await fetch("/api/angles/model-3d-texture", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-device-id": deviceId,
        },
        body: JSON.stringify({ jobId }),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !json?.ok) throw new Error(json?.error || text || `Texture pass failed (${res.status})`);
      const nextTexturedUrl = String(json?.texturedModelUrl || json?.modelUrl || "");
      setTexturedModelUrl(nextTexturedUrl);
      setTexturedPreviewSupported(Boolean(json?.previewSupported));
      setTextureMsg("Texture pass: ready");
    } catch (error: any) {
      setTextureMsg(error?.message || "Texture pass failed.");
    } finally {
      setTextureBusy(false);
    }
  }, []);

  const startBaseGeneration = React.useCallback(
    async (selectedFile: File) => {
      const deviceId = getOrCreateDeviceId();
      setBaseBusy(true);
      setBaseMsg("Generating base 3D model on Hunyuan 3D port 8080...");
      setBaseJobId("");
      setBaseModelUrl("");
      setBasePreviewSupported(false);
      setTexturedModelUrl("");
      setTexturedPreviewSupported(false);
      setTextureMsg("Texture pass: queued after base model");
      try {
        const fd = new FormData();
        fd.append("image", selectedFile, selectedFile.name);
const res = await fetch("/api/angles/model-3d", {
          method: "POST",
          credentials: "include",
          headers: { "x-otg-device-id": deviceId },
          body: fd,
        });
        const text = await res.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        if (res.status === 401) {
          window.location.href = "/login?reason=session";
          return;
        }
        if (!res.ok || !json?.ok) throw new Error(json?.error || text || `Base model failed (${res.status})`);
        const nextJobId = String(json.jobId || "");
        setBaseJobId(nextJobId);
        setBaseModelUrl(String(json.modelUrl || ""));
        setBasePreviewSupported(Boolean(json.previewSupported));
        setBaseMsg("Base model: ready");
        if (nextJobId) {
          void startTextureGeneration(nextJobId, deviceId);
        }
      } catch (error: any) {
        setBaseMsg(error?.message || "Base model generation failed.");
        setTextureMsg("Texture pass: not started");
      } finally {
        setBaseBusy(false);
      }
    },
    [startTextureGeneration]
  );

  const handleCreateAnglesImage = React.useCallback(async () => {
    if (!file) {
      setAnglesMsg("Choose a source image before creating angle images.");
      return;
    }

    const deviceId = getOrCreateDeviceId();
    setAnglesBusy(true);
    setAnglesMsg("Submitting source image to ComfyUI angles workflow...");
    setAnglesImages([]);

    try {
      const fd = new FormData();
        fd.append("image", file, file.name);

        const angleHorizontal = ((Math.round(horizontalRef.current) % 360) + 360) % 360;
        const angleVertical = ((Math.round(verticalRef.current) % 360) + 360) % 360;
        const angleZoom = Math.max(1, Math.min(10, 5 + Number(zoomRef.current || 0)));

        fd.append("angleHorizontal", String(angleHorizontal));
        fd.append("angleVertical", String(angleVertical));
        fd.append("angleZoom", String(angleZoom));
        fd.append("angleDefaultPrompts", "true");
        fd.append("angleCameraView", "true");

        const res = await fetch("/api/angles/create-image", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": deviceId },
        body: fd,
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !json?.ok) throw new Error(json?.error || text || `Angles image failed (${res.status})`);

      const images = normalizeAnglesImages(json);
      setAnglesImages(images);
      setAnglesMsg(images.length ? `Angles image pass: ready (${images.length} images)` : "Angles image pass submitted, but no image URLs were returned.");
    } catch (error: any) {
      setAnglesMsg(error?.message || "Angles image pass failed.");
    } finally {
      setAnglesBusy(false);
    }
  }, [file]);

  const createAnglesImage = React.useCallback(async () => {
    if (!file) {
      setAnglesMsg("Choose an image before creating angles.");
      return;
    }

    const deviceId = getOrCreateDeviceId();
    const normalizedHorizontal = ((horizontal % 360) + 360) % 360;
    const normalizedZoom = Math.max(1, Math.min(10, 5 + zoom));

    setAnglesBusy(true);
    setAnglesMsg("Submitting current camera angle to ComfyUI...");
    setAnglesImages([]);

    try {
      const fd = new FormData();
        fd.append("image", file, file.name);

        const angleHorizontal = ((Math.round(horizontalRef.current) % 360) + 360) % 360;
        const angleVertical = ((Math.round(verticalRef.current) % 360) + 360) % 360;
        const angleZoom = Math.max(1, Math.min(10, 5 + Number(zoomRef.current || 0)));

        fd.append("angleHorizontal", String(angleHorizontal));
        fd.append("angleVertical", String(angleVertical));
        fd.append("angleZoom", String(angleZoom));
        fd.append("angleDefaultPrompts", "true");
        fd.append("angleCameraView", "true");

        const res = await fetch("/api/angles/create-image", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": deviceId },
        body: fd,
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || text || `Angles image workflow failed (${res.status})`);
      }

      const images = Array.isArray(json?.images)
        ? json.images
        : json?.imageUrl
          ? [{ label: "Camera Angle", url: freshAnglesImageUrl(json.imageUrl), filename: json?.remoteFile?.filename }]
          : [];

      setAnglesImages(images);
      setAnglesMsg(images.length ? "Angles image pass: ready (1 image from current camera angle)." : "Angles workflow finished but returned no image list.");
    } catch (error: any) {
      setAnglesMsg(error?.message || "Angles image workflow failed.");
    } finally {
      setAnglesBusy(false);
    }
  }, [file, horizontal, vertical, zoom]);

  const createBaseModel = React.useCallback(() => {
    if (!file || baseBusy || textureBusy) return;
    void startBaseGeneration(file);
  }, [file, baseBusy, textureBusy, startBaseGeneration]);

  const createTextureModel = React.useCallback(() => {
    if (!baseJobId || textureBusy || baseBusy) return;
    void startTextureGeneration(baseJobId, getOrCreateDeviceId());
  }, [baseJobId, textureBusy, baseBusy, startTextureGeneration]);
  const handleFilePicked = React.useCallback(
    (selectedFile: File | null) => {
      setFile(selectedFile);
      setAnglesImages([]);
      setAnglesMsg("Angles image pass: not started");
      setBaseJobId("");
      setBaseModelUrl("");
      setBasePreviewSupported(false);
      setTexturedModelUrl("");
      setTexturedPreviewSupported(false);
      setViewerLoadState("idle");
      setViewerLoadMessage("");
      resetPosition();
      setActiveTab("camera");
      if (!selectedFile) {
        setBaseMsg("Upload an image to begin.");
        setTextureMsg("Texture pass: not started");
        return;
      }
      void startBaseGeneration(selectedFile);
    },
    [resetPosition, startBaseGeneration]
  );



  const openAnglesGalleryPicker = React.useCallback(async () => {
    setGalleryPickerOpen(true);
    setGalleryPickerBusy(true);
    setGalleryPickerMsg("Loading Gallery images...");
    setGalleryPickerItems([]);

    const galleryUrls = [
      "/api/gallery?filter=images&sort=newest&per=5000",
      "/api/gallery?media=images&sort=newest&per=5000",
      "/api/gallery?filter=pictures&sort=newest&per=5000",
      "/api/gallery?sort=newest&per=5000",
    ];

    try {
      let lastError = "";
      let foundImages: AnglesGalleryImageItem[] = [];
      let totalSeen = 0;

      for (const galleryUrl of galleryUrls) {
        const res = await fetch(galleryUrl, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const text = await res.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        if (res.status === 401) {
          window.location.href = "/login?reason=session";
          return;
        }
        if (!res.ok || !json?.ok) {
          lastError = json?.error || text || "Gallery load failed (" + res.status + ")";
          continue;
        }

        const rawItems = Array.isArray(json.items) ? json.items : Array.isArray(json.files) ? json.files : [];
        totalSeen = Math.max(totalSeen, rawItems.length);
        foundImages = rawItems.filter(isAnglesGalleryImage);
        if (foundImages.length) break;
      }

      setGalleryPickerItems(foundImages);
      setGalleryPickerMsg(
        foundImages.length
          ? "Choose a Gallery image (" + foundImages.length + " available). Landscape and portrait images are supported."
          : totalSeen
            ? "Gallery loaded " + totalSeen + " items, but no image items matched. Open Gallery and confirm the items are images, not videos."
            : lastError || "No Gallery images were found."
      );
    } catch (error: any) {
      setGalleryPickerMsg(error?.message || "Gallery image picker failed.");
      setGalleryPickerItems([]);
    } finally {
      setGalleryPickerBusy(false);
    }
  }, []);

  const selectAnglesGalleryImage = React.useCallback(
    async (item: AnglesGalleryImageItem) => {
      const url = anglesGalleryImageUrl(item);
      if (!url) {
        setGalleryPickerMsg("Gallery item is missing an image URL.");
        return;
      }
      if (!isAnglesGalleryImage(item)) {
        setGalleryPickerMsg("Only Gallery images can be used in Angles.");
        return;
      }
      setGalleryPickerBusy(true);
      setGalleryPickerMsg("Loading selected Gallery image...");
      try {
        const res = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!res.ok) throw new Error("Gallery image download failed (" + res.status + ")");
        const blob = await res.blob();
        if (blob.type && !blob.type.toLowerCase().startsWith("image/")) {
          throw new Error("Selected Gallery item is not an image.");
        }
        const selected = new File([blob], safeAnglesGalleryImageFilename(item), { type: blob.type || "image/png" });
        handleFilePicked(selected);
        setGalleryPickerOpen(false);
        setGalleryPickerMsg("");
      } catch (error: any) {
        setGalleryPickerMsg(error?.message || "Failed to use Gallery image.");
      } finally {
        setGalleryPickerBusy(false);
      }
    },
    [handleFilePicked]
  );

  const clearAll = React.useCallback(() => {
    setFile(null);
    setAnglesBusy(false);
    setAnglesMsg("Angles image pass: not started");
    setAnglesImages([]);
    setBaseBusy(false);
    setBaseMsg("Upload an image to begin.");
    setBaseJobId("");
    setBaseModelUrl("");
    setBasePreviewSupported(false);
    setTextureBusy(false);
    setTextureMsg("Texture pass: not started");
    setTexturedModelUrl("");
    setTexturedPreviewSupported(false);
    setAnglesBusy(false);
    setAnglesMsg("Angles image pass: not started");
    setAnglesImages([]);
    setViewerLoadState("idle");
    setViewerLoadMessage("");
    resetPosition();
    setActiveTab("camera");
  }, [resetPosition]);

  const actionButtons = (
    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
      <button
        type="button"
        className="otg-btnPrimary"
        onClick={handleCreateAnglesImage}
        disabled={!file || anglesBusy}
        style={{ borderRadius: 999, padding: "10px 14px" }}
      >
        {anglesBusy ? "Submitting..." : "Create Angles Image"}
      </button>
      <button
        type="button"
        className="otg-btnGhost"
        onClick={() => file && void startBaseGeneration(file)}
        disabled={!file || baseBusy || textureBusy}
        style={{ borderRadius: 999, padding: "10px 14px" }}
      >
        {baseBusy ? "Creating 3D..." : "Create 3D Model"}
      </button>
      <button
        type="button"
        className="otg-btnGhost"
        onClick={() => baseJobId && void startTextureGeneration(baseJobId, getOrCreateDeviceId())}
        disabled={!baseJobId || baseBusy || textureBusy}
        style={{ borderRadius: 999, padding: "10px 14px" }}
      >
        {textureBusy ? "Creating Texture..." : "Create Texture Model"}
      </button>
      <button
        type="button"
        className="otg-btnGhost"
        onClick={() => setActiveTab("model")}
        disabled={!baseModelUrl}
        style={{ borderRadius: 999, padding: "10px 14px" }}
      >
        Open 3D Model
      </button>
      <button
        type="button"
        className="otg-btnGhost"
        onClick={() => setActiveTab("textures")}
        disabled={!baseJobId}
        style={{ borderRadius: 999, padding: "10px 14px" }}
      >
        Open Textures
      </button>
      <button
        type="button"
        className="otg-btnGhost"
        onClick={clearAll}
        disabled={baseBusy || textureBusy || anglesBusy}
        style={{ borderRadius: 999, padding: "10px 14px" }}
      >
        Clear
      </button>
    </div>
  );

  const anglesImagePreviewPanel = anglesImages.length ? (
    <div className="otg-card" style={{ padding: 12, marginTop: 12 }}>
      <div className="otg-cardTitle" style={{ fontSize: 14 }}>Generated Angle Images</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 10 }}>
        {anglesImages.map((image, index) => (
          <a
            key={`${image.url}-${index}`}
            href={image.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "grid",
              gap: 6,
              textDecoration: "none",
              color: "rgba(255,255,255,0.86)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: 8,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <img src={image.url} alt={image.label} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 10 }} />
            <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{image.label}</span>
          </a>
        ))}
      </div>
    </div>
  ) : null;

  const viewerPanel = (title: string, modelUrl: string, statusText: string, busyState: boolean) => (
    <div style={{ display: "grid", gridTemplateColumns: panelGridTemplateColumns, gap: 14, alignItems: "start" }}>
      <div className="otg-card" style={{ padding: 12 }}>
        <div className="otg-cardTitle" style={{ fontSize: 14 }}>{title}</div>
        <div
          style={{
            width: "100%",
            marginTop: 12,
            background: "rgba(255,255,255,0.03)",
            borderRadius: 16,
            padding: 12,
            overflow: "hidden",
            height: viewerShellHeight,
            maxHeight: viewerShellHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {modelUrl ? (
            <>
              <div ref={viewerMountRef} style={{ width: "100%", height: viewerStageHeight, borderRadius: 12, overflow: "hidden", maxWidth: "100%" }} />
              {viewerLoadState !== "loaded" ? (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", background: "rgba(2,6,23,0.28)" }}>
                  {viewerLoadMessage || "Loading 3D model..."}
                </div>
              ) : null}
            </>
          ) : (
            <div className="otg-muted">{busyState ? "Please wait..." : "No model available yet for this tab."}</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          <div className="otg-help">{statusText || viewerLoadMessage}</div>
          {modelUrl ? (
            <a href={modelUrl} target="_blank" rel="noreferrer" className="otg-btnGhost" style={{ borderRadius: 999, padding: "10px 14px", textDecoration: "none" }}>
              Open model file
            </a>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <div style={{ display: "grid", gap: 12 }}>
      <OtgMultiAngleControl
          horizontal={horizontal}
          vertical={vertical}
          zoom={zoom}
          disabled={busyState || !modelUrl || !currentPreviewSupported || viewerLoadState !== "loaded"}
          onHorizontalChange={setHorizontal}
          onVerticalChange={setVertical}
          onZoomChange={setZoom}
          onReset={resetPosition}
                imageUrl={imagePreviewUrl}
          title="OTG Multi-Angle Camera"
          showHelperText={false}
          showPromptText={false}
          showGestureHint={false}
        />
        <div className="otg-card" style={{ padding: 12 }}>
          <button
            type="button"
            className="otg-btnPrimary"
            onClick={createAnglesImage}
            disabled={!file || anglesBusy}
            style={{ borderRadius: 999, padding: "10px 14px", width: "100%" }}
          >
            {anglesBusy ? "Creating angle image..." : "Create Angles Image"}
          </button>
          <div className="otg-help" style={{ marginTop: 8 }}>
            Render the current camera view as one image. Spin the model first, then create the angle image.
          </div>
        </div>
      </div>
        <div className="otg-card" style={{ padding: 12 }}>
          <div className="otg-cardTitle" style={{ fontSize: 14 }}>Angles Actions</div>
          <div className="otg-help" style={{ marginTop: 8 }}>{anglesMsg}</div>
          {actionButtons}
        </div>
        {anglesImagePreviewPanel}
      </div>
    </div>
  );



  const anglesGalleryPickerModal = galleryPickerOpen ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose Gallery image for Angles"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
      onClick={() => !galleryPickerBusy && setGalleryPickerOpen(false)}
    >
      <div
        className="otg-card"
        style={{ width: "min(980px, 96vw)", maxHeight: "86vh", overflow: "hidden", padding: 16, display: "grid", gap: 12 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="otg-cardTitle" style={{ fontSize: 16 }}>Choose Image from Gallery</div>
            <div className="otg-help" style={{ marginTop: 6 }}>
              Images only. Landscape and portrait images are supported for the Angles source image.
            </div>
          </div>
          <button
            type="button"
            className="otg-btnGhost"
            onClick={() => setGalleryPickerOpen(false)}
            disabled={galleryPickerBusy}
            style={{ borderRadius: 999, padding: "10px 14px" }}
          >
            Close
          </button>
        </div>
        <div className="otg-help">{galleryPickerMsg}</div>
        <div
          style={{
            overflow: "auto",
            maxHeight: "64vh",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 12,
            paddingRight: 4,
          }}
        >
          {galleryPickerItems.map((item, index) => {
            const url = anglesGalleryImageUrl(item);
            const name = anglesGalleryImageName(item);
            return (
              <button
                key={url + "-" + index}
                type="button"
                className="otg-btnGhost"
                onClick={() => selectAnglesGalleryImage(item)}
                disabled={galleryPickerBusy}
                style={{
                  textAlign: "left",
                  borderRadius: 16,
                  padding: 8,
                  display: "grid",
                  gap: 8,
                  alignContent: "start",
                  minHeight: 188,
                }}
                title={"Use " + name}
              >
                <img
                  src={url}
                  alt={name}
                  loading="lazy"
                  style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 12, background: "rgba(255,255,255,0.06)" }}
                />
                <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.88)" }}>
                  {name}
                </span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.58)" }}>Use this image</span>
              </button>
            );
          })}
          {!galleryPickerBusy && !galleryPickerItems.length ? (
            <div className="otg-help" style={{ gridColumn: "1 / -1", padding: 14 }}>
              No Gallery images are available.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;


  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
      {anglesGalleryPickerModal}
      <div className="otg-card" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <EndpointBadge label="Hunyuan 3D / hy3dgen: 127.0.0.1:8080" />
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["camera", "model", "textures"] as AnglesTab[]).map((tabId) => {
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

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
          disabled={baseBusy || textureBusy || anglesBusy}
          style={{ display: "none" }}
        />

        {activeTab === "camera" ? (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: panelGridTemplateColumns, gap: 14, alignItems: "start" }}>
            <div className="otg-card" style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div className="otg-cardTitle" style={{ fontSize: 14 }}>Camera Source Image</div>
                <button
                  type="button"
                  className="otg-btnGhost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={baseBusy || textureBusy || anglesBusy}
                  style={{ borderRadius: 999, padding: "10px 14px" }}
                >
                  Choose image
                </button>
                <button
                  type="button"
                  className="otg-btnGhost"
                  onClick={openAnglesGalleryPicker}
                  disabled={baseBusy || textureBusy || anglesBusy}
                  style={{ borderRadius: 999, padding: "10px 14px" }}
                >
                  Gallery
                </button>
              </div>
              <div className="otg-help" style={{ marginTop: 8, maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {file?.name || "No file chosen"}
              </div>
              <div
                style={{
                  width: "100%",
                  marginTop: 12,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 16,
                  padding: 12,
                  overflow: "hidden",
                  height: sourcePreviewHeight,
                  maxHeight: sourcePreviewHeight,
                  position: "relative",
                }}
              >
                {imagePreviewUrl ? (
                  <img src={imagePreviewUrl} alt="source" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", height: "auto", objectFit: "contain", userSelect: "none" }} />
                ) : (
                  <div className="otg-help">Upload an image to start the base Hunyuan 3D build.</div>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
              <AnglesDirectorCameraControl
                horizontal={horizontal}
                vertical={vertical}
                zoom={zoom}
                disabled={!file || baseBusy}
                onHorizontalChange={setHorizontal}
                onVerticalChange={setVertical}
                onZoomChange={setZoom}
                onReset={resetPosition}
                imageUrl={imagePreviewUrl}
              />
              <div className="otg-card" style={{ padding: 12 }}>
                <div className="otg-cardTitle" style={{ fontSize: 14 }}>Current Job Status</div>
                <div className="otg-help" style={{ marginTop: 10 }}>{baseMsg}</div>
                <div className="otg-help" style={{ marginTop: 6 }}>{textureMsg}</div>
                <div className="otg-help" style={{ marginTop: 6 }}>{anglesMsg}</div>
                {baseJobId ? <div className="otg-help" style={{ marginTop: 6 }}>Job ID: {baseJobId}</div> : null}
                {actionButtons}
              </div>
              {anglesImagePreviewPanel}
            </div>
          </div>
        ) : null}

        {activeTab === "model" ? (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            {viewerPanel("3D Model Result", baseModelUrl, baseMsg, baseBusy)}
          </div>
        ) : null}

        {activeTab === "textures" ? (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            {viewerPanel("Textures Result", texturedModelUrl, textureMsg, textureBusy)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

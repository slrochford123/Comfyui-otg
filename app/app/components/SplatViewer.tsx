"use client";

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type SplatCameraState = {
  horizontal: number;
  vertical: number;
  zoom: number;
};

type SplatViewerProps = {
  modelUrl: string;
  height?: number;
  horizontal: number;
  vertical: number;
  zoom: number;
  disabled?: boolean;
  onCameraChange?: (state: SplatCameraState) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
};

const DEFAULT_SPZ_ROTATION_Z_DEG = 180;
const DEFAULT_SPZ_FRONT_YAW_OFFSET_DEG = -90;

const VERTICAL_MIN = -30;
const VERTICAL_MAX = 60;
const ZOOM_MIN = -4;
const ZOOM_MAX = 5;

const DEFAULT_TARGET = new THREE.Vector3(0, 0.65, 0);
const DEFAULT_MODEL_SIZE = 1.75;

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function normalizeDegrees(value: number) {
  if (!Number.isFinite(value)) return 0;
  let next = value % 360;
  if (next > 180) next -= 360;
  if (next < -180) next += 360;
  return Math.round(next * 10) / 10;
}

function round1(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function getSafeBounds(object: THREE.Object3D) {
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  box.getCenter(center);
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const centerOk =
    Number.isFinite(center.x) &&
    Number.isFinite(center.y) &&
    Number.isFinite(center.z) &&
    Math.abs(center.x) <= 5 &&
    Math.abs(center.y) <= 5 &&
    Math.abs(center.z) <= 5;

  const sizeOk =
    Number.isFinite(maxDim) &&
    maxDim >= 0.05 &&
    maxDim <= 10;

  if (!centerOk || !sizeOk) {
    return null;
  }

  return {
    center,
    maxDim: clamp(maxDim, 0.8, 4),
  };
}

export default function SplatViewer({
  modelUrl,
  height = 420,
  horizontal,
  vertical,
  zoom,
  disabled = false,
  onCameraChange,
  onReady,
  onError,
}: SplatViewerProps) {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<OrbitControls | null>(null);
  const splatRef = React.useRef<THREE.Object3D | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const timeoutRefs = React.useRef<number[]>([]);

  const targetRef = React.useRef(DEFAULT_TARGET.clone());
  const modelSizeRef = React.useRef(DEFAULT_MODEL_SIZE);
  const cameraPropsRef = React.useRef<SplatCameraState>({ horizontal, vertical, zoom });
  const interactingRef = React.useRef(false);

  const onCameraChangeRef = React.useRef<typeof onCameraChange>(onCameraChange);
  const onReadyRef = React.useRef<typeof onReady>(onReady);
  const onErrorRef = React.useRef<typeof onError>(onError);

  const [state, setState] = React.useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  React.useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  React.useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const clearTimeouts = React.useCallback(() => {
    for (const id of timeoutRefs.current) {
      window.clearTimeout(id);
    }
    timeoutRefs.current = [];
  }, []);

  const configureControlsBounds = React.useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const modelSize = clamp(modelSizeRef.current, 0.8, 4);

    controls.enablePan = false;
    controls.enableZoom = !disabled;
    controls.enableRotate = !disabled;

    controls.minDistance = modelSize * 1.45;
    controls.maxDistance = modelSize * 7.0;

    controls.minPolarAngle = THREE.MathUtils.degToRad(90 - VERTICAL_MAX);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(90 - VERTICAL_MIN);
  }, [disabled]);

  const applyCamera = React.useCallback((force = false) => {
    if (interactingRef.current && !force) return;

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;

    if (!camera || !controls || !renderer || !scene) return;

    const nextHorizontal = normalizeDegrees(cameraPropsRef.current.horizontal);
    const nextVertical = clamp(cameraPropsRef.current.vertical, VERTICAL_MIN, VERTICAL_MAX);
    const nextZoom = clamp(cameraPropsRef.current.zoom, ZOOM_MIN, ZOOM_MAX);

    cameraPropsRef.current = {
      horizontal: nextHorizontal,
      vertical: nextVertical,
      zoom: nextZoom,
    };

    const modelSize = clamp(modelSizeRef.current, 0.8, 4);
    const target = targetRef.current.clone();

    const baseRadius = modelSize * 3.2;
    const radius = clamp(baseRadius - nextZoom * modelSize * 0.18, modelSize * 1.45, modelSize * 7.0);

    const theta = THREE.MathUtils.degToRad(nextHorizontal + DEFAULT_SPZ_FRONT_YAW_OFFSET_DEG);
    const phi = THREE.MathUtils.degToRad(90 - nextVertical);
    const sinPhi = Math.sin(phi);

    camera.position.set(
      target.x + radius * sinPhi * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * sinPhi * Math.cos(theta)
    );

    camera.near = 0.01;
    camera.far = 1000;
    camera.updateProjectionMatrix();

    controls.target.copy(target);
    configureControlsBounds();
    controls.update();

    renderer.render(scene, camera);
  }, [configureControlsBounds]);

  const emitCameraChange = React.useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    const modelSize = clamp(modelSizeRef.current, 0.8, 4);
    const target = targetRef.current;

    const offset = camera.position.clone().sub(target);
    const radius = Math.max(offset.length(), 0.001);
    const theta = Math.atan2(offset.x, offset.z);
    const phi = Math.acos(clamp(offset.y / radius, -1, 1));

    const baseRadius = modelSize * 3.2;

    const nextHorizontal = normalizeDegrees(THREE.MathUtils.radToDeg(theta) - DEFAULT_SPZ_FRONT_YAW_OFFSET_DEG);
    const nextVertical = round1(clamp(90 - THREE.MathUtils.radToDeg(phi), VERTICAL_MIN, VERTICAL_MAX));
    const nextZoom = round1(clamp((baseRadius - radius) / (modelSize * 0.18), ZOOM_MIN, ZOOM_MAX));

    cameraPropsRef.current = {
      horizontal: nextHorizontal,
      vertical: nextVertical,
      zoom: nextZoom,
    };

    onCameraChangeRef.current?.(cameraPropsRef.current);
  }, []);

  const frameLoadedSplat = React.useCallback(() => {
    const splat = splatRef.current;

    targetRef.current.copy(DEFAULT_TARGET);
    modelSizeRef.current = DEFAULT_MODEL_SIZE;

    if (splat) {
      const bounds = getSafeBounds(splat);
      if (bounds) {
        targetRef.current.copy(bounds.center);
        modelSizeRef.current = bounds.maxDim;
      }
    }

    const scene = sceneRef.current;
    if (scene) {
      const oldGrid = scene.getObjectByName("otg-spz-grid");
      if (oldGrid) scene.remove(oldGrid);

      const modelSize = clamp(modelSizeRef.current, 0.8, 4);
      const grid = new THREE.GridHelper(Math.max(4, modelSize * 2.6), 8, 0x1f2937, 0x111827);
      grid.name = "otg-spz-grid";
      grid.position.y = targetRef.current.y - Math.max(1.15, modelSize * 0.72);
      scene.add(grid);
    }

    applyCamera(true);
  }, [applyCamera]);

  const forceShowModel = React.useCallback(() => {
    // OTG_FORCE_SHOW_SPZ_MODEL_BUTTON
    // Manual recovery for refresh/rehydration cases where Spark has the SPZ but the camera did not frame it.
    if (!splatRef.current) {
      setState("loading");
      setMessage("SPZ model is still loading...");
      return;
    }

    interactingRef.current = false;

    cameraPropsRef.current = {
      horizontal: 0,
      vertical: 0,
      zoom: 0,
    };

    onCameraChangeRef.current?.({
      horizontal: 0,
      vertical: 0,
      zoom: 0,
    });

    frameLoadedSplat();
    applyCamera(true);

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }

    setState("loaded");
    setMessage("SPZ splat viewer ready.");
  }, [applyCamera, frameLoadedSplat]);

  React.useEffect(() => {
    cameraPropsRef.current = {
      horizontal: normalizeDegrees(horizontal),
      vertical: clamp(vertical, VERTICAL_MIN, VERTICAL_MAX),
      zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX),
    };

    applyCamera();
  }, [horizontal, vertical, zoom, applyCamera]);

  React.useEffect(() => {
    configureControlsBounds();
  }, [configureControlsBounds]);

  React.useEffect(() => {
    if (!modelUrl) {
      setState("idle");
      setMessage("");
      return;
    }

    let cancelled = false;

    async function boot() {
      const mount = mountRef.current;
      if (!mount) return;

      setState("loading");
      setMessage("Loading SPZ splat model...");

      clearTimeouts();

      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      try {
        controlsRef.current?.dispose();
      } catch {}

      try {
        const oldRenderer = rendererRef.current as any;
        if (oldRenderer?.__otg_dispose_controls) {
          oldRenderer.__otg_dispose_controls();
        }
        rendererRef.current?.dispose();
        rendererRef.current?.domElement.remove();
      } catch {}

      controlsRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      splatRef.current = null;

      targetRef.current.copy(DEFAULT_TARGET);
      modelSizeRef.current = DEFAULT_MODEL_SIZE;
      cameraPropsRef.current = {
        horizontal: 0,
        vertical: 0,
        zoom: 0,
      };

      mount.innerHTML = "";

      try {
        const sparkModule: any = await import("@sparkjsdev/spark");
        const SparkRenderer = sparkModule.SparkRenderer;
        const SplatMesh = sparkModule.SplatMesh;

        if (!SparkRenderer || !SplatMesh) {
          throw new Error("@sparkjsdev/spark did not expose SparkRenderer/SplatMesh.");
        }

        const width = Math.max(mount.clientWidth || 320, 320);
        const nextHeight = Math.max(height || mount.clientHeight || 420, 280);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x020617);

        const camera = new THREE.PerspectiveCamera(45, width / nextHeight, 0.01, 1000);

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
        });

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, nextHeight, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.display = "block";
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        mount.appendChild(renderer.domElement);

        const spark = new SparkRenderer({ renderer });
        scene.add(spark);

        sceneRef.current = scene;
        cameraRef.current = camera;
        rendererRef.current = renderer;

        let loaded = false;

        const handleSplatLoaded = () => {
          if (cancelled) return;

          loaded = true;
          frameLoadedSplat();

          setState("loaded");
          setMessage("SPZ splat viewer ready.");
          onReadyRef.current?.();

          for (const delay of [100, 350, 800]) {
            const id = window.setTimeout(() => {
              if (!cancelled) frameLoadedSplat();
            }, delay);
            timeoutRefs.current.push(id);
          }
        };

        const splat = new SplatMesh({
          url: modelUrl,
          onProgress: (event: ProgressEvent) => {
            if (cancelled || loaded) return;
            if (event.lengthComputable && event.total > 0) {
              const pct = Math.round((event.loaded / event.total) * 100);
              setMessage(`Loading SPZ splat model... ${pct}%`);
            } else {
              setMessage("Loading SPZ splat model...");
            }
          },
          onLoad: () => {
            handleSplatLoaded();
          },
        }) as THREE.Object3D & { initialized?: Promise<unknown>; isInitialized?: boolean; dispose?: () => void };

        splat.position.set(0, 0, 0);
        splat.rotation.z = THREE.MathUtils.degToRad(DEFAULT_SPZ_ROTATION_Z_DEG);
        splat.updateMatrixWorld(true);

        splatRef.current = splat;
        scene.add(splat);

        if (splat.initialized && typeof splat.initialized.then === "function") {
          splat.initialized.then(() => {
            handleSplatLoaded();
          }).catch((error: any) => {
            const text = error?.message || "Spark failed to initialize SPZ splat model.";
            if (!cancelled) {
              setState("error");
              setMessage(text);
              onErrorRef.current?.(text);
            }
          });
        }

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = false;
        controls.enableZoom = !disabled;
        controls.enableRotate = !disabled;
        controls.rotateSpeed = 0.85;
        controls.zoomSpeed = 0.9;

        controlsRef.current = controls;
        configureControlsBounds();

        const handleStart = () => {
          interactingRef.current = true;
          controls.target.copy(targetRef.current);
          controls.enablePan = false;
        };

        const handleChange = () => {
          controls.target.copy(targetRef.current);
          controls.enablePan = false;
          emitCameraChange();
        };

        const handleEnd = () => {
          interactingRef.current = false;
          controls.target.copy(targetRef.current);
          controls.enablePan = false;
          emitCameraChange();
          applyCamera(true);
        };

        controls.addEventListener("start", handleStart);
        controls.addEventListener("change", handleChange);
        controls.addEventListener("end", handleEnd);

        const resize = () => {
          const host = mountRef.current;
          const activeRenderer = rendererRef.current;
          const activeCamera = cameraRef.current;
          if (!host || !activeRenderer || !activeCamera) return;

          const w = Math.max(host.clientWidth || 320, 320);
          const h = Math.max(height || host.clientHeight || 420, 280);
          activeRenderer.setSize(w, h, false);
          activeCamera.aspect = w / h;
          activeCamera.updateProjectionMatrix();
          applyCamera(true);
        };

        window.addEventListener("resize", resize);

        const animate = () => {
          if (cancelled) return;

          frameRef.current = requestAnimationFrame(animate);

          controls.target.copy(targetRef.current);
          controls.enablePan = false;
          controls.update();

          renderer.render(scene, camera);
        };

        applyCamera(true);
        animate();

        const stillLoadingId = window.setTimeout(() => {
          if (!cancelled && !loaded) {
            setMessage("Still loading SPZ splat model...");
          }
        }, 8000);
        timeoutRefs.current.push(stillLoadingId);

        (renderer as any).__otg_resize = resize;
        (renderer as any).__otg_dispose_controls = () => {
          window.removeEventListener("resize", resize);
          controls.removeEventListener("start", handleStart);
          controls.removeEventListener("change", handleChange);
          controls.removeEventListener("end", handleEnd);
        };
      } catch (error: any) {
        const text = error?.message || "Failed to load SPZ splat model.";
        if (!cancelled) {
          setState("error");
          setMessage(text);
          onErrorRef.current?.(text);
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      interactingRef.current = false;

      clearTimeouts();

      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      const renderer = rendererRef.current as any;
      if (renderer?.__otg_dispose_controls) {
        renderer.__otg_dispose_controls();
      }

      try {
        controlsRef.current?.dispose();
      } catch {}

      try {
        const splat = splatRef.current as any;
        if (splat?.dispose) splat.dispose();
      } catch {}

      try {
        rendererRef.current?.dispose();
        rendererRef.current?.domElement.remove();
      } catch {}

      controlsRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      splatRef.current = null;

      const mount = mountRef.current;
      if (mount) mount.innerHTML = "";
    };
  }, [
    modelUrl,
    height,
    clearTimeouts,
    configureControlsBounds,
    frameLoadedSplat,
    applyCamera,
    emitCameraChange,
    disabled,
  ]);

  return (
    <div style={{ width: "100%", height, position: "relative", borderRadius: 12, overflow: "hidden", background: "#020617" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      {modelUrl ? (
        <button
          type="button"
          onClick={forceShowModel}
          disabled={disabled}
          title="Force the SPZ model to reframe and render"
          style={{
            position: "absolute",
            right: 10,
            top: 10,
            zIndex: 6,
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 999,
            background: "rgba(15,23,42,0.82)",
            color: "rgba(255,255,255,0.92)",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 12,
            fontWeight: 700,
            padding: "7px 12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          Show Model
        </button>
      ) : null}

      {state !== "loaded" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 16,
            color: "rgba(255,255,255,0.86)",
            background: "rgba(2,6,23,0.42)",
            fontSize: 13,
          }}
        >
          {message || "Loading SPZ splat model..."}
        </div>
      ) : null}
    </div>
  );
}

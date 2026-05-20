"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SpinDialNav, { type SpinTabId } from "./components/SpinDialNav";
import AnglesPanel from "./components/AnglesPanel";
import StoryboardPanel from "./components/StoryboardPanel";
import VoicesPanel from "./components/VoicesPanel";
import SupportPanel from "./components/SupportPanel";

type WorkflowItem = {
  id: string;
  label: string;
  runtime: string;
};

type WorkflowApiItem = {
  id?: string;
  key?: string;
  slug?: string;
  name?: string;
  label?: string;
  title?: string;
};

type WhoAmIResponse = {
  ok?: boolean;
  authenticated?: boolean;
  username?: string | null;
  user?: {
    admin?: boolean;
    username?: string | null;
    email?: string | null;
    name?: string | null;
  } | null;
};

type GalleryItem = {
  name?: string;
  sourceName?: string;
  url?: string;
  video?: boolean;
  kind?: "image" | "video";
  source?: "user" | "device" | string;
  createdAt?: number;
  updatedAt?: number;
  meta?: {
    favorite?: boolean;
    renamedName?: string | null;
    originalName?: string | null;
    positivePrompt?: string | null;
    negativePrompt?: string | null;
    submitPayload?: Record<string, any> | null;
    workflowId?: string | null;
    workflowTitle?: string | null;
  };
};

type AssistanceTab = "describe" | "enhance" | "scene" | "ask";

type ProgressResponse = {
  ok?: boolean;
  status?: "idle" | "running" | "complete" | "error" | string;
  running?: boolean;
  queue?: number;
  queue_remaining?: number;
  prompt_id?: string | null;
  file_name?: string | null;
  error?: string | null;
};

type LatestContentResponse = {
  ok?: boolean;
  status?: string;
  file?: {
    name?: string;
    kind?: "image" | "video";
    url?: string;
    sourceName?: string;
  } | null;
};

type PersistedGenerateState = {
  tab?: SpinTabId;
  prompt?: string;
  negativePrompt?: string;
  workflowId?: string;
  orientation?: "portrait" | "landscape";
  durationSeconds?: number;
  uploadedFileName?: string;
  gpuTarget?: string;
  assistanceTab?: AssistanceTab;
};

type ViewerState = {
  item: GalleryItem;
  title: string;
  url: string;
  isVideo: boolean;
};

type EditModalState = {
  item: GalleryItem;
  positivePrompt: string;
  negativePrompt: string;
  enhancing: boolean;
};

type AnimateModalState = {
  item: GalleryItem;
  positivePrompt: string;
  negativePrompt: string;
  durationSeconds: number;
  enhancing: boolean;
};

const APP_STATE_KEY = "otg:test:page-state:v1";

const WORKFLOW_FALLBACKS: WorkflowItem[] = [
  { id: "create-picture", label: "Create a Picture", runtime: "Estimated runtime: about 20 to 60 seconds." },
  { id: "animate-image", label: "Animate an Image", runtime: "Estimated runtime: about 2 to 6 minutes." },
  { id: "edit-picture", label: "Edit a Picture", runtime: "Estimated runtime: about 30 to 90 seconds." },
  { id: "skyreels-v3", label: "SkyReels V3", runtime: "Estimated runtime: about 3 to 10 minutes." },
];

const GALLERY_EDIT_WORKFLOW_ID = "presets/Edit Pictures";
const GALLERY_ANIMATE_WORKFLOW_ID = "presets/Create a Video from Pictures";
const GPU_OPTIONS = [
  { value: "3090", label: "RTX 3090" },
  { value: "5060ti", label: "RTX 5060 Ti" },
  { value: "3060ti", label: "RTX 3060 Ti" },
];

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function randomSeed() {
  return Math.floor(Math.random() * 2147483647) + 1;
}

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm md:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/78">{title}</h2>
        {right}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function PillButton({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-12 items-center justify-center rounded-full border px-4 py-3 text-sm font-semibold text-white transition",
        active
          ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))] shadow-[0_0_24px_rgba(90,160,255,0.18)]"
          : "border-white/10 bg-white/5 hover:bg-white/10"
      )}
    >
      {children}
    </button>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.35),rgba(40,200,255,0.28))] px-5 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 11.5a6 6 0 0 1-12 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17.5V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function getGalleryItemKey(item: GalleryItem) {
  return String(item.sourceName || item.meta?.originalName || item.name || "").trim();
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#060912] p-5 shadow-[0_0_50px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black tracking-tight text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MediaGrid({
  items,
  busyName,
  onDownload,
  onFavorite,
  onRename,
  onRedo,
  onEdit,
  onAnimate,
  onDelete,
  onOpenViewer,
}: {
  items: GalleryItem[];
  busyName?: string;
  onDownload?: (item: GalleryItem) => void;
  onFavorite?: (item: GalleryItem) => void;
  onRename?: (item: GalleryItem) => void;
  onRedo?: (item: GalleryItem) => void;
  onEdit?: (item: GalleryItem) => void;
  onAnimate?: (item: GalleryItem) => void;
  onDelete?: (item: GalleryItem) => void;
  onOpenViewer?: (item: GalleryItem) => void;
}) {
  if (!items.length) {
    return <div className="rounded-[22px] border border-white/10 bg-black/35 p-5 text-white/60">No items found.</div>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, index) => {
        const itemKey = getGalleryItemKey(item);
        const isBusy = busyName === itemKey;
        const favorite = Boolean(item.meta?.favorite);
        const createdLabel = item.createdAt ? new Date(item.createdAt).toLocaleString() : item.video ? "Video" : "Image";
        const isImage = !item.video && item.kind !== "video";

        return (
          <div
            key={`${itemKey || "item"}-${index}`}
            className="overflow-hidden rounded-[24px] border border-white/10 bg-black/35"
          >
            <button
              type="button"
              onClick={() => onOpenViewer?.(item)}
              className="block aspect-[4/3] w-full bg-black/50 text-left"
            >
              {item.video ? (
                <video src={item.url} className="h-full w-full object-contain" playsInline preload="metadata" muted />
              ) : (
                <img src={item.url} alt={item.name || "media"} className="h-full w-full object-contain" loading="lazy" />
              )}
            </button>
            <div className="space-y-3 p-4">
              <div>
                <div className="break-all text-sm font-semibold text-white/85">{item.name || "Unnamed item"}</div>
                <div className="text-xs text-white/45">{createdLabel}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onDownload?.(item)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/10"
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => onFavorite?.(item)}
                  disabled={isBusy}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50",
                    favorite
                      ? "border-pink-400/30 bg-pink-500/15 text-pink-100"
                      : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  )}
                >
                  {favorite ? "♥ Saved" : "♡ Heart"}
                </button>
                {isImage ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onEdit?.(item)}
                      disabled={isBusy}
                      className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/15 disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onAnimate?.(item)}
                      disabled={isBusy}
                      className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/15 disabled:opacity-50"
                    >
                      Animate
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => onRename?.(item)}
                  disabled={isBusy}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => onRedo?.(item)}
                  disabled={isBusy}
                  className="rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.30),rgba(40,200,255,0.22))] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Redo
                </button>
                <button
                  type="button"
                  onClick={() => onDelete?.(item)}
                  disabled={isBusy}
                  className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/15 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function readPersistedState(): PersistedGenerateState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(APP_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PersistedGenerateState) : null;
  } catch {
    return null;
  }
}

function clampDuration(value: number) {
  if (!Number.isFinite(value)) return 8;
  return Math.max(5, Math.min(15, Math.round(value)));
}

function guessRuntime(id: string, label: string) {
  const haystack = `${id} ${label}`.toLowerCase();
  if (haystack.includes("skyreels") || haystack.includes("video")) return "Estimated runtime: about 3 to 10 minutes.";
  if (haystack.includes("ltx") || haystack.includes("animate")) return "Estimated runtime: about 2 to 6 minutes.";
  if (haystack.includes("edit")) return "Estimated runtime: about 30 to 90 seconds.";
  return "Estimated runtime: about 20 to 60 seconds.";
}

function shouldSendSizeOverride(workflow: WorkflowItem | undefined) {
  const id = String(workflow?.id || "").toLowerCase();
  const label = String(workflow?.label || "").toLowerCase();
  return (
    label.includes("create a picture") ||
    label.includes("edit picture") ||
    label.includes("edit a picture") ||
    id.includes("text_to_image") ||
    id.includes("image_edit")
  );
}

function normalizeGalleryItem(raw: any): GalleryItem {
  return {
    name: raw?.name || raw?.sourceName || "",
    sourceName: raw?.sourceName || raw?.name || "",
    url: raw?.url || "",
    video: Boolean(raw?.video || raw?.kind === "video"),
    kind: raw?.kind === "video" ? "video" : "image",
    source: raw?.source || raw?.scope || "user",
    createdAt: Number(raw?.createdAt || raw?.ts || 0) || undefined,
    updatedAt: Number(raw?.updatedAt || 0) || undefined,
    meta: {
      favorite: Boolean(raw?.meta?.favorite ?? raw?.favorite),
      renamedName: raw?.meta?.renamedName ?? null,
      originalName: raw?.meta?.originalName ?? raw?.sourceName ?? raw?.name ?? null,
      positivePrompt: raw?.meta?.positivePrompt ?? null,
      negativePrompt: raw?.meta?.negativePrompt ?? null,
      submitPayload: raw?.meta?.submitPayload ?? null,
      workflowId: raw?.meta?.workflowId ?? null,
      workflowTitle: raw?.meta?.workflowTitle ?? null,
    },
  };
}

export default function AppPage() {
  const [tab, setTab] = useState<SpinTabId>("generate");
  const [assistanceTab, setAssistanceTab] = useState<AssistanceTab>("describe");
  const [username, setUsername] = useState("Guest");
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [workflows, setWorkflows] = useState<WorkflowItem[]>(WORKFLOW_FALLBACKS);
  const [workflowId, setWorkflowId] = useState(WORKFLOW_FALLBACKS[0].id);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [durationSeconds, setDurationSeconds] = useState(8);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [gpuTarget, setGpuTarget] = useState(GPU_OPTIONS[0].value);
  const [enhancing, setEnhancing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const [generateBusy, setGenerateBusy] = useState(false);
  const [progressStatus, setProgressStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [progressQueue, setProgressQueue] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [activePromptId, setActivePromptId] = useState("");
  const [latestPreviewUrl, setLatestPreviewUrl] = useState("");
  const [latestPreviewName, setLatestPreviewName] = useState("");
  const [latestPreviewKind, setLatestPreviewKind] = useState<"image" | "video" | "">("");

  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<GalleryItem[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [favoritesBusy, setFavoritesBusy] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<"all" | "images" | "videos">("all");
  const [gallerySort, setGallerySort] = useState<"newest" | "oldest" | "name">("newest");
  const [gallerySearch, setGallerySearch] = useState("");
  const [galleryActionBusyName, setGalleryActionBusyName] = useState("");
  const [viewerState, setViewerState] = useState<ViewerState | null>(null);
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [animateModal, setAnimateModal] = useState<AnimateModalState | null>(null);

  const [describeMode, setDescribeMode] = useState<"background" | "identity">("background");
  const [describeImageName, setDescribeImageName] = useState("");
  const [describeOutput, setDescribeOutput] = useState("");
  const [describeBusy, setDescribeBusy] = useState(false);

  const [enhanceDraft, setEnhanceDraft] = useState("");
  const [sceneDraft, setSceneDraft] = useState("");
  const [askInput, setAskInput] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [askBusy, setAskBusy] = useState(false);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const describeInputRef = useRef<HTMLInputElement | null>(null);
  const uploadedFileRef = useRef<File | null>(null);
  const describeFileRef = useRef<File | null>(null);
  const refreshedCompletePromptRef = useRef("");
  const inputImageUrlRef = useRef<string | null>(null);

  const selectedWorkflow = useMemo(() => {
    return workflows.find((workflow) => workflow.id === workflowId) || workflows[0] || WORKFLOW_FALLBACKS[0];
  }, [workflowId, workflows]);

  const findWorkflowByHint = useCallback(
    (kind: "edit" | "animate") => {
      const match = workflows.find((w) => {
        const hay = `${w.id} ${w.label}`.toLowerCase();
        if (kind === "edit") {
          return hay.includes("edit");
        }
        return hay.includes("ltx") || hay.includes("animate") || hay.includes("video");
      });
      if (match) return match;

      if (kind === "edit") {
        return WORKFLOW_FALLBACKS.find((w) => w.id === "edit-picture") || WORKFLOW_FALLBACKS[2];
      }

      return WORKFLOW_FALLBACKS.find((w) => w.id === "animate-image") || WORKFLOW_FALLBACKS[1];
    },
    [workflows]
  );

  useEffect(() => {
    const persisted = readPersistedState();
    if (persisted) {
      if (persisted.tab) setTab(persisted.tab);
      if (persisted.assistanceTab) setAssistanceTab(persisted.assistanceTab);
      if (typeof persisted.prompt === "string") setPrompt(persisted.prompt);
      if (typeof persisted.negativePrompt === "string") setNegativePrompt(persisted.negativePrompt);
      if (typeof persisted.workflowId === "string") setWorkflowId(persisted.workflowId);
      if (persisted.orientation === "portrait" || persisted.orientation === "landscape") setOrientation(persisted.orientation);
      if (typeof persisted.durationSeconds === "number") setDurationSeconds(clampDuration(persisted.durationSeconds));
      if (typeof persisted.uploadedFileName === "string") setUploadedFileName(persisted.uploadedFileName);
      if (typeof persisted.gpuTarget === "string") setGpuTarget(persisted.gpuTarget);
    }

    try {
      const url = new URL(window.location.href);
      const tabParam = url.searchParams.get("tab");
      if (
        tabParam === "gethelp" ||
        tabParam === "generate" ||
        tabParam === "angles" ||
        tabParam === "storyboard" ||
        tabParam === "gallery" ||
        tabParam === "voices" ||
        tabParam === "favorites" ||
        tabParam === "settings" ||
        tabParam === "support"
      ) {
        setTab(tabParam);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const nextState: PersistedGenerateState = {
        tab,
        assistanceTab,
        prompt,
        negativePrompt,
        workflowId,
        orientation,
        durationSeconds: clampDuration(durationSeconds),
        uploadedFileName,
        gpuTarget,
      };
      window.localStorage.setItem(APP_STATE_KEY, JSON.stringify(nextState));
    } catch {
      // ignore
    }
  }, [tab, assistanceTab, prompt, negativePrompt, workflowId, orientation, durationSeconds, uploadedFileName, gpuTarget]);

  useEffect(() => {
    return () => {
      if (inputImageUrlRef.current) {
        URL.revokeObjectURL(inputImageUrlRef.current);
        inputImageUrlRef.current = null;
      }
    };
  }, []);

  const loadGallery = useCallback(async () => {
    setGalleryBusy(true);
    try {
      const params = new URLSearchParams();
      params.set("sort", gallerySort);
      params.set("filter", galleryFilter);
      if (gallerySearch.trim()) params.set("search", gallerySearch.trim());

      const res = await fetch(`/api/gallery?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.files) ? data.files : [];
      setGalleryItems(items.map(normalizeGalleryItem));
    } catch {
      setGalleryItems([]);
    } finally {
      setGalleryBusy(false);
    }
  }, [galleryFilter, gallerySearch, gallerySort]);

  const loadFavorites = useCallback(async () => {
    setFavoritesBusy(true);
    try {
      const res = await fetch("/api/favorites", {
        cache: "no-store",
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.files) ? data.files : [];
      setFavoriteItems(items.map(normalizeGalleryItem));
    } catch {
      setFavoriteItems([]);
    } finally {
      setFavoritesBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadWhoAmI() {
      try {
        const res = await fetch("/api/whoami", {
          cache: "no-store",
          credentials: "include",
        });

        if (!res.ok) return;
        const data = (await res.json()) as WhoAmIResponse;
        if (cancelled) return;

        setUsername(data?.username || data?.user?.username || data?.user?.name || data?.user?.email || "Guest");
        setIsAdmin(Boolean(data?.user?.admin));
      } catch {
        // ignore
      }
    }

    async function loadStatus() {
      try {
        const res = await fetch("/api/comfy-status", {
          cache: "no-store",
          credentials: "include",
        });

        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        setConnected(Boolean(data?.connected || data?.ok || data?.status === "connected"));
        if (typeof data?.message === "string" && data.message.trim()) {
          setStatusMessage(data.message.trim());
        }
      } catch {
        // ignore
      }
    }

    async function loadWorkflows() {
      try {
        const res = await fetch("/api/workflows", {
          cache: "no-store",
          credentials: "include",
        });

        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data) ? data : Array.isArray(data?.workflows) ? data.workflows : [];

        const mapped = list
          .map((item: WorkflowApiItem, index: number) => {
            const rawId = item?.id || item?.key || item?.slug || `workflow-${index + 1}`;
            const rawLabel = item?.label || item?.name || item?.title || rawId;
            return {
              id: String(rawId),
              label: String(rawLabel),
              runtime: guessRuntime(String(rawId), String(rawLabel)),
            } satisfies WorkflowItem;
          })
          .filter((item: WorkflowItem) => item.id && item.label);

        if (!cancelled && mapped.length > 0) {
          setWorkflows(mapped);
          setWorkflowId((current) => (mapped.some((w) => w.id === current) ? current : mapped[0].id));
        }
      } catch {
        // ignore
      }
    }

    void loadWhoAmI();
    void loadStatus();
    void loadWorkflows();

    const timer = window.setInterval(() => {
      void loadStatus();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (tab === "gallery") {
      void loadGallery();
    }
    if (tab === "favorites") {
      void loadFavorites();
    }
  }, [tab, loadGallery, loadFavorites]);

  const refreshLatestContent = useCallback(async () => {
    try {
      const res = await fetch("/api/content/last", {
        cache: "no-store",
        credentials: "include",
      });

      const data = (await res.json().catch(() => ({}))) as LatestContentResponse;
      const file = data?.file;

      if (file?.url) {
        const bust = `${file.url}${file.url.includes("?") ? "&" : "?"}ts=${Date.now()}`;
        setLatestPreviewUrl(bust);
        setLatestPreviewName(file.sourceName || file.name || "");
        setLatestPreviewKind(file.kind || "image");
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshProgress = useCallback(async () => {
    try {
      const res = await fetch("/api/progress", {
        cache: "no-store",
        credentials: "include",
      });

      const data = (await res.json().catch(() => ({}))) as ProgressResponse;
      const nextStatus = String(data?.status || "idle").toLowerCase();
      const queueCount = Number(data?.queue_remaining ?? data?.queue ?? 0) || 0;
      const running = Boolean(data?.running) || nextStatus === "running";
      const promptId = String(data?.prompt_id || "").trim();

      setProgressQueue(queueCount);
      if (promptId) setActivePromptId(promptId);

      if (nextStatus === "error") {
        refreshedCompletePromptRef.current = "";
        setProgressStatus("error");
        setProgressPercent(100);
        return;
      }

      if (running) {
        refreshedCompletePromptRef.current = "";
        setProgressStatus("running");
        setProgressPercent((prev) => {
          const base = prev > 5 ? prev : 12;
          const next = queueCount > 0 ? Math.min(base + 8, 92) : Math.min(base + 5, 88);
          return next;
        });
        return;
      }

      if (nextStatus === "complete") {
        const completionKey = promptId || "__complete__";
        setProgressStatus("complete");
        setProgressPercent(100);

        if (refreshedCompletePromptRef.current !== completionKey) {
          refreshedCompletePromptRef.current = completionKey;
          await refreshLatestContent();
        }
        return;
      }

      refreshedCompletePromptRef.current = "";
      setProgressStatus("idle");
      setProgressPercent(0);
    } catch {
      // ignore
    }
  }, [refreshLatestContent]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;

      await refreshProgress().catch(() => null);

      if (cancelled) return;

      if (tab === "generate") {
        await refreshLatestContent().catch(() => null);
      }

      if (tab === "gallery") {
        await loadGallery().catch(() => null);
      }

      if (tab === "favorites") {
        await loadFavorites().catch(() => null);
      }
    };

    void tick();

    const timer = window.setInterval(() => {
      void tick();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tab, refreshProgress, refreshLatestContent, loadGallery, loadFavorites]);

  useEffect(() => {
    if (tab !== "gallery" && tab !== "favorites") return;

    let cancelled = false;

    const runBackfill = async () => {
      await fetch("/api/gallery/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ limit: 8 }),
      }).catch(() => null);

      if (cancelled) return;

      if (tab === "gallery") {
        await loadGallery().catch(() => null);
      }

      if (tab === "favorites") {
        await loadFavorites().catch(() => null);
      }
    };

    void runBackfill();

    return () => {
      cancelled = true;
    };
  }, [tab, loadGallery, loadFavorites]);

  const enhancePromptText = useCallback(async (inputText: string, workflowHint?: string) => {
    const cleaned = String(inputText || "").trim();
    if (!cleaned) {
      throw new Error("Nothing to enhance.");
    }

    const res = await fetch("/api/enhance-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        prompt: cleaned,
        workflowId: workflowHint || selectedWorkflow.id,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Enhance Prompt failed");
    }

    const nextPrompt = typeof data?.enhancedPrompt === "string" ? data.enhancedPrompt.trim() : "";
    if (!nextPrompt) {
      throw new Error("Empty enhancement response");
    }

    return nextPrompt;
  }, [selectedWorkflow.id]);

  const submitToComfy = useCallback(
    async (formData: FormData) => {
      const workflowHint = String(formData.get("workflowId") || "").trim().toLowerCase();
      const isWan2Gp = workflowHint === "wan2gp-i2v";
      const endpoint = isWan2Gp ? "/api/wan2gp" : "/api/comfy";

      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Generation submission failed");
      }

      const promptId = String(data?.prompt_id || data?.promptId || "").trim();
      const jobId = String(data?.jobId || "").trim();
      const backendLabel = String(data?.backendLabel || (isWan2Gp ? "Wan2GP" : "ComfyUI")).trim() || "Generator";

      if (promptId) {
        setActivePromptId(promptId);
        setStatusMessage(`Submitted to ${backendLabel}. Prompt ID: ${promptId}`);
      } else if (jobId) {
        setStatusMessage(`Submitted to ${backendLabel}. Job ID: ${jobId}`);
      } else {
        setStatusMessage(`Submitted to ${backendLabel}.`);
      }

      setProgressStatus("running");
      setProgressPercent(8);
      refreshedCompletePromptRef.current = "";
      await Promise.all([refreshProgress(), loadGallery(), loadFavorites()]);
    },
    [loadFavorites, loadGallery, refreshProgress]
  );

  const fetchGalleryItemAsFile = useCallback(async (item: GalleryItem, fallbackBaseName: string) => {
    const fileUrl = String(item.url || "").trim();
    if (!fileUrl) {
      throw new Error("This gallery item has no usable URL.");
    }

    const res = await fetch(fileUrl, {
      cache: "no-store",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Failed to load gallery media.");
    }

    const blob = await res.blob();
        const rawName = getGalleryItemKey(item) || fallbackBaseName;
    const safeBaseName = String(rawName)
      .split(/[\\/]+/)
      .pop() || fallbackBaseName;
    const extension =
      blob.type === "image/png"
        ? "png"
        : blob.type === "image/webp"
          ? "webp"
          : blob.type === "image/jpeg"
            ? "jpg"
            : blob.type === "video/mp4"
              ? "mp4"
              : "";
        const fileName = safeBaseName.includes(".")
      ? safeBaseName
      : extension
        ? `${safeBaseName}.${extension}`
        : safeBaseName;

    return new File([blob], fileName, { type: blob.type || "application/octet-stream" });
  }, []);

  const enhancePromptWithVision = useCallback(
    async (
      item: GalleryItem,
      currentPrompt: string,
      negativePrompt: string,
      mode: "edit" | "animate",
      durationSeconds?: number
    ) => {
      const fileUrl = String(item.url || "").trim();
      if (!fileUrl) {
        throw new Error("This gallery item has no usable URL.");
      }

      const imageRes = await fetch(fileUrl, {
        cache: "no-store",
        credentials: "include",
      });

      if (!imageRes.ok) {
        throw new Error("Failed to load the source image for vision enhancement.");
      }

      const blob = await imageRes.blob();
      const fileBase = getGalleryItemKey(item) || (mode === "edit" ? "edit-source" : "animate-source");
      const extension =
        blob.type === "image/png"
          ? "png"
          : blob.type === "image/webp"
            ? "webp"
            : "jpg";

      const imageFile = new File([blob], fileBase.includes(".") ? fileBase : `${fileBase}.${extension}`, {
        type: blob.type || "image/jpeg",
      });

      const instruction =
        mode === "edit"
          ? [
              "You are refining an image edit prompt.",
              "Analyze the attached source image and the user's requested edit.",
              "Preserve the original subject identity, composition, and visual continuity unless the user explicitly requests a change.",
              "Return one improved positive prompt only, optimized for image editing.",
              `User request: ${currentPrompt.trim() || "No request provided."}`,
              `Negative context: ${negativePrompt.trim() || "None."}`,
            ].join("\n")
          : [
              "You are refining an image-to-video prompt.",
              "Analyze the attached source image and the user's requested animation.",
              "Preserve the original subject identity, scene continuity, and visual consistency.",
              "Add useful motion, camera, atmosphere, and temporal detail without changing the core subject unless requested.",
              "Return one improved positive prompt only, optimized for image-to-video generation.",
              `User request: ${currentPrompt.trim() || "No request provided."}`,
              `Negative context: ${negativePrompt.trim() || "None."}`,
              `Duration seconds: ${Number.isFinite(Number(durationSeconds)) ? Math.floor(Number(durationSeconds)) : 8}`,
            ].join("\n");

      const body = new FormData();
      body.set(
        "messages",
        JSON.stringify([
          {
            role: "user",
            content: instruction,
          },
        ])
      );
      body.set("image", imageFile);

      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        body,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Vision enhance failed");
      }

      const nextPrompt = typeof data?.message === "string" ? data.message.trim() : "";
      if (!nextPrompt) {
        throw new Error("Vision enhancement returned an empty prompt.");
      }

      return nextPrompt;
    },
    []
  );
  const openViewer = useCallback((item: GalleryItem) => {
    const url = String(item.url || "").trim();
    if (!url) return;

    setViewerState({
      item,
      title: String(item.name || item.sourceName || "Viewer"),
      url,
      isVideo: Boolean(item.video || item.kind === "video"),
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (generateBusy) return;
    if (!prompt.trim()) {
      setStatusMessage("Enter a prompt first.");
      return;
    }

    setGenerateBusy(true);
    setStatusMessage("");
    refreshedCompletePromptRef.current = "";
    setProgressStatus("running");
    setProgressPercent(8);
    setLatestPreviewUrl("");
    setLatestPreviewName("");
    setLatestPreviewKind("");

    try {
      const body = new FormData();
      body.set("workflowId", workflowId);
      body.set("prompt", prompt);
      body.set("negativePrompt", negativePrompt);
      body.set("orientation", orientation);
      body.set("durationSeconds", String(durationSeconds));
      body.set("gpuTarget", gpuTarget);
      body.set("seed", String(randomSeed()));

      if (shouldSendSizeOverride(selectedWorkflow)) {
        body.set("width", orientation === "portrait" ? "720" : "1280");
        body.set("height", orientation === "portrait" ? "1280" : "720");
      }

      if (uploadedFileRef.current) {
        body.set("imageA", uploadedFileRef.current);
      }

      await submitToComfy(body);
    } catch (error) {
      setProgressStatus("error");
      setProgressPercent(100);
      setStatusMessage(error instanceof Error ? error.message : "Generate failed.");
    } finally {
      setGenerateBusy(false);
    }
  }, [
    durationSeconds,
    generateBusy,
    gpuTarget,
    negativePrompt,
    orientation,
    prompt,
    selectedWorkflow,
    submitToComfy,
    workflowId,
  ]);

  async function handleGalleryDownload(item: GalleryItem) {
    const name = getGalleryItemKey(item);
    if (!name) return;

    const a = document.createElement("a");
    a.href = `/api/gallery/file?name=${encodeURIComponent(name)}&download=1`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleGalleryFavorite(item: GalleryItem) {
    const name = getGalleryItemKey(item);
    if (!name) {
      setStatusMessage("Missing name");
      return;
    }

    setGalleryActionBusyName(name);

    try {
      const res = await fetch("/api/gallery/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          scope: item.source,
          favorite: !item.meta?.favorite,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Favorite toggle failed");
      }

      setStatusMessage(data?.favorite ? "Saved to favorites." : "Removed from favorites.");
      await Promise.all([loadGallery(), loadFavorites()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Favorite toggle failed.");
    } finally {
      setGalleryActionBusyName("");
    }
  }

  async function handleGalleryRename(item: GalleryItem) {
    const fileName = getGalleryItemKey(item);
    const displayName = String(item.name || fileName).trim();

    if (!fileName) {
      setStatusMessage("Missing name");
      return;
    }

    const nextName = window.prompt("Rename item", displayName);
    if (!nextName || !nextName.trim() || nextName.trim() === displayName) return;

    setGalleryActionBusyName(fileName);

    try {
      const res = await fetch("/api/gallery/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: fileName,
          newName: nextName.trim(),
          scope: item.source,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Rename failed");
      }

      setStatusMessage("Gallery item renamed.");
      await Promise.all([loadGallery(), loadFavorites()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Rename failed.");
    } finally {
      setGalleryActionBusyName("");
    }
  }

  async function handleGalleryDelete(item: GalleryItem) {
    const name = getGalleryItemKey(item);
    if (!name) {
      setStatusMessage("Missing name");
      return;
    }

    if (!window.confirm(`Delete "${item.name || name}"? This removes the gallery file and metadata.`)) {
      return;
    }

    setGalleryActionBusyName(name);

    try {
      const res = await fetch("/api/gallery/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          scope: item.source,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Delete failed");
      }

      setStatusMessage("Gallery item deleted.");
      if (viewerState && getGalleryItemKey(viewerState.item) === name) {
        setViewerState(null);
      }

      await Promise.all([loadGallery(), loadFavorites()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setGalleryActionBusyName("");
    }
  }

    async function handleGalleryRedo(item: GalleryItem) {
    const itemName = getGalleryItemKey(item);
    const storedPayload =
      item.meta?.submitPayload && typeof item.meta.submitPayload === "object"
        ? item.meta.submitPayload
        : {};

    setGalleryActionBusyName(itemName);

    try {
      const nextWorkflowId = String(
        (storedPayload as any).workflowId ||
        (storedPayload as any).preset ||
        item.meta?.workflowId ||
        ""
      ).trim();

      const nextPrompt = String(
        (storedPayload as any).positivePrompt ||
        (storedPayload as any).prompt ||
        item.meta?.positivePrompt ||
        ""
      ).trim();

      const nextNegative = String(
        (storedPayload as any).negativePrompt ||
        (storedPayload as any).neg ||
        item.meta?.negativePrompt ||
        ""
      ).trim();

      const nextOrientation =
        (storedPayload as any).orientation === "portrait" || (storedPayload as any).orientation === "landscape"
          ? (storedPayload as any).orientation
          : orientation;

      const nextDuration = clampDuration(
        Number(
          (storedPayload as any).durationSeconds ||
          (storedPayload as any).durationSec ||
          durationSeconds
        )
      );

      const nextGpuTarget =
        String((storedPayload as any).gpuTarget || gpuTarget || "").trim() || gpuTarget;

      if (!nextWorkflowId || !nextPrompt) {
        throw new Error("This item has no complete redo metadata.");
      }

      const body = new FormData();
      body.set("workflowId", nextWorkflowId);
      body.set("prompt", nextPrompt);
      body.set("negativePrompt", nextNegative);
      body.set("orientation", nextOrientation);
      body.set("durationSeconds", String(nextDuration));
      body.set("gpuTarget", nextGpuTarget);
      body.set("seed", String(randomSeed()));

      const workflowForSize =
        workflows.find((w) => w.id === nextWorkflowId) ||
        WORKFLOW_FALLBACKS.find((w) => w.id === nextWorkflowId) ||
        selectedWorkflow;

      if (shouldSendSizeOverride(workflowForSize)) {
        body.set("width", nextOrientation === "portrait" ? "720" : "1280");
        body.set("height", nextOrientation === "portrait" ? "1280" : "720");
      }

      const workflowHay = `${nextWorkflowId} ${item.meta?.workflowTitle || ""}`.toLowerCase();

      const needsVideoSource =
        workflowHay.includes("extend a video") ||
        workflowHay.includes("video_to_video") ||
        workflowHay.includes("video-to-video");

      const needsImageSource =
        !needsVideoSource &&
        (
          workflowHay.includes("edit") ||
          workflowHay.includes("ltx") ||
          workflowHay.includes("animate") ||
          workflowHay.includes("image_to_video") ||
          workflowHay.includes("image-to-video") ||
          workflowHay.includes("image-edit")
        );

      if (needsVideoSource) {
        const isVideo = Boolean(item.video || item.kind === "video");
        if (!isVideo) {
          throw new Error("Redo for this workflow requires a source video.");
        }

        const sourceFile = await fetchGalleryItemAsFile(item, "gallery-video-source");
        body.set("videoA", sourceFile);
      } else if (needsImageSource) {
        const isImage = !item.video && item.kind !== "video";
        if (!isImage) {
          throw new Error("Redo for this workflow requires a source image.");
        }

        const sourceFile = await fetchGalleryItemAsFile(item, "gallery-image-source");
        body.set("imageA", sourceFile);
      }

      await submitToComfy(body);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Redo failed."
      );
    } finally {
      setGalleryActionBusyName("");
    }
  }

  function handleGalleryEdit(item: GalleryItem) {
    const isImage = !item.video && item.kind !== "video";
    if (!isImage) {
      setStatusMessage("Only pictures can be edited.");
      return;
    }

    setEditModal({
      item,
      positivePrompt: String(item.meta?.positivePrompt || "").trim(),
      negativePrompt: String(item.meta?.negativePrompt || "").trim(),
      enhancing: false,
    });
  }

    async function handleEnhanceEditModal() {
    if (!editModal) return;
    if (!editModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt to enhance.");
      return;
    }

    setEditModal((prev) => (prev ? { ...prev, enhancing: true } : prev));
    setStatusMessage("");

    try {
      const nextPrompt = await enhancePromptWithVision(
        editModal.item,
        editModal.positivePrompt,
        editModal.negativePrompt,
        "edit"
      );

      setEditModal((prev) => (prev ? { ...prev, positivePrompt: nextPrompt, enhancing: false } : prev));
      setStatusMessage("Edit prompt enhanced from the image.");
    } catch (error) {
      setEditModal((prev) => (prev ? { ...prev, enhancing: false } : prev));
      setStatusMessage(error instanceof Error ? error.message : "Edit prompt enhancement failed.");
    }
  }

    async function submitGalleryEdit() {
    if (!editModal) return;

    const fileName = getGalleryItemKey(editModal.item);
    if (!fileName) {
      setStatusMessage("Missing gallery item name.");
      return;
    }

    if (!editModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt for the edit.");
      return;
    }

    setGalleryActionBusyName(fileName);

    try {
      const sourceFile = await fetchGalleryItemAsFile(editModal.item, "gallery-edit-source");
      if (!sourceFile) {
        throw new Error("Could not build the source image file.");
      }

      const body = new FormData();
      body.set("workflowId", GALLERY_EDIT_WORKFLOW_ID);
      body.set("prompt", editModal.positivePrompt.trim());
      body.set("negativePrompt", editModal.negativePrompt.trim());
      body.set("orientation", orientation);
      body.set("durationSeconds", String(durationSeconds));
      body.set("gpuTarget", gpuTarget);
      body.set("seed", String(randomSeed()));
      body.set("imageA", sourceFile, sourceFile.name);

      if (!body.has("imageA")) {
        throw new Error("Edit submission is missing imageA.");
      }

      body.set("width", orientation === "portrait" ? "720" : "1280");
      body.set("height", orientation === "portrait" ? "1280" : "720");

      await submitToComfy(body);
      setEditModal(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Edit submission failed.");
    } finally {
      setGalleryActionBusyName("");
    }
  }

  function handleGalleryAnimate(item: GalleryItem) {
    const isImage = !item.video && item.kind !== "video";
    if (!isImage) {
      setStatusMessage("Only pictures can be animated.");
      return;
    }

    setAnimateModal({
      item,
      positivePrompt: String(item.meta?.positivePrompt || "").trim(),
      negativePrompt: String(item.meta?.negativePrompt || "").trim(),
      durationSeconds: 8,
      enhancing: false,
    });
  }

    async function handleEnhanceAnimateModal() {
    if (!animateModal) return;
    if (!animateModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt to enhance.");
      return;
    }

    setAnimateModal((prev) => (prev ? { ...prev, enhancing: true } : prev));
    setStatusMessage("");

    try {
      const nextPrompt = await enhancePromptWithVision(
        animateModal.item,
        animateModal.positivePrompt,
        animateModal.negativePrompt,
        "animate",
        animateModal.durationSeconds
      );

      setAnimateModal((prev) => (prev ? { ...prev, positivePrompt: nextPrompt, enhancing: false } : prev));
      setStatusMessage("Animate prompt enhanced from the image.");
    } catch (error) {
      setAnimateModal((prev) => (prev ? { ...prev, enhancing: false } : prev));
      setStatusMessage(error instanceof Error ? error.message : "Animate prompt enhancement failed.");
    }
  }

    async function submitGalleryAnimate() {
    if (!animateModal) return;

    const fileName = getGalleryItemKey(animateModal.item);
    if (!fileName) {
      setStatusMessage("Missing gallery item name.");
      return;
    }

    if (!animateModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt for animation.");
      return;
    }

    setGalleryActionBusyName(fileName);

    try {
      const sourceFile = await fetchGalleryItemAsFile(animateModal.item, "gallery-animate-source");
      if (!sourceFile) {
        throw new Error("Could not build the source image file.");
      }

      const body = new FormData();
      body.set("workflowId", GALLERY_ANIMATE_WORKFLOW_ID);
      body.set("prompt", animateModal.positivePrompt.trim());
      body.set("negativePrompt", animateModal.negativePrompt.trim());
      body.set("orientation", orientation);
      body.set("durationSeconds", String(clampDuration(animateModal.durationSeconds)));
      body.set("gpuTarget", gpuTarget);
      body.set("seed", String(randomSeed()));
      body.set("imageA", sourceFile, sourceFile.name);

      if (!body.has("imageA")) {
        throw new Error("Animate submission is missing imageA.");
      }

      await submitToComfy(body);
      setAnimateModal(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Animate submission failed.");
    } finally {
      setGalleryActionBusyName("");
    }
  }

  async function handleEnhancePrompt() {
    if (!prompt.trim() || enhancing) return;

    setEnhancing(true);
    setStatusMessage("");
    try {
      const nextPrompt = await enhancePromptText(prompt, selectedWorkflow.id);
      setPrompt(nextPrompt);
      setStatusMessage("Prompt enhanced.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Enhance Prompt failed");
    } finally {
      setEnhancing(false);
    }
  }

  function handleMicClick() {
    if (recording) {
      setRecording(false);
      setStatusMessage("Recording stopped.");
      return;
    }

    setRecording(true);
    setStatusMessage("Mic capture is not wired on this page yet.");
  }

  async function handleLogout() {
    if (logoutBusy) return;

    setLogoutBusy(true);
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      }).catch(() => null);

      window.location.href = "/login";
    } finally {
      setLogoutBusy(false);
    }
  }

  function copyText(text: string) {
    void navigator.clipboard?.writeText(text || "");
    setStatusMessage("Copied.");
  }

  function sendTextToGenerate(text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;

    setPrompt((prev) => (prev.trim() ? `${prev.trim()}\n\n${cleaned}` : cleaned));
    setTab("generate");
    setStatusMessage("Sent to Generate.");
  }

  async function handleDescribe() {
    if (!describeFileRef.current) {
      setStatusMessage("Choose an image first.");
      return;
    }

    setDescribeBusy(true);
    setStatusMessage("");

    try {
      const instruction =
        describeMode === "background"
          ? "Describe only the background scene in direct visual detail for prompt writing."
          : "Describe the person's identity, face, hair, clothing, and distinguishing features in direct visual detail for prompt writing.";

      const body = new FormData();
      body.set(
        "messages",
        JSON.stringify([
          {
            role: "user",
            content: instruction,
          },
        ])
      );
      body.set("image", describeFileRef.current);

      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        body,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Describe failed");
      }

      const output = typeof data?.message === "string" ? data.message.trim() : "";
      setDescribeOutput(output || "No description returned.");
      setStatusMessage("Description created.");
    } catch (error) {
      setDescribeOutput("");
      setStatusMessage(error instanceof Error ? error.message : "Describe failed.");
    } finally {
      setDescribeBusy(false);
    }
  }

  async function handleAskAi() {
    if (!askInput.trim() || askBusy) return;

    setAskBusy(true);
    setStatusMessage("");

    try {
      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: askInput,
            },
          ],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Ask AI failed");
      }

      const answer =
        typeof data?.message === "string"
          ? data.message
          : typeof data?.answer === "string"
            ? data.answer
            : typeof data?.text === "string"
              ? data.text
              : "";

      setAskAnswer(answer || "No answer returned.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Ask AI failed";
      setAskAnswer(msg);
      setStatusMessage(msg);
    } finally {
      setAskBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#05060b] text-white">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_center,rgba(80,120,255,0.18),rgba(120,60,255,0.10),transparent_62%)]" />
      </div>

      <div className="pointer-events-none fixed left-3 top-4 z-30 md:left-5 md:top-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(0,0,0,0.35)]">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-400" />
          <span className="max-w-[180px] truncate">{username}</span>
        </div>
      </div>

      <div className="pointer-events-none fixed right-3 top-4 z-30 md:right-5 md:top-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(0,0,0,0.35)]">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", connected ? "bg-green-400" : "bg-red-400")} />
          <span>{connected ? "Connected" : "Disconnected"}</span>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-[1400px] px-3 pb-28 pt-24 md:px-5 md:pt-28">
        {statusMessage ? (
          <div className="mb-3 rounded-[20px] border border-red-600/40 bg-red-950/60 px-4 py-3 text-sm font-semibold text-red-100">
            {statusMessage}
          </div>
        ) : null}

        {tab === "generate" ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
              <h1 className="text-4xl font-black tracking-tight text-white">Generate</h1>
            </div>

            <Card title="Workflow">
              <select
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
                className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
              >
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id} className="bg-[#0b1020]">
                    {workflow.label}
                  </option>
                ))}
              </select>
              <p className="text-sm text-white/72">{selectedWorkflow.runtime}</p>
              <p className="text-sm text-white/50">Select a runnable workflow from comfy_workflows.</p>
            </Card>

            <Card title="Prompt">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder="Describe the image or video you want to generate."
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <div className="flex flex-wrap items-center gap-3">
                <ActionButton onClick={handleEnhancePrompt} disabled={enhancing || !prompt.trim()}>
                  {enhancing ? "Enhancing..." : "Enhance Prompt"}
                </ActionButton>
                <button
                  type="button"
                  onClick={handleMicClick}
                  className={cn(
                    "inline-flex h-12 w-12 items-center justify-center rounded-full border text-white transition",
                    recording
                      ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))]"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  )}
                >
                  <IconMic />
                </button>
              </div>
            </Card>

            <Card title="Negative prompt">
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={4}
                placeholder="Describe what to avoid."
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
            </Card>

            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Card title="Orientation">
                <div className="flex flex-wrap gap-3">
                  <PillButton active={orientation === "portrait"} onClick={() => setOrientation("portrait")}>
                    Portrait
                  </PillButton>
                  <PillButton active={orientation === "landscape"} onClick={() => setOrientation("landscape")}>
                    Landscape
                  </PillButton>
                </div>
              </Card>

              <Card title={`Duration: ${durationSeconds} seconds`}>
                <input
                  type="range"
                  min={5}
                  max={15}
                  step={1}
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(Number(e.target.value))}
                  className="w-full accent-violet-400"
                />
                <p className="text-sm text-white/50">5 to 15 seconds.</p>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Card title="Input image">
                <div className="flex flex-wrap items-center gap-3">
                  <ActionButton onClick={() => imageInputRef.current?.click()}>Upload image</ActionButton>
                  <span className="text-sm text-white/60">{uploadedFileName || "No file selected"}</span>
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    uploadedFileRef.current = file;
                    setUploadedFileName(file?.name || "");
                  }}
                />
              </Card>

              <Card title="GPU target">
                <select
                  value={gpuTarget}
                  onChange={(e) => setGpuTarget(e.target.value)}
                  disabled={!isAdmin}
                  className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45 disabled:opacity-70"
                >
                  {GPU_OPTIONS.map((gpu) => (
                    <option key={gpu.value} value={gpu.value} className="bg-[#0b1020]">
                      {gpu.label}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-white/50">
                  {isAdmin ? "Admin GPU selector is enabled." : "Visible only. Admin login is required to switch targets."}
                </p>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Card title="Preview">
                <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/45">
                  <div className="aspect-[16/9] bg-black/60">
                    {latestPreviewUrl ? (
                      latestPreviewKind === "video" ? (
                        <video src={latestPreviewUrl} className="h-full w-full object-contain" controls playsInline muted />
                      ) : (
                        <img src={latestPreviewUrl} alt={latestPreviewName || "Latest generated content"} className="h-full w-full object-contain" />
                      )
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-white/45">
                        Preview will appear here after ComfyUI finishes creating content.
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm text-white/60">
                  <span className="truncate">{latestPreviewName || "No completed output yet"}</span>
                  <GhostButton onClick={() => void refreshLatestContent()} disabled={progressStatus === "running"}>
                    Refresh preview
                  </GhostButton>
                </div>
              </Card>

              <Card title="Progress">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 text-sm font-semibold text-white/80">
                    <span className="capitalize">{progressStatus}</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(145,92,255,0.95),rgba(40,200,255,0.95))] transition-all duration-500"
                      style={{ width: `${Math.max(0, Math.min(progressPercent, 100))}%` }}
                    />
                  </div>
                  <div className="space-y-1 text-sm text-white/60">
                    <div>Queue remaining: {progressQueue}</div>
                    <div className="break-all">Prompt ID: {activePromptId || "Not submitted yet"}</div>
                    <div>
                      {progressStatus === "running"
                        ? "ComfyUI is still generating."
                        : progressStatus === "complete"
                          ? "Generation complete."
                          : progressStatus === "error"
                            ? "Generation failed."
                            : "Ready."}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <Card title="Generate action">
              <p className="text-sm text-white/60">The Generate button stays here as the last step.</p>
              <div className="flex flex-wrap items-center gap-3">
                <ActionButton onClick={handleGenerate} disabled={generateBusy || !prompt.trim()}>
                  {generateBusy ? "Submitting..." : "Generate"}
                </ActionButton>
                <span className="text-sm text-white/55">Sends the current prompt and controls to ComfyUI.</span>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "gethelp" ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
              <h1 className="text-4xl font-black tracking-tight text-white">AI Assistance</h1>
              <div className="mt-4 overflow-x-auto">
                <div className="flex min-w-max gap-2 pb-1">
                  <PillButton active={assistanceTab === "describe"} onClick={() => setAssistanceTab("describe")}>
                    Describe Picture
                  </PillButton>
                  <PillButton active={assistanceTab === "enhance"} onClick={() => setAssistanceTab("enhance")}>
                    Enhance Prompt
                  </PillButton>
                  <PillButton active={assistanceTab === "scene"} onClick={() => setAssistanceTab("scene")}>
                    Scene Creator
                  </PillButton>
                  <PillButton active={assistanceTab === "ask"} onClick={() => setAssistanceTab("ask")}>
                    Ask AI
                  </PillButton>
                </div>
              </div>
            </div>

            {assistanceTab === "describe" ? (
              <Card title="Describe Picture">
                <p className="text-white/70">Choose an image, select the mode, generate a description, then copy or send it to Generate.</p>
                <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-4">
                    <ActionButton onClick={() => describeInputRef.current?.click()}>Choose image</ActionButton>
                    <input
                      ref={describeInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        describeFileRef.current = file;
                        setDescribeImageName(file?.name || "");
                      }}
                    />
                    <div className="rounded-[22px] border border-white/10 bg-black/35 p-4 text-white/70">
                      {describeImageName || "No image selected"}
                    </div>
                    <select
                      value={describeMode}
                      onChange={(e) => setDescribeMode(e.target.value as "background" | "identity")}
                      className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                    >
                      <option value="background">Background Scene</option>
                      <option value="identity">Person Identity</option>
                    </select>
                    <ActionButton onClick={handleDescribe} disabled={describeBusy || !describeImageName}>
                      {describeBusy ? "Describing..." : "Describe"}
                    </ActionButton>
                  </div>

                  <div className="space-y-4">
                    <textarea
                      value={describeOutput}
                      onChange={(e) => setDescribeOutput(e.target.value)}
                      rows={10}
                      placeholder="Description result will appear here."
                      className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                    />
                    <div className="flex flex-wrap gap-3">
                      <GhostButton onClick={() => copyText(describeOutput)} disabled={!describeOutput.trim()}>
                        Copy
                      </GhostButton>
                      <ActionButton onClick={() => sendTextToGenerate(describeOutput)} disabled={!describeOutput.trim()}>
                        Send to Prompt
                      </ActionButton>
                    </div>
                  </div>
                </div>
              </Card>
            ) : null}

            {assistanceTab === "enhance" ? (
              <Card title="Enhance Prompt">
                <p className="text-white/70">Write a draft, refine it here, then send the result into Generate.</p>
                <textarea
                  value={enhanceDraft}
                  onChange={(e) => setEnhanceDraft(e.target.value)}
                  rows={8}
                  placeholder="Write the draft prompt you want to improve."
                  className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleMicClick}
                    className={cn(
                      "inline-flex h-12 w-12 items-center justify-center rounded-full border text-white transition",
                      recording
                        ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))]"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    )}
                  >
                    <IconMic />
                  </button>
                  <div className="flex flex-wrap gap-3">
                    <ActionButton
                      onClick={() =>
                        setEnhanceDraft((prev) =>
                          prev.trim() ? `${prev.trim()}\n\nRefined for stronger visual clarity and production detail.` : prev
                        )
                      }
                      disabled={!enhanceDraft.trim()}
                    >
                      Enhance
                    </ActionButton>
                    <GhostButton onClick={() => copyText(enhanceDraft)} disabled={!enhanceDraft.trim()}>
                      Copy
                    </GhostButton>
                    <ActionButton onClick={() => sendTextToGenerate(enhanceDraft)} disabled={!enhanceDraft.trim()}>
                      Send to Prompt
                    </ActionButton>
                  </div>
                </div>
              </Card>
            ) : null}

            {assistanceTab === "scene" ? (
              <Card title="Scene Creator">
                <p className="text-white/70">Build a scene card, then send it directly to Generate.</p>
                <textarea
                  value={sceneDraft}
                  onChange={(e) => setSceneDraft(e.target.value)}
                  rows={10}
                  placeholder="Describe the scene, action, location, and camera direction."
                  className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                />
                <div className="flex flex-wrap gap-3">
                  <GhostButton onClick={() => copyText(sceneDraft)} disabled={!sceneDraft.trim()}>
                    Copy
                  </GhostButton>
                  <ActionButton onClick={() => sendTextToGenerate(sceneDraft)} disabled={!sceneDraft.trim()}>
                    Send to Generate
                  </ActionButton>
                </div>
              </Card>
            ) : null}

            {assistanceTab === "ask" ? (
              <Card title="Ask AI">
                <p className="text-white/70">Ask a direct question and review the answer below.</p>
                <textarea
                  value={askInput}
                  onChange={(e) => setAskInput(e.target.value)}
                  rows={7}
                  placeholder="Ask for prompt help, workflow guidance, or a scene rewrite."
                  className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                />
                <div className="flex flex-wrap gap-3">
                  <ActionButton onClick={handleAskAi} disabled={askBusy || !askInput.trim()}>
                    {askBusy ? "Asking..." : "Ask AI"}
                  </ActionButton>
                  <GhostButton onClick={() => copyText(askAnswer)} disabled={!askAnswer.trim()}>
                    Copy Answer
                  </GhostButton>
                  <ActionButton onClick={() => sendTextToGenerate(askAnswer)} disabled={!askAnswer.trim()}>
                    Send to Prompt
                  </ActionButton>
                </div>
                <textarea
                  value={askAnswer}
                  onChange={(e) => setAskAnswer(e.target.value)}
                  rows={8}
                  placeholder="AI answer will appear here."
                  className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                />
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === "angles" ? <AnglesPanel /> : null}
        {tab === "storyboard" ? <StoryboardPanel /> : null}

        {tab === "gallery" ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-4xl font-black tracking-tight text-white">Gallery</h1>
                <GhostButton onClick={() => void loadGallery()} disabled={galleryBusy}>
                  {galleryBusy ? "Refreshing..." : "Refresh"}
                </GhostButton>
              </div>

              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <input
                  value={gallerySearch}
                  onChange={(e) => setGallerySearch(e.target.value)}
                  placeholder="Search by name"
                  className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                />
                <select
                  value={galleryFilter}
                  onChange={(e) => setGalleryFilter(e.target.value as "all" | "images" | "videos")}
                  className="rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                >
                  <option value="all">All</option>
                  <option value="images">Images</option>
                  <option value="videos">Videos</option>
                </select>
                <select
                  value={gallerySort}
                  onChange={(e) => setGallerySort(e.target.value as "newest" | "oldest" | "name")}
                  className="rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="name">Name</option>
                </select>
              </div>

              <MediaGrid
                items={galleryItems}
                busyName={galleryActionBusyName}
                onDownload={handleGalleryDownload}
                onFavorite={handleGalleryFavorite}
                onRename={handleGalleryRename}
                onRedo={handleGalleryRedo}
                onEdit={handleGalleryEdit}
                onAnimate={handleGalleryAnimate}
                onDelete={handleGalleryDelete}
                onOpenViewer={openViewer}
              />
            </div>
          </div>
        ) : null}

        {tab === "voices" ? <VoicesPanel isAdmin={isAdmin} /> : null}

        {tab === "favorites" ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h1 className="text-4xl font-black tracking-tight text-white">Favorites</h1>
                <GhostButton onClick={() => void loadFavorites()} disabled={favoritesBusy}>
                  {favoritesBusy ? "Refreshing..." : "Refresh"}
                </GhostButton>
              </div>

              <MediaGrid
                items={favoriteItems}
                busyName={galleryActionBusyName}
                onDownload={handleGalleryDownload}
                onFavorite={handleGalleryFavorite}
                onRename={handleGalleryRename}
                onRedo={handleGalleryRedo}
                onEdit={handleGalleryEdit}
                onAnimate={handleGalleryAnimate}
                onDelete={handleGalleryDelete}
                onOpenViewer={openViewer}
              />
            </div>
          </div>
        ) : null}

        {tab === "support" ? <SupportPanel /> : null}

        {tab === "settings" ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
              <h1 className="text-4xl font-black tracking-tight text-white">Settings</h1>
            </div>

            <Card title="Account">
              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={logoutBusy}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10 px-5 py-3 text-base font-semibold text-red-100 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {logoutBusy ? "Logging out..." : "Logout"}
                </button>
              </div>
            </Card>
          </div>
        ) : null}
      </div>

      {viewerState ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/90 p-4" onClick={() => setViewerState(null)}>
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col gap-3 rounded-[28px] border border-white/10 bg-[#060912] p-4 shadow-[0_0_50px_rgba(0,0,0,0.55)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="truncate text-sm font-semibold text-white/80">{viewerState.title}</div>
              <button
                type="button"
                onClick={() => setViewerState(null)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                Close
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[22px] border border-white/10 bg-black/60">
              {viewerState.isVideo ? (
                <video src={viewerState.url} className="max-h-[78vh] w-full object-contain" controls autoPlay playsInline />
              ) : (
                <img src={viewerState.url} alt={viewerState.title} className="max-h-[78vh] w-full object-contain" />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editModal ? (
        <ModalShell title="Edit Image" onClose={() => setEditModal(null)}>
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/50">
              <div className="aspect-[4/3] bg-black/60">
                <img src={editModal.item.url} alt={editModal.item.name || "Edit source"} className="h-full w-full object-contain" />
              </div>
            </div>
            <div className="space-y-4">
              <textarea
                value={editModal.positivePrompt}
                onChange={(e) => setEditModal((prev) => (prev ? { ...prev, positivePrompt: e.target.value } : prev))}
                rows={6}
                placeholder="Positive Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <textarea
                value={editModal.negativePrompt}
                onChange={(e) => setEditModal((prev) => (prev ? { ...prev, negativePrompt: e.target.value } : prev))}
                rows={5}
                placeholder="Negative Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <div className="flex flex-wrap gap-3">
                <GhostButton onClick={() => void handleEnhanceEditModal()} disabled={editModal.enhancing || !editModal.positivePrompt.trim()}>
                  {editModal.enhancing ? "Enhancing..." : "Enhance"}
                </GhostButton>
                <ActionButton onClick={() => void submitGalleryEdit()} disabled={galleryActionBusyName === getGalleryItemKey(editModal.item) || editModal.enhancing}>
                  {galleryActionBusyName === getGalleryItemKey(editModal.item) ? "Submitting..." : "Submit"}
                </ActionButton>
                <GhostButton onClick={() => setEditModal(null)} disabled={editModal.enhancing}>
                  Cancel
                </GhostButton>
              </div>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {animateModal ? (
        <ModalShell title="Animate Image" onClose={() => setAnimateModal(null)}>
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/50">
              <div className="aspect-[4/3] bg-black/60">
                <img src={animateModal.item.url} alt={animateModal.item.name || "Animate source"} className="h-full w-full object-contain" />
              </div>
            </div>
            <div className="space-y-4">
              <textarea
                value={animateModal.positivePrompt}
                onChange={(e) => setAnimateModal((prev) => (prev ? { ...prev, positivePrompt: e.target.value } : prev))}
                rows={6}
                placeholder="Positive Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <textarea
                value={animateModal.negativePrompt}
                onChange={(e) => setAnimateModal((prev) => (prev ? { ...prev, negativePrompt: e.target.value } : prev))}
                rows={5}
                placeholder="Negative Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <div className="space-y-2">
                <div className="text-sm font-semibold text-white/80">Duration: {animateModal.durationSeconds} seconds</div>
                <input
                  type="range"
                  min={5}
                  max={15}
                  step={1}
                  value={animateModal.durationSeconds}
                  onChange={(e) =>
                    setAnimateModal((prev) =>
                      prev ? { ...prev, durationSeconds: clampDuration(Number(e.target.value)) } : prev
                    )
                  }
                  className="w-full accent-violet-400"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <GhostButton onClick={() => void handleEnhanceAnimateModal()} disabled={animateModal.enhancing || !animateModal.positivePrompt.trim()}>
                  {animateModal.enhancing ? "Enhancing..." : "Enhance"}
                </GhostButton>
                <ActionButton onClick={() => void submitGalleryAnimate()} disabled={galleryActionBusyName === getGalleryItemKey(animateModal.item) || animateModal.enhancing}>
                  {galleryActionBusyName === getGalleryItemKey(animateModal.item) ? "Submitting..." : "Submit"}
                </ActionButton>
                <GhostButton onClick={() => setAnimateModal(null)} disabled={animateModal.enhancing}>
                  Cancel
                </GhostButton>
              </div>
            </div>
          </div>
        </ModalShell>
      ) : null}

      <SpinDialNav tab={tab} onTab={setTab} isAdmin={isAdmin} />
    </main>
  );
}






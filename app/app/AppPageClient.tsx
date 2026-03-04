"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import BottomNav, { type TabId } from "./components/BottomNav";
import ComfyStatusIndicator from "../components/ComfyStatusIndicator";

type WorkflowItem = {
  id: string;
  title: string;
  tags?: string[];
  description?: string;
  image?: string;
  supports?: {
    image?: boolean;
    video?: boolean;
  };
};

type LoRAItem = { id: string; weight: number };

type SubmitPayload = {
  preset?: string;
  positivePrompt?: string;
  negativePrompt?: string;
  loras?: LoRAItem[];
  orientation?: string;
  durationSec?: number;
  seconds?: number;
};

type GalleryMeta = {
  positivePrompt?: string | null;
  negativePrompt?: string | null;
  submitPayload?: SubmitPayload | null;
};

type GalleryItem = {
  name: string;
  url: string;
  kind?: "image" | "video";
  createdAt?: number;
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="otg-card" style={{ padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  const { children, ...rest } = props;
  return (
    <button type="button" className="otg-btnGhost" {...rest}>
      {children}
    </button>
  );
}

function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, init).then(async (r) => {
    const txt = await r.text();
    let json: any = null;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      // ignore
    }
    if (!r.ok) throw new Error(json?.error || txt || `HTTP ${r.status}`);
    return json as T;
  });
}

function isVideoName(name: string) {
  const n = name.toLowerCase();
  return n.endsWith(".mp4") || n.endsWith(".webm") || n.endsWith(".mov") || n.endsWith(".mkv") || n.endsWith(".gif");
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function paginateNumbers(current: number, total: number) {
  const out: (number | "…")[] = [];
  const push = (v: number | "…") => {
    if (out[out.length - 1] === v) return;
    out.push(v);
  };
  if (total <= 9) {
    for (let i = 1; i <= total; i++) push(i);
    return out;
  }
  push(1);
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) push("…");
  for (let i = left; i <= right; i++) push(i);
  if (right < total - 1) push("…");
  push(total);
  return out;
}

export default function AppPageClient() {
  const [tab, setTab] = useState<TabId>("generate");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [workflowId, setWorkflowId] = useState<string>("studio-image");
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loras, setLoras] = useState<LoRAItem[]>([]);

  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [durationSec, setDurationSec] = useState(7);

  const workflow = useMemo(() => workflows.find((w) => w.id === workflowId) ?? null, [workflows, workflowId]);

  const [lastFile, setLastFile] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const [galleryFiles, setGalleryFiles] = useState<GalleryItem[]>([]);
  const [galleryMedia, setGalleryMedia] = useState<"all" | "images" | "videos">("all");
  const [gallerySort, setGallerySort] = useState<"newest" | "oldest" | "name">("newest");
  const [galleryPage, setGalleryPage] = useState(1);
  const [galleryPer, setGalleryPer] = useState<5 | 10 | 20 | 50 | 100>(20);
  const [galleryTotalPages, setGalleryTotalPages] = useState(1);

  const [favoriteFiles, setFavoriteFiles] = useState<GalleryItem[]>([]);
  const favoritesSet = useMemo(() => new Set((favoriteFiles || []).map((f) => f.name)), [favoriteFiles]);

  const [mediaModal, setMediaModal] = useState<null | { name: string; url: string; kind: "image" | "video" }>(null);
  const [promptModal, setPromptModal] = useState<null | { name: string; meta: GalleryMeta }>(null);

  const toastRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastRef.current) window.clearTimeout(toastRef.current);
    toastRef.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  const refreshLastBlock = useCallback(async () => {
    try {
      const r = await jfetch<{ ok: boolean; url?: string; name?: string }>("/api/last");
      if (r?.ok && r.url) {
        setLastUrl(r.url);
        setLastFile(r.name || null);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadWorkflows = useCallback(async () => {
    const r = await jfetch<{ ok: boolean; workflows: WorkflowItem[] }>("/api/workflows");
    if (r?.ok) setWorkflows(r.workflows || []);
  }, []);

  const loadGallery = useCallback(async () => {
    const url =
      `/api/gallery?media=${encodeURIComponent(galleryMedia)}` +
      `&sort=${encodeURIComponent(gallerySort)}` +
      `&page=${encodeURIComponent(String(galleryPage))}` +
      `&per=${encodeURIComponent(String(galleryPer))}`;

    const res = await jfetch<any>(url);
    const files = (res?.files || []) as GalleryItem[];
    setGalleryFiles(files);
    const tp = Number(res?.totalPages || res?.pages || 1);
    setGalleryTotalPages(tp > 0 ? tp : 1);
  }, [galleryMedia, gallerySort, galleryPage, galleryPer]);

  const loadFavorites = useCallback(async () => {
    const res = await jfetch<{ ok: boolean; files: any[] }>("/api/favorites");
    if (res?.ok) setFavoriteFiles((res.files || []) as any);
  }, []);

  useEffect(() => {
    loadWorkflows().catch(() => void 0);
    refreshLastBlock().catch(() => void 0);
    loadGallery().catch(() => void 0);
    loadFavorites().catch(() => void 0);
  }, [loadWorkflows, refreshLastBlock, loadGallery, loadFavorites]);

  useEffect(() => {
    if (tab === "gallery") loadGallery().catch(() => void 0);
    if (tab === "favorites") loadFavorites().catch(() => void 0);
    if (tab === "generate") refreshLastBlock().catch(() => void 0);
  }, [tab, loadGallery, loadFavorites, refreshLastBlock]);

  useEffect(() => {
    if (tab !== "gallery") return;
    const t = window.setInterval(() => {
      loadGallery().catch(() => void 0);
    }, 2500);
    return () => window.clearInterval(t);
  }, [tab, loadGallery]);

  const submit = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const payload: SubmitPayload = {
        preset: workflowId,
        positivePrompt,
        negativePrompt,
        loras,
        orientation,
        durationSec,
        seconds: durationSec,
      };

      const r = await jfetch<{ ok: boolean; error?: string }>("/api/comfy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r?.ok) throw new Error(r?.error || "Submit failed");
      showToast("Queued");
      refreshLastBlock().catch(() => void 0);
      loadGallery().catch(() => void 0);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [workflowId, positivePrompt, negativePrompt, loras, orientation, durationSec, showToast, refreshLastBlock, loadGallery]);

  const openMedia = useCallback((f: GalleryItem) => {
    const kind: "image" | "video" = f.kind ? f.kind : isVideoName(f.name) ? "video" : "image";
    setMediaModal({ name: f.name, url: f.url, kind });
  }, []);

  const deleteFromGallery = useCallback(
    async (name: string) => {
      setErr(null);
      setBusy(true);
      try {
        await jfetch(`/api/gallery/delete?name=${encodeURIComponent(name)}`, { method: "POST" });
        await loadGallery();
      } catch (e: any) {
        setErr(String(e?.message || e));
      } finally {
        setBusy(false);
      }
    },
    [loadGallery],
  );

  const addToFavorites = useCallback(
    async (name: string) => {
      setErr(null);
      try {
        await jfetch(`/api/favorites/add?name=${encodeURIComponent(name)}`, { method: "POST" });
        await loadFavorites();
        showToast("Favorited");
      } catch (e: any) {
        setErr(String(e?.message || e));
      }
    },
    [loadFavorites, showToast],
  );

  const deleteFromFavorites = useCallback(
    async (name: string) => {
      setErr(null);
      try {
        await jfetch(`/api/favorites/delete?name=${encodeURIComponent(name)}`, { method: "POST" });
        await loadFavorites();
        showToast("Unfavorited");
      } catch (e: any) {
        setErr(String(e?.message || e));
      }
    },
    [loadFavorites, showToast],
  );

  const toggleFavorite = useCallback(
    async (name: string) => {
      if (favoritesSet.has(name)) return deleteFromFavorites(name);
      return addToFavorites(name);
    },
    [favoritesSet, deleteFromFavorites, addToFavorites],
  );

  const showPromptFromGallery = useCallback(
    async (name: string) => {
      setErr(null);
      try {
        const r = await jfetch<{ ok: boolean; meta?: GalleryMeta }>(`/api/gallery/meta?name=${encodeURIComponent(name)}`);
        if (!r?.ok) throw new Error("Failed to load prompt metadata.");
        setPromptModal({ name, meta: r.meta || {} });
        if (!r?.meta) showToast("No prompt found. Click 🔧 to repair.");
      } catch (e: any) {
        setErr(String(e?.message || e));
      }
    },
    [showToast],
  );

  const repairPromptFromGallery = useCallback(
    async (name: string) => {
      setErr(null);
      setBusy(true);
      try {
        await jfetch(`/api/gallery/repair-meta?name=${encodeURIComponent(name)}`, { method: "POST" });
        const r = await jfetch<{ ok: boolean; meta?: GalleryMeta }>(`/api/gallery/meta?name=${encodeURIComponent(name)}`);
        if (!r?.ok) throw new Error("Repair ran but meta fetch failed.");
        setPromptModal({ name, meta: r.meta || {} });
        if (!r?.meta || (!r.meta?.positivePrompt && !r.meta?.negativePrompt)) {
          showToast("Repair ran, but prompts are still missing for this item.");
        } else {
          showToast("Prompt repaired");
        }
      } catch (e: any) {
        setErr(String(e?.message || e));
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  const retryFromGallery = useCallback(
    async (name: string) => {
      setErr(null);
      setBusy(true);
      try {
        const metaRes = await jfetch<{ ok: boolean; meta?: GalleryMeta }>(`/api/gallery/meta?name=${encodeURIComponent(name)}`);
        if (!metaRes?.ok) throw new Error("Failed to load metadata for retry.");
        const submitPayload = metaRes?.meta?.submitPayload ?? null;
        if (!submitPayload) {
          showToast("No retry payload found for this item.");
          return;
        }
        const r = await jfetch<{ ok: boolean; error?: string }>("/api/comfy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(submitPayload),
        });
        if (!r?.ok) throw new Error(r?.error || "Retry submit failed");
        showToast("Queued");
        refreshLastBlock().catch(() => void 0);
        loadGallery().catch(() => void 0);
      } catch (e: any) {
        setErr(String(e?.message || e));
      } finally {
        setBusy(false);
      }
    },
    [showToast, refreshLastBlock, loadGallery],
  );

  const pager = useMemo(() => paginateNumbers(galleryPage, galleryTotalPages), [galleryPage, galleryTotalPages]);

  return (
    <main className="otg-root">
      <ComfyStatusIndicator />

      <div className="otg-page">
        {err ? <div className="otg-error">{err}</div> : null}

        {tab === "generate" ? (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="Generate">
              <div className="otg-row" style={{ alignItems: "center" }}>
                <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} className="otg-select" style={{ flex: 1 }}>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.title}
                    </option>
                  ))}
                </select>
                <button type="button" className="otg-btn" disabled={busy} onClick={() => submit().catch(() => void 0)}>
                  Run
                </button>
              </div>

              {workflow?.image ? (
                <div style={{ marginTop: 10 }}>
                  <Image src={workflow.image} alt={workflow.title} width={1200} height={600} style={{ width: "100%", height: "auto", borderRadius: 16 }} />
                </div>
              ) : null}

              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <textarea className="otg-textarea" value={positivePrompt} onChange={(e) => setPositivePrompt(e.target.value)} placeholder="Positive prompt" />
                <textarea className="otg-textarea" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder="Negative prompt" />
                <div className="otg-row" style={{ gap: 10 }}>
                  <select className="otg-select" value={orientation} onChange={(e) => setOrientation(e.target.value)} style={{ flex: 1 }}>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                  <input
                    className="otg-input"
                    type="number"
                    value={durationSec}
                    min={1}
                    max={30}
                    onChange={(e) => setDurationSec(clamp(Number(e.target.value || 7), 1, 30))}
                    style={{ width: 120 }}
                  />
                </div>
              </div>
            </Card>

            {lastUrl ? (
              <Card title="Last output">
                {lastFile && isVideoName(lastFile) ? (
                  <video style={{ width: "100%", borderRadius: 16 }} controls muted playsInline src={lastUrl} />
                ) : lastUrl ? (
                  <img style={{ width: "100%", borderRadius: 16, display: "block" }} src={lastUrl} alt={lastFile || "Last output"} />
                ) : null}
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === "gallery" ? (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="Gallery">
              <div className="otg-row" style={{ gap: 10, flexWrap: "wrap" }}>
                <select
                  className="otg-select"
                  value={galleryMedia}
                  onChange={(e) => {
                    setGalleryMedia(e.target.value as any);
                    setGalleryPage(1);
                  }}
                >
                  <option value="all">All</option>
                  <option value="images">Images</option>
                  <option value="videos">Videos</option>
                </select>

                <select
                  className="otg-select"
                  value={gallerySort}
                  onChange={(e) => {
                    setGallerySort(e.target.value as any);
                    setGalleryPage(1);
                  }}
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="name">Name</option>
                </select>

                <select
                  className="otg-select"
                  value={galleryPer}
                  onChange={(e) => {
                    setGalleryPer(Number(e.target.value) as any);
                    setGalleryPage(1);
                  }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>

                <button type="button" className="otg-btnGhost" disabled={busy} onClick={() => loadGallery().catch(() => void 0)}>
                  Refresh
                </button>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                {galleryFiles.map((f) => {
                  const isFav = favoritesSet.has(f.name);
                  const isVid = f.kind ? f.kind === "video" : isVideoName(f.name);
                  return (
                    <div key={f.name} className="otg-card" style={{ padding: 10 }}>
                      <div
                        style={{ cursor: "pointer", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}
                        onClick={() => openMedia(f)}
                      >
                        {isVid ? (
                          <video src={f.url} style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} muted playsInline />
                        ) : (
                          <img src={f.url} style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
                        )}
                      </div>

                      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9, wordBreak: "break-word" }}>{f.name}</div>

                      <div className="otg-row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                        <GhostButton title="Show prompt" onClick={() => showPromptFromGallery(f.name).catch(() => void 0)}>
                          📝
                        </GhostButton>

                        <GhostButton title="Repair prompt" onClick={() => repairPromptFromGallery(f.name).catch(() => void 0)}>
                          🔧
                        </GhostButton>

                        <GhostButton title="Retry / Regenerate" onClick={() => retryFromGallery(f.name).catch(() => void 0)}>
                          ↻
                        </GhostButton>

                        <a className="otg-btnGhost" title="Download" href={f.url} download style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          ⬇
                        </a>

                        <GhostButton title="Favorite" onClick={() => toggleFavorite(f.name).catch(() => void 0)}>
                          <span style={{ color: isFav ? "red" : "inherit" }}>♥</span>
                        </GhostButton>

                        <GhostButton title="Delete" onClick={() => deleteFromGallery(f.name).catch(() => void 0)} disabled={busy}>
                          ✕
                        </GhostButton>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, opacity: 0.9 }}>
                  Page {galleryPage} / {galleryTotalPages}
                </div>
                <div className="otg-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <GhostButton disabled={galleryPage <= 1} onClick={() => setGalleryPage((p) => Math.max(1, p - 1))}>
                    Prev
                  </GhostButton>

                  {pager.map((p, idx) =>
                    p === "…" ? (
                      <span key={`e-${idx}`} style={{ padding: "0 6px", opacity: 0.8 }}>
                        …
                      </span>
                    ) : (
                      <GhostButton key={p} disabled={p === galleryPage} onClick={() => setGalleryPage(p)}>
                        {p}
                      </GhostButton>
                    ),
                  )}

                  <GhostButton disabled={galleryPage >= galleryTotalPages} onClick={() => setGalleryPage((p) => Math.min(galleryTotalPages, p + 1))}>
                    Next
                  </GhostButton>
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "favorites" ? (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="Favorites">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                {favoriteFiles.map((f) => {
                  const isVid = f.kind ? f.kind === "video" : isVideoName(f.name);
                  return (
                    <div key={f.name} className="otg-card" style={{ padding: 10 }}>
                      <div style={{ cursor: "pointer", borderRadius: 12, overflow: "hidden" }} onClick={() => openMedia(f)}>
                        {isVid ? (
                          <video src={f.url} style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} muted playsInline />
                        ) : (
                          <img src={f.url} style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
                        )}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9, wordBreak: "break-word" }}>{f.name}</div>
                      <div className="otg-row" style={{ marginTop: 8, gap: 8 }}>
                        <GhostButton title="Remove favorite" onClick={() => deleteFromFavorites(f.name).catch(() => void 0)}>
                          ♥
                        </GhostButton>
                        <a className="otg-btnGhost" title="Download" href={f.url} download style={{ textDecoration: "none" }}>
                          ⬇
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        ) : null}
      </div>

      {mediaModal ? (
        <div className="otg-modalOverlay" onClick={() => setMediaModal(null)}>
          <div className="otg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700 }}>{mediaModal.name}</div>
              <button type="button" className="otg-btnGhost" onClick={() => setMediaModal(null)}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              {mediaModal.kind === "video" ? (
                <video style={{ width: "100%", borderRadius: 16 }} controls muted playsInline src={mediaModal.url} />
              ) : (
                <img style={{ width: "100%", borderRadius: 16, display: "block" }} src={mediaModal.url} alt={mediaModal.name} />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {promptModal ? (
        <div className="otg-modalOverlay" onClick={() => setPromptModal(null)}>
          <div className="otg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700 }}>Prompt</div>
              <div className="otg-row" style={{ gap: 10 }}>
                <button
                  type="button"
                  className="otg-btnGhost"
                  title="Repair prompt metadata"
                  onClick={() => repairPromptFromGallery(promptModal.name).catch(() => void 0)}
                >
                  🔧
                </button>
                <button type="button" className="otg-btnGhost" onClick={() => setPromptModal(null)}>
                  Close
                </button>
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85, wordBreak: "break-word" }}>{promptModal.name}</div>

            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea className="otg-textarea" value={promptModal.meta.positivePrompt || ""} readOnly placeholder="Positive prompt (missing)" />
              <textarea className="otg-textarea" value={promptModal.meta.negativePrompt || ""} readOnly placeholder="Negative prompt (missing)" />
              <div className="otg-row" style={{ gap: 10 }}>
                <button
                  type="button"
                  className="otg-btn"
                  onClick={() => navigator.clipboard.writeText(promptModal.meta.positivePrompt || "").then(() => showToast("Copied"))}
                >
                  Copy Positive
                </button>
                <button
                  type="button"
                  className="otg-btn"
                  onClick={() => navigator.clipboard.writeText(promptModal.meta.negativePrompt || "").then(() => showToast("Copied"))}
                >
                  Copy Negative
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="otg-toast" role="status">
          {toast}
        </div>
      ) : null}

      <BottomNav tab={tab} onTab={setTab} />
    </main>
  );
}
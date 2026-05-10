"use client";

import React from "react";

type CharacterRecord = {
  id: string;
  name: string;
  imagePath: string;
  description: string;
  voiceStyleDefinition: string;
  introLine: string;
  introVideoPath?: string;
  referenceAudioPath?: string;
  createdAt: string;
  updatedAt: string;
};

type UploadResponse = {
  ok?: boolean;
  serverPath?: string;
  fileUrl?: string;
  filename?: string;
  error?: string;
};

type ReferenceMediaResponse = {
  ok?: boolean;
  mediaType?: "audio" | "video";
  introVideoPath?: string;
  introVideoUrl?: string;
  referenceAudioPath?: string;
  referenceAudioUrl?: string;
  originalFileName?: string;
  error?: string;
  detail?: string;
};

type IntroVideoResponse = {
  ok?: boolean;
  videoPath?: string;
  videoUrl?: string;
  audioPath?: string;
  audioUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  promptId?: string;
  error?: string;
  detail?: string;
};

type ExtractAudioResponse = {
  ok?: boolean;
  referenceAudioPath?: string;
  referenceAudioUrl?: string;
  error?: string;
  detail?: string;
};

type SaveResponse = {
  ok?: boolean;
  character?: CharacterRecord;
  items?: CharacterRecord[];
  error?: string;
};

type ImportedCharacterDraft = {
  token: string;
  imagePath: string;
  imageUrl: string;
  imageName: string;
};

type CharactersPanelProps = {
  importedDraft?: ImportedCharacterDraft | null;
  onImportedDraftConsumed?: () => void;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function shortDate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
  } catch {
    return "";
  }
}

function fileUrlFor(pathValue?: string) {
  const p = String(pathValue || "").trim();
  if (!p) return "";
  return `/api/file?path=${encodeURIComponent(p)}`;
}

function withCacheBust(urlValue?: string) {
  const url = String(urlValue || "").trim();
  if (!url) return "";
  return `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
}

function loadJson<T>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, init).then(async (res) => {
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }
    return data as T;
  });
}

export default function CharactersPanel({ importedDraft = null, onImportedDraftConsumed }: CharactersPanelProps) {
  const [items, setItems] = React.useState<CharacterRecord[]>([]);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [showCreate, setShowCreate] = React.useState(false);
  const [showLoad, setShowLoad] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [uploadBusy, setUploadBusy] = React.useState(false);
  const [describeBusy, setDescribeBusy] = React.useState(false);
  const [referenceMediaBusy, setReferenceMediaBusy] = React.useState(false);
  const [introVideoBusy, setIntroVideoBusy] = React.useState(false);
  const [extractAudioBusy, setExtractAudioBusy] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [voiceStyleDefinition, setVoiceStyleDefinition] = React.useState("");
  const [introLine, setIntroLine] = React.useState("Hello. My name is Alex Jack, and I am ready for the next scene.");
  const [imagePath, setImagePath] = React.useState("");
  const [imageUrl, setImageUrl] = React.useState("");
  const [imageName, setImageName] = React.useState("");
  const [introVideoPath, setIntroVideoPath] = React.useState("");
  const [introVideoUrl, setIntroVideoUrl] = React.useState("");
  const [referenceAudioPath, setReferenceAudioPath] = React.useState("");
  const [referenceAudioUrl, setReferenceAudioUrl] = React.useState("");
  const [referenceMediaName, setReferenceMediaName] = React.useState("");

  const selected = React.useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId]
  );

  const previewItems = React.useMemo(() => items.slice(0, 10), [items]);
  const filteredItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.voiceStyleDefinition.toLowerCase().includes(q)
      );
    });
  }, [items, search]);

  const resetCreateForm = React.useCallback(() => {
    setName("");
    setDescription("");
    setVoiceStyleDefinition("");
    setIntroLine("Hello. My name is Alex Jack, and I am ready for the next scene.");
    setImagePath("");
    setImageUrl("");
    setImageName("");
    setIntroVideoPath("");
    setIntroVideoUrl("");
    setReferenceAudioPath("");
    setReferenceAudioUrl("");
    setReferenceMediaName("");
  }, []);

  const loadCharacters = React.useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await loadJson<{ ok: true; items: CharacterRecord[] }>("/api/characters", { cache: "no-store" });
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);
      setSelectedId((prev) => (prev && nextItems.some((item) => item.id === prev) ? prev : nextItems[0]?.id || ""));
    } catch (e: any) {
      setErr(e?.message || "Failed to load characters.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadCharacters().catch(() => void 0);
  }, [loadCharacters]);


  React.useEffect(() => {
    if (!importedDraft?.token) return;
    setShowCreate(true);
    setShowLoad(false);
    setErr("");
    setMessage("Portrait imported from Generate. Finish the character record and save.");
    setImagePath(importedDraft.imagePath || "");
    setImageUrl(importedDraft.imageUrl || fileUrlFor(importedDraft.imagePath));
    setImageName(importedDraft.imageName || "portrait image");
    onImportedDraftConsumed?.();
  }, [importedDraft, onImportedDraftConsumed]);

  async function handleUpload(file?: File | null) {
    if (!file) return;
    setUploadBusy(true);
    setErr("");
    setMessage("");
    try {
      const form = new FormData();
      form.append("image", file, file.name);
      const res = await fetch("/api/characters/upload", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": "web_characters" },
        body: form,
      });
      const data = (await res.json().catch(() => null)) as UploadResponse | null;
      if (!res.ok || !data?.ok || !data.serverPath) {
        throw new Error(data?.error || `Upload failed (${res.status})`);
      }
      setImagePath(String(data.serverPath));
      setImageUrl(String(data.fileUrl || fileUrlFor(data.serverPath)));
      setImageName(String(data.filename || file.name || "uploaded image"));
      setMessage("Character image uploaded.");
    } catch (e: any) {
      setErr(e?.message || "Character image upload failed.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleDescribe() {
    if (!imagePath) return;
    setDescribeBusy(true);
    setErr("");
    setMessage("");
    try {
      const res = await fetch("/api/vision-prompt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-otg-device-id": "web_characters" },
        body: JSON.stringify({ imagePath, purpose: "character", characterName: name || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `Describe failed (${res.status})`);
      }
      const descriptor = String(data?.descriptor || data?.description || "").trim();
      if (!descriptor) throw new Error("Describe request returned no descriptor.");
      setDescription(descriptor);
      setMessage("Character description generated.");
    } catch (e: any) {
      setErr(e?.message || "Failed to generate character description.");
    } finally {
      setDescribeBusy(false);
    }
  }

  async function handleCreateIntroVideo() {
    if (!imagePath.trim()) {
      setErr("Upload a character image before creating the intro video.");
      return;
    }
    if (!description.trim()) {
      setErr("Likeness Description is required before creating the intro video.");
      return;
    }
    if (!voiceStyleDefinition.trim()) {
      setErr("Voice Style Notes are required before creating the intro video.");
      return;
    }
    if (!introLine.trim()) {
      setErr("Future intro line is required before creating the intro video.");
      return;
    }
    const hadExistingPreview = !!introVideoPath.trim();
    setIntroVideoBusy(true);
    setErr("");
    setMessage("");
    try {
      const res = await fetch("/api/characters/intro-video", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-otg-device-id": "web_characters" },
        body: JSON.stringify({
          imagePath,
          likenessDescription: description,
          introLine,
          voiceStyleDefinition,
          characterName: name,
        }),
      });
      const data = (await res.json().catch(() => null)) as IntroVideoResponse | null;
      if (!res.ok || !data?.ok || !data.videoPath) {
        throw new Error(data?.error || data?.detail || `Create intro video failed (${res.status})`);
      }
      const nextVideoPath = String(data.videoPath || "");
      const baseVideoUrl = String(data.videoUrl || fileUrlFor(nextVideoPath));
      setIntroVideoPath(nextVideoPath);
      setIntroVideoUrl(withCacheBust(baseVideoUrl));
      setMessage(
        hadExistingPreview
          ? "Portrait 720p intro video replaced with a new random-seed render. Preview only; it does not save to Gallery."
          : "Portrait 720p intro video created. Preview only; it does not save to Gallery."
      );
    } catch (e: any) {
      setErr(e?.message || "Failed to create intro video.");
    } finally {
      setIntroVideoBusy(false);
    }
  }

  async function handleExtractAudioFromIntroVideo() {
    if (!introVideoPath.trim()) {
      setErr("Create or upload an intro video before extracting audio.");
      return;
    }
    setExtractAudioBusy(true);
    setErr("");
    setMessage("");
    try {
      const res = await fetch("/api/characters/extract-audio", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-otg-device-id": "web_characters" },
        body: JSON.stringify({ videoPath: introVideoPath }),
      });
      const data = (await res.json().catch(() => null)) as ExtractAudioResponse | null;
      if (!res.ok || !data?.ok || !data.referenceAudioPath) {
        throw new Error(data?.error || data?.detail || `Extract audio failed (${res.status})`);
      }
      setReferenceAudioPath(String(data.referenceAudioPath || ""));
      setReferenceAudioUrl(withCacheBust(String(data.referenceAudioUrl || fileUrlFor(data.referenceAudioPath))));
      setReferenceMediaName("Extracted from generated intro video");
      setMessage("Audio extracted from the intro video and set as the default reference audio.");
    } catch (e: any) {
      setErr(e?.message || "Failed to extract audio from intro video.");
    } finally {
      setExtractAudioBusy(false);
    }
  }

  async function handleReferenceMediaUpload(file?: File | null) {
    if (!file) return;
    setReferenceMediaBusy(true);
    setErr("");
    setMessage("");
    try {
      const form = new FormData();
      form.append("media", file, file.name);
      const res = await fetch("/api/characters/reference-media", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": "web_characters" },
        body: form,
      });
      const data = (await res.json().catch(() => null)) as ReferenceMediaResponse | null;
      if (!res.ok || !data?.ok || !data.referenceAudioPath) {
        throw new Error(data?.error || data?.detail || `Reference media upload failed (${res.status})`);
      }
      const nextReferenceAudioPath = String(data.referenceAudioPath || "");
      const nextReferenceAudioUrl = String(data.referenceAudioUrl || fileUrlFor(data.referenceAudioPath));
      const nextIntroVideoPath = String(data.introVideoPath || "");
      const nextIntroVideoUrl = String(data.introVideoUrl || fileUrlFor(data.introVideoPath));
      setReferenceAudioPath(nextReferenceAudioPath);
      setReferenceAudioUrl(withCacheBust(nextReferenceAudioUrl));
      setIntroVideoPath(nextIntroVideoPath);
      setIntroVideoUrl(withCacheBust(nextIntroVideoUrl));
      setReferenceMediaName(String(data.originalFileName || file.name || "reference media"));
      setMessage(
        data.mediaType === "video"
          ? "Reference video uploaded. Default voice audio was extracted and normalized."
          : "Reference audio uploaded and normalized for later voice workflows."
      );
    } catch (e: any) {
      setErr(e?.message || "Failed to upload reference media.");
    } finally {
      setReferenceMediaBusy(false);
    }
  }

  async function handleSaveCharacter() {
    if (!name.trim()) {
      setErr("Character name is required.");
      return;
    }
    if (!imagePath.trim()) {
      setErr("Upload a character image before saving.");
      return;
    }
    setSaveBusy(true);
    setErr("");
    setMessage("");
    try {
      const data = await loadJson<SaveResponse>("/api/characters", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-otg-device-id": "web_characters" },
        body: JSON.stringify({
          action: "create",
          name,
          imagePath,
          description,
          voiceStyleDefinition,
          introLine,
          introVideoPath,
          referenceAudioPath,
        }),
      });
      const nextItems = Array.isArray(data.items) ? data.items : items;
      setItems(nextItems);
      const nextSelectedId = data.character?.id || nextItems[0]?.id || "";
      setSelectedId(nextSelectedId);
      setShowCreate(false);
      resetCreateForm();
      setMessage("Character saved. Characters are immutable after creation.");
    } catch (e: any) {
      setErr(e?.message || "Failed to save character.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleDeleteCharacter() {
    if (!selected) return;
    const ok = window.confirm(`Delete character "${selected.name}"? This cannot be undone.`);
    if (!ok) return;
    setDeleteBusy(true);
    setErr("");
    setMessage("");
    try {
      const data = await loadJson<SaveResponse>("/api/characters", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-otg-device-id": "web_characters" },
        body: JSON.stringify({ action: "delete", id: selected.id }),
      });
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);
      setSelectedId(nextItems[0]?.id || "");
      setMessage(`Deleted ${selected.name}.`);
    } catch (e: any) {
      setErr(e?.message || "Failed to delete character.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tight text-white">Characters</h1>
            <p className="max-w-3xl text-sm text-white/60">
              Character Library for Production. Save a named reference image, locked description, preview intro video, and default voice reference now. Production slot autofill still comes in the next patch.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                resetCreateForm();
                setShowCreate(true);
                setMessage("");
                setErr("");
              }}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/35 bg-[linear-gradient(90deg,rgba(145,92,255,0.50),rgba(40,200,255,0.28))] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
            >
              New
            </button>
            <button
              type="button"
              onClick={() => setShowLoad(true)}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
            >
              Load
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteCharacter()}
              disabled={!selected || deleteBusy}
              className={cn(
                "inline-flex min-h-12 items-center justify-center rounded-full border px-5 py-3 text-sm font-semibold transition",
                !selected || deleteBusy
                  ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                  : "border-rose-400/35 bg-rose-500/12 text-rose-200 hover:bg-rose-500/18"
              )}
            >
              {deleteBusy ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
        {err ? <div className="mt-4 rounded-[20px] border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{err}</div> : null}
        {message ? <div className="mt-4 rounded-[20px] border border-emerald-400/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{message}</div> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <section className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.18em] text-white/78">Recent characters</div>
              <div className="mt-1 text-xs text-white/45">Showing the first 10 saved characters.</div>
            </div>
            <button
              type="button"
              onClick={() => loadCharacters().catch(() => void 0)}
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/85 transition hover:bg-white/10"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="space-y-2">
            {previewItems.length ? (
              previewItems.map((item) => {
                const active = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[22px] border px-3 py-3 text-left transition",
                      active
                        ? "border-cyan-400/35 bg-cyan-400/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    )}
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[16px] border border-white/10 bg-black/50">
                      {item.imagePath ? (
                        <img src={fileUrlFor(item.imagePath)} alt={item.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-white/35">No Image</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{item.name}</div>
                      <div className="truncate text-xs text-white/45">{shortDate(item.updatedAt || item.createdAt)}</div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/50">
                No characters saved yet. Create the first character to start your library.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
          {selected ? (
            <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/55">
                  <div className="aspect-[4/5] bg-black/60">
                    {selected.imagePath ? (
                      <img src={fileUrlFor(selected.imagePath)} alt={selected.name} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                </div>
                <div className="rounded-[22px] border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                  Characters are immutable after creation. Delete and recreate to change the image or locked description.
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <h2 className="text-3xl font-black tracking-tight text-white">{selected.name}</h2>
                  <div className="mt-1 text-sm text-white/45">Created {shortDate(selected.createdAt)} · Updated {shortDate(selected.updatedAt)}</div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/55 p-4">
                  <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/70">Likeness description</div>
                  <p className="text-sm leading-7 text-white/80">{selected.description || "No description saved."}</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[22px] border border-white/10 bg-black/55 p-4">
                    <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/70">Voice style notes</div>
                    <p className="text-sm leading-7 text-white/80">{selected.voiceStyleDefinition || "Not saved yet."}</p>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-black/55 p-4">
                    <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/70">Intro line</div>
                    <p className="text-sm leading-7 text-white/80">{selected.introLine || "Not saved yet."}</p>
                  </div>
                </div>

                {selected.introVideoPath ? (
                  <div className="rounded-[22px] border border-white/10 bg-black/55 p-4">
                    <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/70">Intro video preview</div>
                    <video
                      key={selected.introVideoPath}
                      controls
                      playsInline
                      preload="metadata"
                      src={fileUrlFor(selected.introVideoPath)}
                      className="aspect-[9/16] w-full rounded-[18px] bg-black object-contain"
                    />
                    <div className="mt-3 text-xs text-white/50">Saved with the character record for internal preview only. Portrait 720p. It is not a Gallery item.</div>
                  </div>
                ) : null}

                <div className="rounded-[22px] border border-white/10 bg-black/55 p-4">
                  <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/70">Default reference audio</div>
                  {selected.referenceAudioPath ? (
                    <div className="space-y-3">
                      <audio controls preload="none" src={fileUrlFor(selected.referenceAudioPath)} className="w-full">
                        Your browser does not support audio playback.
                      </audio>
                      <div className="text-xs text-white/50">
                        {selected.introVideoPath
                          ? "Saved from uploaded intro video and normalized to a voice-friendly WAV asset."
                          : "Saved from uploaded reference audio and normalized to a voice-friendly WAV asset."}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-white/55">No default reference audio saved yet.</div>
                  )}
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/55 p-4 text-sm text-white/60">
                  This patch upgrades the Character Library beyond shell-only storage. Characters can now preview an intro video, extract default reference audio, and carry that voice asset into later workflows.
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-5 py-8 text-sm text-white/50">
              Select a character from the left, or create a new character to begin building the library.
            </div>
          )}
        </section>
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-[28px] border border-white/10 bg-[#090612] p-5 shadow-[0_18px_90px_rgba(0,0,0,0.55)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-3xl font-black tracking-tight text-white">Create Character</h2>
                <p className="mt-2 text-sm text-white/55">Create the immutable character record now. This patch adds intro-video preview generation plus audio extraction so the character carries a reusable default voice asset.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-white/80 transition hover:bg-white/10"
                aria-label="Close create character"
              >
                ×
              </button>
            </div>

            <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-4 rounded-[24px] border border-white/10 bg-black/45 p-4">
                <div className="overflow-hidden rounded-[20px] border border-white/10 bg-black/60">
                  <div className="aspect-[4/5] bg-black/70">
                    {imageUrl ? (
                      <img src={imageUrl} alt={imageName || "Character preview"} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-white/35">
                        Upload a character image to start the library entry.
                      </div>
                    )}
                  </div>
                </div>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-cyan-400/35 bg-cyan-400/10 px-4 py-5 text-center text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/14">
                  <span>{uploadBusy ? "Uploading..." : "Upload Character Image"}</span>
                  <span className="text-xs font-normal text-cyan-100/70">PNG, JPG, WebP, or GIF</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onClick={(e) => { e.currentTarget.value = ""; }} onChange={(e) => void handleUpload(e.target.files?.[0] || null)} disabled={uploadBusy} />
                </label>
                <button
                  type="button"
                  onClick={() => void handleCreateIntroVideo()}
                  disabled={!imagePath || !description.trim() || !voiceStyleDefinition.trim() || !introLine.trim() || uploadBusy || introVideoBusy || describeBusy}
                  className={cn(
                    "inline-flex min-h-12 w-full items-center justify-center rounded-[20px] border px-4 py-3 text-sm font-semibold transition",
                    !imagePath || !description.trim() || !voiceStyleDefinition.trim() || !introLine.trim() || uploadBusy || introVideoBusy || describeBusy
                      ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                      : "border-white/10 bg-white/5 text-white/90 hover:bg-white/10"
                  )}
                >
                  {introVideoBusy ? "Creating Intro Video..." : introVideoPath ? "Create Intro Video Again" : "Create Intro Video"}
                </button>
                <div className="rounded-[18px] border border-cyan-400/20 bg-cyan-500/[0.06] px-4 py-3 text-xs text-cyan-100/75">
                  LTX image-to-video builds the positive prompt from your Likeness Description, Voice Style Notes, and Future Intro Line.
                </div>
                <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/55">
                  {imageName || "No character image uploaded yet."}
                </div>
                {introVideoUrl ? (
                  <div className="space-y-3 rounded-[20px] border border-white/10 bg-black/55 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Intro video preview</div>
                    <video
                      key={introVideoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      src={introVideoUrl}
                      className="aspect-[9/16] w-full rounded-[18px] bg-black object-contain"
                    />
                    <div className="text-xs text-white/45">Preview only. This intro video is kept inside the character workflow and is not saved to Gallery.</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCreateIntroVideo()}
                        disabled={introVideoBusy || uploadBusy || describeBusy}
                        className={cn(
                          "inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition",
                          introVideoBusy || uploadBusy || describeBusy
                            ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                            : "border-white/10 bg-white/5 text-white/90 hover:bg-white/10"
                        )}
                      >
                        {introVideoBusy ? "Rendering New Intro Video..." : "Redo Intro Video"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExtractAudioFromIntroVideo()}
                        disabled={extractAudioBusy || introVideoBusy}
                        className={cn(
                          "inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition",
                          extractAudioBusy || introVideoBusy
                            ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                            : "border-cyan-400/35 bg-cyan-500/12 text-cyan-100 hover:bg-cyan-500/18"
                        )}
                      >
                        {extractAudioBusy ? "Extracting Audio..." : "Extract Audio"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-4 rounded-[24px] border border-white/10 bg-black/45 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-white/70">
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Character name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Jack"
                      className="w-full rounded-[20px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-cyan-400/40"
                    />
                  </label>
                  <label className="space-y-2 text-sm text-white/70">
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Future intro line</span>
                    <input
                      value={introLine}
                      onChange={(e) => setIntroLine(e.target.value)}
                      placeholder="Short intro line for future voice bootstrap"
                      className="w-full rounded-[20px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-cyan-400/40"
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Likeness description</div>
                    <button
                      type="button"
                      onClick={() => void handleDescribe()}
                      disabled={!imagePath || describeBusy}
                      className={cn(
                        "inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition",
                        !imagePath || describeBusy
                          ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                          : "border-white/10 bg-white/5 text-white/90 hover:bg-white/10"
                      )}
                    >
                      {describeBusy ? "Describing..." : "Describe Image"}
                    </button>
                  </div>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={8}
                    placeholder="Describe the character's visual likeness. Use Describe Image to draft it from the uploaded image, then edit before saving."
                    className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/30 focus:border-cyan-400/40"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Voice style notes</div>
                  <textarea
                    value={voiceStyleDefinition}
                    onChange={(e) => setVoiceStyleDefinition(e.target.value)}
                    rows={5}
                    placeholder="Example: deep country-western accent, heavy gravel, warm but intimidating, slow pace"
                    className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/30 focus:border-cyan-400/40"
                  />
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/55 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Default reference audio</div>
                      <div className="mt-1 text-xs text-white/45">Upload a short audio clip or intro video. Video uploads keep the source video and extract a normalized WAV for later voice workflows.</div>
                    </div>
                    <label className={cn(
                      "inline-flex cursor-pointer items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition",
                      referenceMediaBusy
                        ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                        : "border-white/10 bg-white/5 text-white/90 hover:bg-white/10"
                    )}>
                      <span>{referenceMediaBusy ? "Uploading..." : "Upload Audio or Video"}</span>
                      <input
                        type="file"
                        accept="audio/*,video/mp4,video/quicktime,video/webm,video/x-matroska"
                        className="hidden"
                        onClick={(e) => { e.currentTarget.value = ""; }}
                        onChange={(e) => void handleReferenceMediaUpload(e.target.files?.[0] || null)}
                        disabled={referenceMediaBusy}
                      />
                    </label>
                  </div>

                  {referenceMediaName ? <div className="mt-3 rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/55">{referenceMediaName}</div> : null}

                  {referenceAudioUrl ? (
                    <div className="mt-3 space-y-3">
                      <audio key={referenceAudioUrl} controls preload="none" src={referenceAudioUrl} className="w-full">
                        Your browser does not support audio playback.
                      </audio>
                      <div className="text-xs text-white/50">
                        {introVideoUrl
                          ? "Audio extracted from the current intro video and normalized to 24k mono WAV."
                          : "Uploaded audio normalized to 24k mono WAV."}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[22px] border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  Save locks this character record. To change it later, delete the record and create a new one.
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSaveCharacter()}
                    disabled={saveBusy || uploadBusy || describeBusy || referenceMediaBusy || introVideoBusy || extractAudioBusy}
                    className={cn(
                      "inline-flex min-h-12 items-center justify-center rounded-full border px-5 py-3 text-sm font-semibold transition",
                      saveBusy || uploadBusy || describeBusy || referenceMediaBusy || introVideoBusy || extractAudioBusy
                        ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                        : "border-cyan-400/35 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))] text-white hover:brightness-110"
                    )}
                  >
                    {saveBusy ? "Saving..." : "Save Character"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetCreateForm();
                      setShowCreate(false);
                    }}
                    disabled={saveBusy}
                    className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showLoad ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-[28px] border border-white/10 bg-[#090612] p-5 shadow-[0_18px_90px_rgba(0,0,0,0.55)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-3xl font-black tracking-tight text-white">Load Character</h2>
                <p className="mt-2 text-sm text-white/55">Search the full library, then load the selected character into the preview pane.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLoad(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-white/80 transition hover:bg-white/10"
                aria-label="Close character loader"
              >
                ×
              </button>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search character name or description"
              className="mb-4 w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/30 focus:border-cyan-400/40"
            />
            <div className="space-y-2">
              {filteredItems.length ? (
                filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setShowLoad(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[16px] border border-white/10 bg-black/50">
                      {item.imagePath ? <img src={fileUrlFor(item.imagePath)} alt={item.name} className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{item.name}</div>
                      <div className="truncate text-xs text-white/45">{item.description || "No description saved."}</div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/50">No matching characters found.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

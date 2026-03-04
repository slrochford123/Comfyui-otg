"use client";

import * as React from "react";

type Mode = "clone" | "create" | "control" | "group";

type VoiceStudioType = "cloned" | "created";

type Voice = {
  voiceId: string;
  name: string;
  tags: string[];
  type: VoiceStudioType;
  refText: string;
  refAudioRel: string;
  createdAt: string;
  updatedAt: string;
  // derived by GET /api/voices/library
  refAudioUrl?: string;
};

type Emotion = "neutral" | "happy" | "sad" | "angry" | "calm" | "whisper" | "custom";

type EmotionPreset = {
  presetId: string;
  voiceId: string;
  emotion: Emotion;
  label: string;
  intensityTag?: number;
  refText: string;
  refAudioRel: string;
  createdAt: string;
  updatedAt: string;
};

type Limits = {
  ttsMaxTextLen: number;
  scriptMaxTextLen: number;
  maxUploadMb: number;
};

type Role = {
  voiceId: string;
  roleName: string;
  refText: string;
  presetId?: string;
};

type Line = {
  id: string;
  roleIndex: number; // 1..8
  text: string;
};

function cls(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function tagsToArray(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "otg_web";
  const key = "otg_device_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = `web_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  window.localStorage.setItem(key, id);
  return id;
}

async function readJsonSafe(res: Response): Promise<any> {
  const text = await res.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

export default function VoicesPanel({}: { isAdmin?: boolean }) {
  const [mode, setMode] = React.useState<Mode>("clone");

  const [tutorialOpen, setTutorialOpen] = React.useState(false);

  const [voices, setVoices] = React.useState<Voice[]>([]);
  const [limits, setLimits] = React.useState<Limits>({ ttsMaxTextLen: 500, scriptMaxTextLen: 2000, maxUploadMb: 25 });
  const [selectedVoiceId, setSelectedVoiceId] = React.useState<string>("");

  const selectedVoice = React.useMemo(() => voices.find((v) => v.voiceId === selectedVoiceId) || null, [voices, selectedVoiceId]);

  const [libBusy, setLibBusy] = React.useState(false);
  const [libErr, setLibErr] = React.useState<string>("");

  const [libraryPlayerUrl, setLibraryPlayerUrl] = React.useState<string>("");
  const [libraryPlayerLabel, setLibraryPlayerLabel] = React.useState<string>("");
  const [deleteBusyId, setDeleteBusyId] = React.useState<string>("");

  // Emotion presets (per-voice)
  const [presetsByVoice, setPresetsByVoice] = React.useState<Record<string, EmotionPreset[]>>({});
  const [presetsBusy, setPresetsBusy] = React.useState(false);
  const [presetsErr, setPresetsErr] = React.useState<string>("");
  const [clonePresetId, setClonePresetId] = React.useState<string>("");

  const [presetEmotion, setPresetEmotion] = React.useState<Emotion>("neutral");
  const [presetLabel, setPresetLabel] = React.useState<string>("");
  const [presetIntensity, setPresetIntensity] = React.useState<number>(3);
  const [presetUploadBusy, setPresetUploadBusy] = React.useState(false);
  const [presetMsg, setPresetMsg] = React.useState<string>("");

  // Clone mode
  const [cloneName, setCloneName] = React.useState<string>("");
  const [cloneTags, setCloneTags] = React.useState<string>("");
  const [cloneVoiceId, setCloneVoiceId] = React.useState<string>("");
  const [cloneRefText, setCloneRefText] = React.useState<string>("");
  const [clonePreviewText, setClonePreviewText] = React.useState<string>("This is a short preview to test the voice.");
  const [cloneBusy, setCloneBusy] = React.useState(false);
  const [cloneErr, setCloneErr] = React.useState<string>("");
  const [cloneMsg, setCloneMsg] = React.useState<string>("");
  const [clonePreviewUrl, setClonePreviewUrl] = React.useState<string>("");

  // Create mode
  const [createName, setCreateName] = React.useState<string>("");
  const [createTags, setCreateTags] = React.useState<string>("");
  const [createDesc, setCreateDesc] = React.useState<string>("");
  const [createLine, setCreateLine] = React.useState<string>("");
  const [createBusy, setCreateBusy] = React.useState(false);
  const [createErr, setCreateErr] = React.useState<string>("");
  const [createMsg, setCreateMsg] = React.useState<string>("");
  const [createAudioUrl, setCreateAudioUrl] = React.useState<string>("");
  const [createTestText, setCreateTestText] = React.useState<string>("This is a short follow-up line to test the generated voice.");
  const [createTestUrl, setCreateTestUrl] = React.useState<string>("");

  // Control mode (preset speakers + style/emotion instructions)
  const [ctlSpeaker, setCtlSpeaker] = React.useState<string>("ryan");
  const [ctlStyle, setCtlStyle] = React.useState<string>("A very neutral, calm speaking style.");
  const [ctlText, setCtlText] = React.useState<string>("She said she would be here by noon.");
  const [ctlBusy, setCtlBusy] = React.useState(false);
  const [ctlErr, setCtlErr] = React.useState<string>("");
  const [ctlAudioUrl, setCtlAudioUrl] = React.useState<string>("");

  // Group mode
  const [roles, setRoles] = React.useState<Role[]>([]);
  const [scriptLabelMode, setScriptLabelMode] = React.useState<"roleIndex" | "roleName">("roleIndex");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [pasteBox, setPasteBox] = React.useState<string>("");
  const [groupBusy, setGroupBusy] = React.useState(false);
  const [groupErr, setGroupErr] = React.useState<string>("");
  const [groupMsg, setGroupMsg] = React.useState<string>("");
  const [groupAudioUrl, setGroupAudioUrl] = React.useState<string>("");

  const refreshLibrary = React.useCallback(async () => {
    setLibBusy(true);
    setLibErr("");
    try {
      const res = await fetch("/api/voices/library", { cache: "no-store", credentials: "include" });
      const j = await readJsonSafe(res);

      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to load voices");

      const vs: Voice[] = Array.isArray(j.voices) ? j.voices : [];
      setVoices(vs);
      if (j?.limits) {
        setLimits({
          ttsMaxTextLen: Number(j.limits.ttsMaxTextLen) || 500,
          scriptMaxTextLen: Number(j.limits.scriptMaxTextLen) || 2000,
          maxUploadMb: Number(j.limits.maxUploadMb) || 25,
        });
      }

      if (!selectedVoiceId && vs.length) setSelectedVoiceId(vs[0].voiceId);
    } catch (e: any) {
      setLibErr(e?.message || "Failed to load voices");
    } finally {
      setLibBusy(false);
    }
  }, [selectedVoiceId]);

  const refreshPresets = React.useCallback(
    async (voiceId: string) => {
      if (!voiceId) return;
      setPresetsBusy(true);
      setPresetsErr("");
      try {
        const res = await fetch(`/api/voices/emotions?voiceId=${encodeURIComponent(voiceId)}`, {
          cache: "no-store",
          credentials: "include",
        });
        const j = await readJsonSafe(res);
        if (res.status === 401) {
          window.location.href = "/login?reason=session";
          return;
        }
        if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to load emotion presets");
        const arr: EmotionPreset[] = Array.isArray(j.presets) ? j.presets : [];
        setPresetsByVoice((prev) => ({ ...prev, [voiceId]: arr }));
        // Default selection: keep existing if still valid.
        setClonePresetId((prev) => {
          if (prev && arr.some((p) => p.presetId === prev)) return prev;
          return "";
        });
      } catch (e: any) {
        setPresetsErr(e?.message || "Failed to load emotion presets");
      } finally {
        setPresetsBusy(false);
      }
    },
    []
  );

  React.useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  React.useEffect(() => {
    if (selectedVoiceId) refreshPresets(selectedVoiceId);
  }, [selectedVoiceId, refreshPresets]);

  const upsertVoiceClient = (v: Voice) => {
    setVoices((prev) => {
      const idx = prev.findIndex((x) => x.voiceId === v.voiceId);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = v;
        return next;
      }
      return [v, ...prev];
    });
  };

  async function postJson(url: string, body: any): Promise<any> {
    const deviceId = getOrCreateDeviceId();
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-otg-device-id": deviceId },
      body: JSON.stringify(body || {}),
    });
    const j = await readJsonSafe(res);
    if (res.status === 401) {
      window.location.href = "/login?reason=session";
      throw new Error("Unauthorized");
    }
    if (!res.ok || !j?.ok) throw new Error(j?.error || j?.raw || `Request failed (${res.status})`);
    return j;
  }

  async function ensureCloneVoice(): Promise<string> {
    if (cloneVoiceId) return cloneVoiceId;
    const name = cloneName.trim();
    if (!name) throw new Error("Enter a voice name first.");
    const j = await postJson("/api/voices/library", { name, tags: tagsToArray(cloneTags), type: "cloned" });
    const v: Voice = j.voice;
    setCloneVoiceId(v.voiceId);
    setSelectedVoiceId(v.voiceId);
    upsertVoiceClient(v);
    return v.voiceId;
  }

  async function uploadSample(voiceId: string, file: File) {
    const deviceId = getOrCreateDeviceId();
    const fd = new FormData();
    fd.append("voiceId", voiceId);
    fd.append("file", file, file.name);

    const res = await fetch("/api/voices/upload", {
      method: "POST",
      credentials: "include",
      headers: { "x-otg-device-id": deviceId },
      body: fd,
    });
    const j = await readJsonSafe(res);
    if (res.status === 401) {
      window.location.href = "/login?reason=session";
      throw new Error("Unauthorized");
    }
    if (!res.ok || !j?.ok) throw new Error(j?.error || j?.raw || `Upload failed (${res.status})`);
    const v: Voice = j.voice;
    const refAudioUrl = String(j.audioUrl || "");
    upsertVoiceClient({ ...v, refAudioUrl: refAudioUrl || v.refAudioUrl });
    setSelectedVoiceId(v.voiceId);
    setCloneMsg("Reference audio uploaded.");
    if (refAudioUrl) {
      setLibraryPlayerUrl(refAudioUrl);
      setLibraryPlayerLabel(`${v.name} — reference`);
    }
  }

  async function transcribeVoice(voiceId: string) {
    const j = await postJson("/api/voices/transcribe", { voiceId });
    const text = String(j.text || "");
    setCloneRefText(text);
    if (j.voice) upsertVoiceClient(j.voice);
    setCloneMsg("Transcription complete.");
  }

  async function transcribePreset(voiceId: string, presetId: string) {
    const j = await postJson("/api/voices/transcribe", { voiceId, presetId });
    setPresetMsg("Transcription complete.");
    if (j?.preset) {
      const p: EmotionPreset = j.preset;
      setPresetsByVoice((prev) => {
        const arr = (prev[voiceId] || []).slice();
        const idx = arr.findIndex((x) => x.presetId === p.presetId);
        if (idx >= 0) arr[idx] = p;
        else arr.unshift(p);
        return { ...prev, [voiceId]: arr };
      });
    }
  }

  async function savePresetText(voiceId: string, presetId: string, refText: string) {
    const j = await postJson("/api/voices/emotions", { voiceId, presetId, refText });
    setPresetMsg("Preset text saved.");
    if (j?.preset) {
      const p: EmotionPreset = j.preset;
      setPresetsByVoice((prev) => {
        const arr = (prev[voiceId] || []).slice();
        const idx = arr.findIndex((x) => x.presetId === p.presetId);
        if (idx >= 0) arr[idx] = p;
        else arr.unshift(p);
        return { ...prev, [voiceId]: arr };
      });
    }
  }

  async function deletePreset(voiceId: string, presetId: string) {
    const deviceId = getOrCreateDeviceId();
    const res = await fetch(`/api/voices/emotions?voiceId=${encodeURIComponent(voiceId)}&presetId=${encodeURIComponent(presetId)}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "x-otg-device-id": deviceId },
    });
    const j = await readJsonSafe(res);
    if (res.status === 401) {
      window.location.href = "/login?reason=session";
      throw new Error("Unauthorized");
    }
    if (!res.ok || !j?.ok) throw new Error(j?.error || j?.raw || `Delete failed (${res.status})`);
    setPresetsByVoice((prev) => ({ ...prev, [voiceId]: (prev[voiceId] || []).filter((p) => p.presetId !== presetId) }));
    if (clonePresetId === presetId) setClonePresetId("");
  }

  async function uploadPreset(voiceId: string, file: File) {
    setPresetUploadBusy(true);
    setPresetMsg("");
    setPresetsErr("");
    try {
      const deviceId = getOrCreateDeviceId();
      const fd = new FormData();
      fd.append("voiceId", voiceId);
      fd.append("emotion", presetEmotion);
      fd.append("label", presetLabel);
      fd.append("intensityTag", String(presetIntensity));
      fd.append("file", file, file.name);

      const res = await fetch("/api/voices/emotions/upload", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": deviceId },
        body: fd,
      });
      const j = await readJsonSafe(res);
      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !j?.ok) throw new Error(j?.error || j?.raw || `Upload failed (${res.status})`);

      const p: EmotionPreset = j.preset;
      setPresetsByVoice((prev) => {
        const arr = (prev[voiceId] || []).slice();
        const idx = arr.findIndex((x) => x.presetId === p.presetId);
        if (idx >= 0) arr[idx] = p;
        else arr.unshift(p);
        return { ...prev, [voiceId]: arr };
      });
      setPresetMsg("Emotion preset uploaded.");
      setClonePresetId(p.presetId);
      if (j.audioUrl) {
        setLibraryPlayerUrl(String(j.audioUrl));
        setLibraryPlayerLabel(`${selectedVoice?.name || "Voice"} — ${p.label}`);
      }
    } catch (e: any) {
      setPresetsErr(e?.message || "Preset upload failed.");
      throw e;
    } finally {
      setPresetUploadBusy(false);
    }
  }

  async function saveRefText(voiceId: string, refText: string) {
    const j = await postJson("/api/voices/library", { voiceId, refText });
    const v: Voice = j.voice;
    upsertVoiceClient(v);
    setCloneMsg("Reference text saved.");
  }

  async function generateTts(voiceId: string, text: string, presetId?: string): Promise<string> {
    const j = await postJson("/api/tts/generate", { voiceId, text, presetId: presetId || "" });
    return String(j.audioUrl || "");

  }

  async function deleteVoiceEntry(voiceId: string) {
    const deviceId = getOrCreateDeviceId();
    const res = await fetch(`/api/voices/library?voiceId=${encodeURIComponent(voiceId)}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "x-otg-device-id": deviceId },
    });
    const j = await readJsonSafe(res);
    if (res.status === 401) {
      window.location.href = "/login?reason=session";
      throw new Error("Unauthorized");
    }
    if (!res.ok || !j?.ok) throw new Error(j?.error || j?.raw || `Delete failed (${res.status})`);
    return j;
  }

  async function runControl() {
    if (!ctlText.trim()) {
      setCtlErr("Enter some text first.");
      return;
    }
    setCtlBusy(true);
    setCtlErr("");
    setCtlAudioUrl("");
    try {
      const j = await postJson("/api/tts/control", {
        speaker: ctlSpeaker,
        style: ctlStyle,
        text: ctlText,
      });
      setCtlAudioUrl(String(j.audioUrl || ""));
      if (!j.audioUrl) throw new Error("No audio returned");
    } catch (e: any) {
      setCtlErr(e?.message || "Voice control failed");
    } finally {
      setCtlBusy(false);
    }
  }

  const compiledScript = React.useMemo(() => {
    const activeRoles = roles.slice(0, 8);
    const roleName = (idx: number) => activeRoles[idx - 1]?.roleName || `Role${idx}`;
    const prefix = (idx: number) => (scriptLabelMode === "roleName" ? roleName(idx) : `Role${idx}`);

    return lines
      .filter((ln) => ln.text.trim())
      .map((ln) => `${prefix(ln.roleIndex)}: ${ln.text.trim()}`)
      .join("\n");
  }, [lines, roles, scriptLabelMode]);

  function addDefaultLine(roleIndex = 1) {
    const id = `ln_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    setLines((prev) => [...prev, { id, roleIndex, text: "" }]);
  }

  function parsePastedDialogue() {
    const raw = (pasteBox || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!raw.length) return;

    const roleByName = new Map<string, number>();
    roles.forEach((r, i) => {
      roleByName.set(r.roleName.toLowerCase(), i + 1);
      roleByName.set(`role${i + 1}`.toLowerCase(), i + 1);
    });

    const next: Line[] = [];
    for (const row of raw) {
      const m = row.match(/^([^:]{1,40})\s*:\s*(.+)$/);
      if (!m) continue;
      const who = m[1].trim().toLowerCase();
      const text = m[2].trim();
      const idx = roleByName.get(who);
      if (!idx) continue;
      next.push({ id: `ln_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, roleIndex: idx, text });
    }

    if (next.length) {
      setLines(next);
      setPasteBox("");
    }
  }

  async function runGroup() {
    setGroupErr("");
    setGroupMsg("");
    setGroupAudioUrl("");

    const r = roles.filter((x) => x.voiceId);
    if (r.length < 2) {
      setGroupErr("Select at least 2 roles.");
      return;
    }
    if (!compiledScript.trim()) {
      setGroupErr("Add dialogue lines first.");
      return;
    }
    if (compiledScript.length > limits.scriptMaxTextLen) {
      setGroupErr(`Script too long (max ${limits.scriptMaxTextLen} chars).`);
      return;
    }

    const seen = new Set<string>();
    for (const it of r) {
      if (seen.has(it.voiceId)) {
        setGroupErr("Each role must use a different voice.");
        return;
      }
      seen.add(it.voiceId);
    }

    setGroupBusy(true);
    try {
      const payload = {
        roles: r.map((x, i) => ({ roleIndex: i + 1, voiceId: x.voiceId, presetId: x.presetId || "", roleName: x.roleName, refText: x.refText })),
        script: compiledScript,
      };

      const j = await postJson("/api/voices/studio/group", payload);
      setGroupAudioUrl(String(j.audioUrl || ""));
      setGroupMsg("Dialogue generated.");
    } catch (e: any) {
      setGroupErr(e?.message || "Group generation failed.");
    } finally {
      setGroupBusy(false);
    }
  }

  const libraryCard = (
    <div className="otg-card" style={{ padding: 12, flex: "0 0 360px", minWidth: 280 }}>
      <div className="otg-cardTitle" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span>Voice Library</span>
        <button type="button" className="otg-btnGhost" onClick={refreshLibrary} disabled={libBusy}>
          {libBusy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {libErr ? <div className="otg-errorText" style={{ marginTop: 8 }}>{libErr}</div> : null}

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        {voices.length ? (
          voices.map((v) => {
            const active = v.voiceId === selectedVoiceId;
            return (
              <button
                key={v.voiceId}
                type="button"
                className={cls("otg-card", active ? "otg-cardActive" : "")}
                onClick={() => setSelectedVoiceId(v.voiceId)}
                style={{ padding: 10, textAlign: "left", background: active ? "rgba(168,85,247,.10)" : undefined }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {v.name}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                      {v.type === "created" ? "Created" : "Cloned"} • {shortDate(v.updatedAt)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="otg-btnGhost"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (v.refAudioUrl) {
                          setLibraryPlayerUrl(v.refAudioUrl);
                          setLibraryPlayerLabel(`${v.name} — reference`);
                        }
                      }}
                      disabled={!v.refAudioUrl}
                      title={v.refAudioUrl ? "Play reference" : "No reference audio"}
                    >
                      ▶
                    </button>

                    <button
                      type="button"
                      className="otg-pill"
                      style={{
                        padding: "6px 10px",
                        fontSize: 11,
                        background: "rgba(239,68,68,.14)",
                        border: "1px solid rgba(239,68,68,.35)",
                        color: "rgb(248,113,113)",
                      }}
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (deleteBusyId) return;
                        const ok = window.confirm(`Delete voice "${v.name}"? This removes its samples and outputs.`);
                        if (!ok) return;

                        setDeleteBusyId(v.voiceId);
                        setLibErr("");
                        try {
                          await deleteVoiceEntry(v.voiceId);
                          setVoices((prev) => prev.filter((x) => x.voiceId !== v.voiceId));
                          setRoles((prev) => prev.map((r) => (r.voiceId === v.voiceId ? { ...r, voiceId: "" } : r)));

                          if (selectedVoiceId === v.voiceId) setSelectedVoiceId("");
                          if (libraryPlayerLabel.startsWith(v.name)) {
                            setLibraryPlayerUrl("");
                            setLibraryPlayerLabel("");
                          }

                          await refreshLibrary();
                        } catch (err: any) {
                          setLibErr(err?.message || "Delete failed");
                        } finally {
                          setDeleteBusyId("");
                        }
                      }}
                      disabled={!!deleteBusyId || libBusy}
                      title="Delete voice"
                    >
                      {deleteBusyId === v.voiceId ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>

                {Array.isArray(v.tags) && v.tags.length ? (
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {v.tags.slice(0, 4).map((t) => (
                      <span key={t} className="otg-pill" style={{ padding: "4px 8px", fontSize: 11 }}>
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })
        ) : (
          <div style={{ fontSize: 13, opacity: 0.85 }}>No voices yet.</div>
        )}
      </div>

      {libraryPlayerUrl ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>{libraryPlayerLabel}</div>
          <audio controls src={libraryPlayerUrl} style={{ width: "100%" }} />
          <div style={{ marginTop: 8 }}>
            <a className="otg-btnGhost" href={libraryPlayerUrl} download>
              Download
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );

  const clonePanel = (
    <div className="otg-card" style={{ padding: 12 }}>
      <div className="otg-cardTitle">Clone Voice</div>

      <div className="otg-cardBody">
        <div className="otg-label">Voice name</div>
        <input className="otg-input" value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="e.g., Mari, Narrator, Knives" />

        <div className="otg-label" style={{ marginTop: 10 }}>Tags (comma-separated)</div>
        <input className="otg-input" value={cloneTags} onChange={(e) => setCloneTags(e.target.value)} placeholder="female, calm, interview" />

        <div className="otg-row otg-gap" style={{ marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="otg-btnPrimary"
            disabled={cloneBusy || !cloneName.trim()}
            onClick={async () => {
              setCloneBusy(true);
              setCloneErr("");
              setCloneMsg("");
              try {
                const id = await ensureCloneVoice();
                setCloneMsg(`Voice created: ${id}`);
                await refreshLibrary();
              } catch (e: any) {
                setCloneErr(e?.message || "Create failed.");
              } finally {
                setCloneBusy(false);
              }
            }}
          >
            {cloneBusy ? "Working…" : cloneVoiceId ? "Voice Slot Ready" : "Create Voice Slot"}
          </button>

          <label className="otg-btnGhost" style={{ cursor: cloneBusy ? "not-allowed" : "pointer" }}>
            <input
              type="file"
              accept="audio/*,video/*"
              style={{ display: "none" }}
              disabled={cloneBusy}
              onChange={async (e) => {
                const f = e.target.files?.[0] || null;
                e.currentTarget.value = "";
                if (!f) return;
                setCloneBusy(true);
                setCloneErr("");
                setCloneMsg("");
                try {
                  const id = await ensureCloneVoice();
                  await uploadSample(id, f);
                  await refreshLibrary();
                } catch (err: any) {
                  setCloneErr(err?.message || "Upload failed.");
                } finally {
                  setCloneBusy(false);
                }
              }}
            />
            Upload reference clip (audio or video, max {limits.maxUploadMb}MB)
          </label>

          <button
            type="button"
            className="otg-btnGhost"
            disabled={cloneBusy || !cloneVoiceId}
            onClick={async () => {
              setCloneBusy(true);
              setCloneErr("");
              setCloneMsg("");
              try {
                await transcribeVoice(cloneVoiceId);
                await refreshLibrary();
              } catch (e: any) {
                setCloneErr(e?.message || "Transcription failed.");
              } finally {
                setCloneBusy(false);
              }
            }}
          >
            Auto-transcribe (Whisper)
          </button>
        </div>

        {cloneErr ? <div className="otg-errorText" style={{ marginTop: 10 }}>{cloneErr}</div> : null}
        {cloneMsg ? <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>{cloneMsg}</div> : null}

        <div className="otg-divider" />

        <div className="otg-label">Reference text (what is said in the clip)</div>
        <textarea
          className="otg-input"
          rows={4}
          value={cloneRefText}
          onChange={(e) => setCloneRefText(e.target.value)}
          placeholder="Click Auto-transcribe, or paste/edit the transcription here."
          style={{ width: "100%", resize: "vertical" }}
        />

        <div className="otg-row" style={{ marginTop: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Saved to voice profile (improves clone quality)</div>
          <button
            type="button"
            className="otg-btnGhost"
            disabled={cloneBusy || !cloneVoiceId}
            onClick={async () => {
              if (!cloneVoiceId) return;
              setCloneBusy(true);
              setCloneErr("");
              setCloneMsg("");
              try {
                await saveRefText(cloneVoiceId, cloneRefText);
                await refreshLibrary();
              } catch (e: any) {
                setCloneErr(e?.message || "Save failed.");
              } finally {
                setCloneBusy(false);
              }
            }}
          >
            Save reference text
          </button>
        </div>

        <div className="otg-divider" />

        <div className="otg-cardTitle" style={{ fontSize: 14 }}>Emotion Presets (optional)</div>
        <div className="otg-help" style={{ marginTop: 6 }}>
          Add multiple reference clips for the same voice (e.g., calm / angry / whisper). Select a preset to drive emotional delivery during generation.
        </div>

        {presetsErr ? <div className="otg-errorText" style={{ marginTop: 8 }}>{presetsErr}</div> : null}
        {presetMsg ? <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>{presetMsg}</div> : null}

        <div className="otg-row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 240, flex: "1 1 240px" }}>
            <div className="otg-label">Use preset for generation</div>
            <select
              className="otg-input"
              value={clonePresetId}
              onChange={(e) => setClonePresetId(e.target.value)}
              disabled={!cloneVoiceId || presetsBusy}
            >
              <option value="">(none — default reference)</option>
              {(presetsByVoice[cloneVoiceId] || []).map((p) => (
                <option key={p.presetId} value={p.presetId}>
                  {p.label} ({p.emotion}{p.intensityTag ? ` ${p.intensityTag}/5` : ""})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="otg-btnGhost"
            disabled={!cloneVoiceId || presetsBusy}
            onClick={() => cloneVoiceId && refreshPresets(cloneVoiceId)}
          >
            {presetsBusy ? "Loading…" : "Refresh presets"}
          </button>
        </div>

        <div className="otg-row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 160, flex: "1 1 160px" }}>
            <div className="otg-label">Emotion</div>
            <select className="otg-input" value={presetEmotion} onChange={(e) => setPresetEmotion(e.target.value as any)} disabled={!cloneVoiceId || presetUploadBusy}>
              <option value="neutral">neutral</option>
              <option value="happy">happy</option>
              <option value="sad">sad</option>
              <option value="angry">angry</option>
              <option value="calm">calm</option>
              <option value="whisper">whisper</option>
              <option value="custom">custom</option>
            </select>
          </div>

          <div style={{ minWidth: 220, flex: "2 1 220px" }}>
            <div className="otg-label">Label</div>
            <input className="otg-input" value={presetLabel} onChange={(e) => setPresetLabel(e.target.value)} placeholder="e.g., Calm interview" disabled={!cloneVoiceId || presetUploadBusy} />
          </div>

          <div style={{ minWidth: 160, flex: "1 1 160px" }}>
            <div className="otg-label">Intensity tag (1–5)</div>
            <input
              className="otg-input"
              type="number"
              min={1}
              max={5}
              value={presetIntensity}
              onChange={(e) => setPresetIntensity(Math.max(1, Math.min(5, Number(e.target.value) || 3)))}
              disabled={!cloneVoiceId || presetUploadBusy}
            />
          </div>
        </div>

        <div className="otg-row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label className="otg-btnGhost" style={{ cursor: !cloneVoiceId || presetUploadBusy ? "not-allowed" : "pointer" }}>
            <input
              type="file"
              accept="audio/*,video/*"
              style={{ display: "none" }}
              disabled={!cloneVoiceId || presetUploadBusy}
              onChange={async (e) => {
                const f = e.target.files?.[0] || null;
                e.currentTarget.value = "";
                if (!f || !cloneVoiceId) return;
                try {
                  await uploadPreset(cloneVoiceId, f);
                } catch (err: any) {
                  setPresetsErr(err?.message || "Preset upload failed.");
                }
              }}
            />
            {presetUploadBusy ? "Uploading…" : "Upload emotion clip"}
          </label>

          <button
            type="button"
            className="otg-btnGhost"
            disabled={!cloneVoiceId || !clonePresetId || cloneBusy}
            onClick={async () => {
              if (!cloneVoiceId || !clonePresetId) return;
              setCloneBusy(true);
              setCloneErr("");
              try {
                await transcribePreset(cloneVoiceId, clonePresetId);
              } catch (e: any) {
                setCloneErr(e?.message || "Transcription failed.");
              } finally {
                setCloneBusy(false);
              }
            }}
          >
            Transcribe preset (Whisper)
          </button>
        </div>

        {clonePresetId ? (
          <div style={{ marginTop: 10 }}>
            <div className="otg-label">Preset reference text</div>
            <textarea
              className="otg-input"
              rows={3}
              value={(presetsByVoice[cloneVoiceId] || []).find((p) => p.presetId === clonePresetId)?.refText || ""}
              onChange={(e) => {
                const v = e.target.value;
                setPresetsByVoice((prev) => {
                  const arr = (prev[cloneVoiceId] || []).slice();
                  const idx = arr.findIndex((p) => p.presetId === clonePresetId);
                  if (idx >= 0) arr[idx] = { ...arr[idx], refText: v };
                  return { ...prev, [cloneVoiceId]: arr };
                });
              }}
              style={{ width: "100%", resize: "vertical" }}
              placeholder="What is said in this emotion clip (improves clone quality)."
            />
            <div className="otg-row" style={{ marginTop: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Saved to preset only (does not overwrite the main reference)</div>
              <div className="otg-row" style={{ gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="otg-btnGhost"
                  disabled={!cloneVoiceId || !clonePresetId || cloneBusy}
                  onClick={async () => {
                    const p = (presetsByVoice[cloneVoiceId] || []).find((x) => x.presetId === clonePresetId);
                    if (!p) return;
                    setCloneBusy(true);
                    setCloneErr("");
                    try {
                      await savePresetText(cloneVoiceId, clonePresetId, p.refText || "");
                    } catch (e: any) {
                      setCloneErr(e?.message || "Save failed.");
                    } finally {
                      setCloneBusy(false);
                    }
                  }}
                >
                  Save preset text
                </button>

                <button
                  type="button"
                  className="otg-btnDanger"
                  disabled={!cloneVoiceId || !clonePresetId || cloneBusy}
                  onClick={async () => {
                    if (!cloneVoiceId || !clonePresetId) return;
                    const ok = window.confirm("Delete this emotion preset?");
                    if (!ok) return;
                    setCloneBusy(true);
                    setCloneErr("");
                    try {
                      await deletePreset(cloneVoiceId, clonePresetId);
                      setPresetMsg("Preset deleted.");
                    } catch (e: any) {
                      setCloneErr(e?.message || "Delete failed.");
                    } finally {
                      setCloneBusy(false);
                    }
                  }}
                >
                  Delete preset
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="otg-label">Preview text (what to say)</div>
        <textarea
          className="otg-input"
          rows={3}
          value={clonePreviewText}
          onChange={(e) => setClonePreviewText(e.target.value.slice(0, limits.ttsMaxTextLen))}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>{clonePreviewText.length}/{limits.ttsMaxTextLen}</div>

        <div className="otg-row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="otg-btnPrimary"
            disabled={cloneBusy || !cloneVoiceId || !clonePreviewText.trim()}
            onClick={async () => {
              if (!cloneVoiceId) return;
              setCloneBusy(true);
              setCloneErr("");
              setCloneMsg("");
              setClonePreviewUrl("");
              try {
                // Ensure refText is saved before preview if user edited it.
                if (cloneRefText.trim()) await saveRefText(cloneVoiceId, cloneRefText.trim());
                const url = await generateTts(cloneVoiceId, clonePreviewText.trim(), clonePresetId || undefined);
                setClonePreviewUrl(url);
                setCloneMsg("Preview generated.");
                await refreshLibrary();
              } catch (e: any) {
                setCloneErr(e?.message || "Preview failed.");
              } finally {
                setCloneBusy(false);
              }
            }}
          >
            {cloneBusy ? "Generating…" : "Generate preview"}
          </button>

          {clonePreviewUrl ? (
            <a className="otg-btnGhost" href={clonePreviewUrl} download>
              Download preview
            </a>
          ) : null}
        </div>

        {clonePreviewUrl ? (
          <div style={{ marginTop: 12 }}>
            <audio controls src={clonePreviewUrl} style={{ width: "100%" }} />
          </div>
        ) : null}
      </div>
    </div>
  );

  const createPanel = (
    <div className="otg-card" style={{ padding: 12 }}>
      <div className="otg-cardTitle">Create Voice</div>

      <div className="otg-cardBody">
        <div className="otg-label">Voice name</div>
        <input className="otg-input" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g., Calm Interviewer" />

        <div className="otg-label" style={{ marginTop: 10 }}>Tags (comma-separated)</div>
        <input className="otg-input" value={createTags} onChange={(e) => setCreateTags(e.target.value)} placeholder="male, warm, narrator" />

        <div className="otg-label" style={{ marginTop: 10 }}>Voice description (character details)</div>
        <textarea
          className="otg-input"
          rows={5}
          value={createDesc}
          onChange={(e) => setCreateDesc(e.target.value)}
          placeholder="Describe tone, accent, age, energy, pacing, and any constraints."
          style={{ width: "100%", resize: "vertical" }}
        />

        <div className="otg-label" style={{ marginTop: 10 }}>What should the voice say (creation sample)</div>
        <textarea
          className="otg-input"
          rows={3}
          value={createLine}
          onChange={(e) => setCreateLine(e.target.value.slice(0, limits.ttsMaxTextLen))}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>{createLine.length}/{limits.ttsMaxTextLen}</div>

        <div className="otg-row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="otg-btnPrimary"
            disabled={createBusy || !createName.trim() || !createDesc.trim() || !createLine.trim()}
            onClick={async () => {
              setCreateBusy(true);
              setCreateErr("");
              setCreateMsg("");
              setCreateAudioUrl("");
              setCreateTestUrl("");
              try {
                const payload = {
                  name: createName.trim(),
                  tags: tagsToArray(createTags),
                  description: createDesc.trim(),
                  text: createLine.trim(),
                };
                const j = await postJson("/api/voices/studio/design", payload);
                if (j.voice) {
                  const v: Voice = j.voice;
                  upsertVoiceClient(v);
                  setSelectedVoiceId(v.voiceId);
                }
                setCreateAudioUrl(String(j.audioUrl || ""));
                setCreateMsg("Voice created.");
                await refreshLibrary();
              } catch (e: any) {
                setCreateErr(e?.message || "Create failed.");
              } finally {
                setCreateBusy(false);
              }
            }}
          >
            {createBusy ? "Generating…" : "Generate voice"}
          </button>

          {createAudioUrl ? (
            <a className="otg-btnGhost" href={createAudioUrl} download>
              Download sample
            </a>
          ) : null}
        </div>

        {createErr ? <div className="otg-errorText" style={{ marginTop: 10 }}>{createErr}</div> : null}
        {createMsg ? <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>{createMsg}</div> : null}

        {createAudioUrl ? (
          <div style={{ marginTop: 12 }}>
            <audio controls src={createAudioUrl} style={{ width: "100%" }} />
          </div>
        ) : null}

        <div className="otg-divider" />

        <div className="otg-label">Test voice (optional)</div>
        <textarea
          className="otg-input"
          rows={3}
          value={createTestText}
          onChange={(e) => setCreateTestText(e.target.value.slice(0, limits.ttsMaxTextLen))}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>{createTestText.length}/{limits.ttsMaxTextLen}</div>

        <div className="otg-row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="otg-btn"
            disabled={createBusy || !selectedVoiceId || !createTestText.trim()}
            onClick={async () => {
              if (!selectedVoiceId) return;
              setCreateBusy(true);
              setCreateErr("");
              setCreateMsg("");
              setCreateTestUrl("");
              try {
                const url = await generateTts(selectedVoiceId, createTestText.trim());
                setCreateTestUrl(url);
                setCreateMsg("Test generated.");
              } catch (e: any) {
                setCreateErr(e?.message || "Test failed.");
              } finally {
                setCreateBusy(false);
              }
            }}
          >
            Generate test
          </button>
          {createTestUrl ? (
            <a className="otg-btnGhost" href={createTestUrl} download>
              Download test
            </a>
          ) : null}
        </div>

        {createTestUrl ? (
          <div style={{ marginTop: 12 }}>
            <audio controls src={createTestUrl} style={{ width: "100%" }} />
          </div>
        ) : null}
      </div>
    </div>
  );

  const groupPanel = (
    <div className="otg-card" style={{ padding: 12 }}>
      <div className="otg-cardTitle">Group Voices</div>

      <div className="otg-cardBody">
        <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="otg-label" style={{ margin: 0 }}>Roles (2–8)</div>
          <button
            type="button"
            className="otg-btnGhost"
            disabled={roles.length >= 8}
            onClick={() => {
              // Add a role with default selection (first non-used voice).
              const used = new Set(roles.map((r) => r.voiceId).filter(Boolean));
              const cand = voices.find((v) => !used.has(v.voiceId));
              const roleVoice = cand || voices[0];
              if (!roleVoice) return;
              setRoles((prev) => [...prev, { voiceId: roleVoice.voiceId, roleName: roleVoice.name, refText: roleVoice.refText || "", presetId: "" }]);
              if (!lines.length) addDefaultLine(1);
            }}
          >
            + Add role
          </button>
        </div>

        {roles.length ? (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {roles.map((r, i) => {
              const idx = i + 1;
              return (
                <div key={idx} className="otg-card" style={{ padding: 10 }}>
                  <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 900 }}>Role {idx}</div>
                    <button
                      type="button"
                      className={cls("otg-btn", "otg-btnDanger")}
                      onClick={() => {
                        setRoles((prev) => prev.filter((_, j) => j !== i));
                        setLines((prev) => prev.filter((ln) => ln.roleIndex !== idx).map((ln) => ({ ...ln, roleIndex: ln.roleIndex > idx ? ln.roleIndex - 1 : ln.roleIndex })));
                      }}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="otg-row otg-gap" style={{ marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ flex: "1 1 220px" }}>
                      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Voice</div>
                      <select
                        className="otg-select"
                        value={r.voiceId}
                        onChange={(e) => {
                          const vid = e.target.value;
                          const v = voices.find((x) => x.voiceId === vid);
                          if (vid) refreshPresets(vid);
                          setRoles((prev) => {
                            const next = prev.slice();
                            next[i] = {
                              voiceId: vid,
                              presetId: "",
                              roleName: (prev[i]?.roleName || "").trim() || (v?.name || `Role${idx}`),
                              refText: (prev[i]?.refText || "").trim() || (v?.refText || ""),
                            };
                            return next;
                          });
                        }}
                        style={{ width: "100%" }}
                      >
                        {voices.map((v) => (
                          <option key={v.voiceId} value={v.voiceId}>
                            {v.name} ({v.type})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ flex: "1 1 220px" }}>
                      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Emotion preset</div>
                      <select
                        className="otg-select"
                        value={r.presetId || ""}
                        onChange={(e) => {
                          const pid = e.target.value;
                          setRoles((prev) => {
                            const next = prev.slice();
                            next[i] = { ...next[i], presetId: pid };
                            return next;
                          });
                        }}
                        style={{ width: "100%" }}
                        disabled={!r.voiceId}
                      >
                        <option value="">(none)</option>
                        {(presetsByVoice[r.voiceId] || []).map((p) => (
                          <option key={p.presetId} value={p.presetId}>
                            {p.label} ({p.emotion}{p.intensityTag ? ` ${p.intensityTag}/5` : ""})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ flex: "1 1 220px" }}>
                      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Role name</div>
                      <input
                        className="otg-input"
                        value={r.roleName}
                        onChange={(e) => setRoles((prev) => {
                          const next = prev.slice();
                          next[i] = { ...next[i], roleName: e.target.value };
                          return next;
                        })}
                        placeholder={`Role${idx}`}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Reference text (prompt for ref_audio)</div>
                    <textarea
                      className="otg-input"
                      rows={3}
                      value={r.refText}
                      onChange={(e) => setRoles((prev) => {
                        const next = prev.slice();
                        next[i] = { ...next[i], refText: e.target.value };
                        return next;
                      })}
                      style={{ width: "100%", resize: "vertical" }}
                      placeholder="(If empty, the stored transcription will be used.)"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>Add at least 2 roles.</div>
        )}

        <div className="otg-divider" />

        <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="otg-label" style={{ margin: 0 }}>Dialogue Builder</div>
          <div className="otg-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className={cls("otg-btnGhost", scriptLabelMode === "roleIndex" ? "" : "otg-btnGhost")} onClick={() => setScriptLabelMode("roleIndex")}>
              Use Role1/Role2 labels
            </button>
            <button type="button" className={cls("otg-btnGhost", scriptLabelMode === "roleName" ? "" : "otg-btnGhost")} onClick={() => setScriptLabelMode("roleName")}>
              Use role names
            </button>
          </div>
        </div>

        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          {lines.map((ln, idx) => (
            <div key={ln.id} className="otg-card" style={{ padding: 10 }}>
              <div className="otg-row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  className="otg-select"
                  value={ln.roleIndex}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setLines((prev) => prev.map((x) => (x.id === ln.id ? { ...x, roleIndex: n } : x)));
                  }}
                >
                  {roles.map((r, i) => (
                    <option key={i + 1} value={i + 1}>
                      Role {i + 1} — {r.roleName || `Role${i + 1}`}
                    </option>
                  ))}
                </select>

                <input
                  className="otg-input"
                  style={{ flex: "1 1 320px" }}
                  value={ln.text}
                  onChange={(e) => setLines((prev) => prev.map((x) => (x.id === ln.id ? { ...x, text: e.target.value } : x)))}
                  placeholder="Line of dialogue"
                />

                <button type="button" className="otg-btnGhost" onClick={() => {
                  setLines((prev) => prev.filter((x) => x.id !== ln.id));
                }}>Delete</button>

                <button type="button" className="otg-btnGhost" disabled={idx === 0} onClick={() => {
                  setLines((prev) => {
                    const next = prev.slice();
                    const i = next.findIndex((x) => x.id === ln.id);
                    if (i <= 0) return prev;
                    const tmp = next[i - 1];
                    next[i - 1] = next[i];
                    next[i] = tmp;
                    return next;
                  });
                }}>↑</button>

                <button type="button" className="otg-btnGhost" disabled={idx === lines.length - 1} onClick={() => {
                  setLines((prev) => {
                    const next = prev.slice();
                    const i = next.findIndex((x) => x.id === ln.id);
                    if (i < 0 || i >= next.length - 1) return prev;
                    const tmp = next[i + 1];
                    next[i + 1] = next[i];
                    next[i] = tmp;
                    return next;
                  });
                }}>↓</button>
              </div>
            </div>
          ))}
        </div>

        <div className="otg-row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="otg-btnGhost"
            disabled={!roles.length}
            onClick={() => addDefaultLine(Math.min(roles.length, 2) || 1)}
          >
            + Add line
          </button>

          <button
            type="button"
            className="otg-btnGhost"
            disabled={!lines.length}
            onClick={() => setLines([])}
          >
            Clear lines
          </button>
        </div>

        <details className="otg-details" style={{ marginTop: 10 }}>
          <summary>Paste dialogue (optional)</summary>
          <div className="otg-detailsContent">
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
              Format: <code>Role1: hello</code> or <code>{roles[0]?.roleName || "Name"}: hello</code> per line.
            </div>
            <textarea className="otg-input" rows={4} value={pasteBox} onChange={(e) => setPasteBox(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
            <div className="otg-row" style={{ marginTop: 8, gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="otg-btn" onClick={parsePastedDialogue} disabled={!pasteBox.trim() || !roles.length}>
                Parse
              </button>
              <button type="button" className="otg-btnGhost" onClick={() => setPasteBox("")}>Clear</button>
            </div>
          </div>
        </details>

        <div className="otg-label" style={{ marginTop: 12 }}>Compiled script</div>
        <textarea
          className="otg-input"
          rows={6}
          value={compiledScript}
          readOnly
          style={{ width: "100%", resize: "vertical", opacity: compiledScript ? 1 : 0.75 }}
          placeholder="Dialogue will compile here."
        />
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>{compiledScript.length}/{limits.scriptMaxTextLen}</div>

        <div className="otg-row" style={{ marginTop: 12, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="otg-btnPrimary" disabled={groupBusy || roles.length < 2 || !compiledScript.trim()} onClick={runGroup}>
            {groupBusy ? "Generating…" : "Generate dialogue clip"}
          </button>
          {groupAudioUrl ? (
            <a className="otg-btnGhost" href={groupAudioUrl} download>
              Download
            </a>
          ) : null}
        </div>

        {groupErr ? <div className="otg-errorText" style={{ marginTop: 10 }}>{groupErr}</div> : null}
        {groupMsg ? <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>{groupMsg}</div> : null}

        {groupAudioUrl ? (
          <div style={{ marginTop: 12 }}>
            <audio controls src={groupAudioUrl} style={{ width: "100%" }} />
          </div>
        ) : null}
      </div>
    </div>
  );

  const controlPanel = (
    <div className="otg-card" style={{ padding: 12 }}>
      <div className="otg-title" style={{ marginBottom: 8 }}>Voice Control (preset speakers)</div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
        Use a preset speaker and add style/emotion instructions. This does not change your cloned voice; it is for testing expression control.
      </div>

      <div className="otg-row" style={{ gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 260px" }}>
          <div className="otg-label">Speaker</div>
          <select className="otg-select" value={ctlSpeaker} onChange={(e) => setCtlSpeaker(e.target.value)}>
            {[
              "aiden",
              "ryan",
              "dylan",
              "eric",
              "ono_anna",
              "serena",
              "sohee",
              "uncle_fu",
              "vivian",
            ].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="otg-label">Style / emotion instructions</div>
        <textarea className="otg-input" rows={3} value={ctlStyle} onChange={(e) => setCtlStyle(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
        <div className="otg-row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button type="button" className="otg-btnGhost" onClick={() => setCtlStyle("Very sad and tearful voice. Slow pace. Soft volume. Long pauses.")}>Sad</button>
          <button type="button" className="otg-btnGhost" onClick={() => setCtlStyle("Very happy and excited. Bright tone. Slightly faster pace. Smiling while speaking.")}>Happy</button>
          <button type="button" className="otg-btnGhost" onClick={() => setCtlStyle("Furious and angry. Loud, forceful. Sharp emphasis on key words.")}>Angry</button>
          <button type="button" className="otg-btnGhost" onClick={() => setCtlStyle("Calm, serious, authoritative. Measured pace. Clear enunciation.")}>Serious</button>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="otg-label">Text</div>
        <textarea className="otg-input" rows={4} value={ctlText} onChange={(e) => setCtlText(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
      </div>

      <div className="otg-row" style={{ marginTop: 12, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="otg-btnPrimary" disabled={ctlBusy} onClick={runControl}>
          {ctlBusy ? "Generating…" : "Generate (control)"}
        </button>
        {ctlAudioUrl ? (
          <a className="otg-btnGhost" href={ctlAudioUrl} download>
            Download
          </a>
        ) : null}
      </div>

      {ctlErr ? <div className="otg-errorText" style={{ marginTop: 10 }}>{ctlErr}</div> : null}
      {ctlAudioUrl ? (
        <div style={{ marginTop: 12 }}>
          <audio controls src={ctlAudioUrl} style={{ width: "100%" }} />
        </div>
      ) : null}
    </div>
  );

  const mainPanel = mode === "clone" ? clonePanel : mode === "create" ? createPanel : mode === "control" ? controlPanel : groupPanel;

  return (
    <div className="otg-card">
      <div className="otg-cardHeader">
        <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div className="otg-title">Voice Studio</div>
          <div className="otg-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="otg-btnGhost" onClick={() => setTutorialOpen(true)}>
              Tutorial
            </button>
            <button type="button" className={mode === "clone" ? "otg-pill" : "otg-pill-ghost"} onClick={() => setMode("clone")}>Clone Voice</button>
            <button type="button" className={mode === "create" ? "otg-pill" : "otg-pill-ghost"} onClick={() => setMode("create")}>Create Voice</button>
            <button type="button" className={mode === "control" ? "otg-pill" : "otg-pill-ghost"} onClick={() => setMode("control")}>Voice Control</button>
            <button type="button" className={mode === "group" ? "otg-pill" : "otg-pill-ghost"} onClick={() => setMode("group")}>Group Voices</button>
          </div>
        </div>
      </div>

      {tutorialOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0,0,0,.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setTutorialOpen(false)}
        >
          <div
            className="otg-card"
            style={{ width: "min(920px, 100%)", maxHeight: "85vh", overflow: "auto", padding: 14 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>How to get emotion in cloned + designed voices</div>
              <button type="button" className="otg-btnGhost" onClick={() => setTutorialOpen(false)}>
                Close
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 12, fontSize: 13, lineHeight: 1.45 }}>
              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>A) Cloned voice with emotion (recommended)</div>
                <ol style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
                  <li>Go to <b>Clone Voice</b> and create a voice slot (name + tags).</li>
                  <li>Upload a clean <b>neutral</b> reference clip (3–30 seconds). Click <b>Auto-transcribe</b> and save the reference text.</li>
                  <li>Under <b>Emotion Presets</b>, pick an emotion (e.g., calm / angry), then upload a second clip recorded in that emotion.</li>
                  <li>Click <b>Transcribe preset</b> and <b>Save preset text</b>. Select the preset in <b>Use preset for generation</b>.</li>
                  <li>Generate previews. Switch presets to change delivery (emotion) without making a new voice.</li>
                </ol>
                <div style={{ marginTop: 8, opacity: 0.85 }}>
                  Recording tips: minimal noise, no music, consistent mic distance, avoid clipping. If you want “sad”, record a genuinely sad line; the model copies prosody best when the reference contains it.
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>B) Created voice design with emotion</div>
                <div style={{ opacity: 0.95 }}>
                  In <b>Create Voice</b>, emotion comes from the <b>Voice description</b>. Use explicit natural-language style instructions.
                </div>
                <div style={{ marginTop: 8 }}>
                  Example fragments:
                  <ul style={{ paddingLeft: 18, margin: "6px 0 0", display: "grid", gap: 4 }}>
                    <li><code>speak with excitement and enthusiasm; energetic pace; bright tone</code></li>
                    <li><code>calm, reassuring, warm; slow pace with gentle pauses</code></li>
                    <li><code>sad and tearful; voice breaks slightly; slower, heavier delivery</code></li>
                    <li><code>angry and frustrated; sharper consonants; tight breath control</code></li>
                  </ul>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>C) Group conversation with emotion</div>
                <ol style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
                  <li>Go to <b>Group Voices</b> and add roles.</li>
                  <li>Select a voice for each role. Optionally pick an <b>Emotion preset</b> per role to drive that character’s delivery.</li>
                  <li>Write dialogue lines. For stronger control, include short emotional stage directions in the text (e.g., “(whispering) …”, “(angry) …”).</li>
                </ol>
              </div>

              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>If emotion still sounds flat</div>
                <ul style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
                  <li>Use a better emotion reference clip (cleaner, more expressive).</li>
                  <li>Keep reference clips short and focused (one emotional mode per preset).</li>
                  <li>Save accurate transcription for the reference clip/preset (improves cloning alignment).</li>
                  <li>Use “Voice Design” for characters that need a consistent emotional baseline.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="otg-cardSection">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 560px", minWidth: 280 }}>{mainPanel}</div>
          {libraryCard}
        </div>

        {/* quick info */}
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
          Tips: Clone = upload a clip, transcribe with Whisper, then generate previews. Create = describe a character voice and generate a reference sample. Group = assign roles and build dialogue lines.
        </div>
      </div>
    </div>
  );
}

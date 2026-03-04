
"use client";

import * as React from "react";

type Mode = "extract" | "clone" | "tts";

type CatalogVoice = {
  id: string;
  name: string;
  type?: "preset" | "character";
  description?: string;
};

export default function VoicesPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const [mode, setMode] = React.useState<Mode>("extract");

  const [catalog, setCatalog] = React.useState<CatalogVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = React.useState<string>("");

  const refreshCatalog = React.useCallback(async () => {
    try {
      const res = await fetch("/api/voices/list");
      const json = await res.json();
      if (res.ok && json?.voices) {
        setCatalog(json.voices);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  React.useEffect(() => {
    if (!selectedVoiceId && catalog.length) {
      setSelectedVoiceId(catalog[0].id);
    }
  }, [catalog, selectedVoiceId]);

  const [videoFile, setVideoFile] = React.useState<File | null>(null);
  const [startSec, setStartSec] = React.useState(0);
  const [endSec, setEndSec] = React.useState(30);
  const [busy, setBusy] = React.useState(false);
  const [audioId, setAudioId] = React.useState("");
  const [audioUrl, setAudioUrl] = React.useState("");
  const [msg, setMsg] = React.useState("");

  const [characterName, setCharacterName] = React.useState("");
  const [cloneBusy, setCloneBusy] = React.useState(false);
  const [cloneMsg, setCloneMsg] = React.useState("");
  const [previewUrl, setPreviewUrl] = React.useState("");
  const PREVIEW_TEXT = "This is a test preview of the current cloned voice.";

  const onExtract = async () => {
    if (!videoFile) return setMsg("Select a video first.");
    if (endSec <= startSec) return setMsg("End must be greater than Start.");

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("video", videoFile);
      fd.append("start", String(startSec));
      fd.append("end", String(endSec));

      const res = await fetch("/api/voices/extract", { method: "POST", body: fd });
      const json = await res.json();

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Extract failed");

      setAudioId(json.audioId);
      setAudioUrl(json.audioUrl);
      setMode("clone");
      setMsg("Extracted. Ready to clone.");
    } catch (e: any) {
      setMsg(e?.message ?? "Extract failed");
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async (voiceId: string) => {
    try {
      const res = await fetch("/api/voices/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId, text: PREVIEW_TEXT }),
      });
      const json = await res.json();
      if (res.ok && json?.audioUrl) {
        setPreviewUrl(json.audioUrl);
      }
    } catch {}
  };

  const onClone = async () => {
    if (!audioId) return setCloneMsg("Extract first.");
    if (!characterName.trim()) return setCloneMsg("Enter character name.");

    setCloneBusy(true);
    try {
      const res = await fetch("/api/voices/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extractId: audioId,
          displayName: characterName.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Clone failed");

      await refreshCatalog();
      const newId = json.voiceId ?? json.characterId;
      setSelectedVoiceId(newId);
      await runPreview(newId);

      setCloneMsg("Character created and imported.");
    } catch (e: any) {
      setCloneMsg(e?.message ?? "Clone failed");
    } finally {
      setCloneBusy(false);
    }
  };

  const onTts = async (text: string) => {
    if (!selectedVoiceId) return;

    const res = await fetch("/api/voices/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceId: selectedVoiceId, text }),
    });

    const json = await res.json();
    if (res.ok && json?.audioUrl) {
      setPreviewUrl(json.audioUrl);
    }
  };

  return (
    <div>
      <h2>Voices</h2>

      <div>
        <button onClick={() => setMode("extract")}>Extract</button>
        <button onClick={() => setMode("clone")} disabled={!audioUrl}>Clone</button>
        <button onClick={() => setMode("tts")}>Text-to-Speech</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <select value={selectedVoiceId} onChange={(e) => setSelectedVoiceId(e.target.value)}>
          {catalog.map(v => (
            <option key={v.id} value={v.id}>
              {v.name}{v.type === "character" ? " (Character)" : ""}
            </option>
          ))}
        </select>
      </div>

      {mode === "extract" && (
        <div>
          <input type="file" accept="video/*"
            onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} />
          <input type="number" value={startSec} onChange={(e) => setStartSec(Number(e.target.value))} />
          <input type="number" value={endSec} onChange={(e) => setEndSec(Number(e.target.value))} />
          <button onClick={onExtract} disabled={busy}>
            {busy ? "Extracting..." : "Extract"}
          </button>
          <div>{msg}</div>
        </div>
      )}

      {mode === "clone" && (
        <div>
          {audioUrl && <audio controls src={audioUrl} />}
          <input
            placeholder="Character name"
            value={characterName}
            onChange={(e) => setCharacterName(e.target.value)}
          />
          <button onClick={onClone} disabled={cloneBusy}>
            {cloneBusy ? "Cloning..." : "Clone Character"}
          </button>
          <div>{cloneMsg}</div>
          {previewUrl && <audio controls src={previewUrl} />}
        </div>
      )}

      {mode === "tts" && (
        <div>
          <textarea
            rows={4}
            placeholder="Enter text"
            onBlur={(e) => onTts(e.target.value)}
          />
          {previewUrl && <audio controls src={previewUrl} />}
        </div>
      )}
    </div>
  );
}

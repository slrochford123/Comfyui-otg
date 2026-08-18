"use client";

import * as React from "react";
import VoicesPanel from "./VoicesPanel";

type ProviderId = "minimax_h3" | "ltx25";
type LibraryId = "natural" | "fictional";
type Age = "adult" | "elderly" | "teenager" | "child";
type Presentation = "male" | "female";

type Preset = {
  id: string;
  label: string;
  category: string;
  age: string;
  presentation: string;
  description: string;
  auditionLine: string;
};

type Character = {
  id: string;
  name: string;
  description?: string;
  introLine?: string;
};

type CatalogResponse = {
  ok?: boolean;
  catalogs?: Record<ProviderId, Record<LibraryId, Preset[]>>;
  defaults?: { age?: Age; presentation?: Presentation };
  error?: string;
};

type GeneratedVoice = { voiceId: string; name: string; refText: string; refAudioRel: string };
type GenerateResponse = {
  ok?: boolean;
  error?: string;
  voice?: GeneratedVoice;
  audioUrl?: string;
  target?: { id?: string | null; sageAttentionEnabled?: boolean; removedSageNodeIds?: string[] };
};

const AGE_OPTIONS: Array<{ id: Age; label: string }> = [
  { id: "adult", label: "Adult" },
  { id: "elderly", label: "Elderly" },
  { id: "teenager", label: "Teenager" },
  { id: "child", label: "Child" },
];
const PRESENTATION_OPTIONS: Array<{ id: Presentation; label: string }> = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
];

function deviceId(): string {
  if (typeof window === "undefined") return "otg_voice_creator";
  const key = "otg_device_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = `web_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  window.localStorage.setItem(key, value);
  return value;
}

async function jsonResponse(response: Response): Promise<any> {
  const text = await response.text().catch(() => "");
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

function choiceClass(active: boolean) {
  return `rounded-[18px] border px-4 py-3 text-sm font-bold transition ${active ? "border-cyan-300/45 bg-cyan-400 text-slate-950" : "border-white/10 bg-white/5 text-white hover:bg-white/10"}`;
}

export default function VoiceCreatorPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const [catalogs, setCatalogs] = React.useState<CatalogResponse["catalogs"]>();
  const [characters, setCharacters] = React.useState<Character[]>([]);
  const [characterId, setCharacterId] = React.useState("");
  const [provider, setProvider] = React.useState<ProviderId>("ltx25");
  const [library, setLibrary] = React.useState<LibraryId>("natural");
  const [age, setAge] = React.useState<Age>("adult");
  const [presentation, setPresentation] = React.useState<Presentation>("male");
  const [presetId, setPresetId] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [sampleText, setSampleText] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [audioUrl, setAudioUrl] = React.useState("");
  const [generatedVoice, setGeneratedVoice] = React.useState<GeneratedVoice | null>(null);
  const [target, setTarget] = React.useState<GenerateResponse["target"]>();
  const [approved, setApproved] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [catalogRes, characterRes] = await Promise.all([
          fetch("/api/voices/creator", { cache: "no-store", credentials: "include" }),
          fetch("/api/characters", { cache: "no-store", credentials: "include" }),
        ]);
        const catalogJson = (await jsonResponse(catalogRes)) as CatalogResponse;
        const characterJson = await jsonResponse(characterRes);
        if (catalogRes.status === 401 || characterRes.status === 401) {
          window.location.href = "/login?reason=session";
          return;
        }
        if (!catalogRes.ok || !catalogJson.ok || !catalogJson.catalogs) throw new Error(catalogJson.error || "Voice catalog failed to load.");
        if (!characterRes.ok || !characterJson?.ok) throw new Error(characterJson?.error || "Characters failed to load.");
        if (cancelled) return;
        setCatalogs(catalogJson.catalogs);
        const items = Array.isArray(characterJson.items) ? characterJson.items : [];
        setCharacters(items);
        setCharacterId(items[0]?.id || "");
        setAge(catalogJson.defaults?.age || "adult");
        setPresentation(catalogJson.defaults?.presentation || "male");
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Audio Studios failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const presets = React.useMemo(() => catalogs?.[provider]?.[library] || [], [catalogs, provider, library]);
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? presets.filter((p) => `${p.id} ${p.label} ${p.category}`.toLowerCase().includes(q)) : presets;
  }, [presets, search]);
  const preset = React.useMemo(() => presets.find((p) => p.id === presetId) || null, [presets, presetId]);
  const character = React.useMemo(() => characters.find((c) => c.id === characterId) || null, [characters, characterId]);

  React.useEffect(() => {
    setPresetId((current) => presets.some((p) => p.id === current) ? current : (presets[0]?.id || ""));
  }, [presets]);

  React.useEffect(() => {
    if (!preset) return;
    setSampleText(String(character?.introLine || "").trim() || preset.auditionLine);
    setAudioUrl("");
    setGeneratedVoice(null);
    setApproved(false);
    setMessage("");
  }, [preset?.id, characterId]);

  async function post(body: Record<string, unknown>): Promise<GenerateResponse> {
    const response = await fetch("/api/voices/creator", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-otg-device-id": deviceId() },
      body: JSON.stringify(body),
    });
    const json = (await jsonResponse(response)) as GenerateResponse;
    if (response.status === 401) {
      window.location.href = "/login?reason=session";
      throw new Error("Unauthorized");
    }
    if (!response.ok || !json.ok) throw new Error(json.error || `Voice request failed (${response.status}).`);
    return json;
  }

  async function generate() {
    if (!character || !preset || !sampleText.trim()) return;
    setBusy(true); setError(""); setMessage(""); setAudioUrl(""); setGeneratedVoice(null); setApproved(false);
    try {
      const result = await post({ action: "generate", characterId: character.id, provider, library, presetId: preset.id, age, presentation, text: sampleText.trim(), durationSeconds: 10 });
      setAudioUrl(String(result.audioUrl || ""));
      setGeneratedVoice(result.voice || null);
      setTarget(result.target);
      setMessage("Audition ready. Listen, regenerate if needed, then approve this voice for the character.");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Voice generation failed."); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!character || !preset || !generatedVoice) return;
    setApproving(true); setError(""); setMessage("");
    try {
      await post({ action: "approve", characterId: character.id, voiceId: generatedVoice.voiceId, provider, library, presetId: preset.id, age, presentation });
      setApproved(true);
      setMessage("Voice approved and attached to the character.");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Voice approval failed."); }
    finally { setApproving(false); }
  }

  if (loading) return <div className="rounded-[24px] border border-white/10 bg-black/35 p-5 text-sm text-white/65">Loading Audio Studios…</div>;

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-white/10 bg-black/40 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-white sm:text-2xl">Audio Studios</h1>
            <p className="mt-1 max-w-3xl text-sm text-white/65">Choose a character and curated voice. Generate a clean 10-second reference, approve it, then move on to optional Voice Effects.</p>
          </div>
          <div className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs font-bold text-cyan-100">Character Voice Creator</div>
        </div>

        {!characters.length ? <div className="mt-5 rounded-[20px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">Finish and save a character first, then return to Audio Studios.</div> : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="space-y-2 text-sm text-white/75">
            <span className="font-semibold">Character</span>
            <select className="w-full rounded-[18px] border border-white/10 bg-black/55 px-4 py-3 text-white" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>{characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <div className="space-y-2 text-sm text-white/75">
            <span className="font-semibold">Voice model</span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={choiceClass(provider === "ltx25")} onClick={() => setProvider("ltx25")}>LTX 2.5<span className="mt-1 block text-[11px] font-medium opacity-70">84 natural · 100 fictional</span></button>
              <button type="button" className={choiceClass(provider === "minimax_h3")} onClick={() => setProvider("minimax_h3")}>MiniMax H3<span className="mt-1 block text-[11px] font-medium opacity-70">37 natural · 100 fictional</span></button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className={choiceClass(library === "natural")} onClick={() => setLibrary("natural")}>Natural / Human</button>
          <button type="button" className={choiceClass(library === "fictional")} onClick={() => setLibrary("fictional")}>Unnatural / Fictional</button>
        </div>

        {library === "natural" ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-sm text-white/75"><span className="font-semibold">Age</span><select className="w-full rounded-[18px] border border-white/10 bg-black/55 px-4 py-3 text-white" value={age} onChange={(e) => setAge(e.target.value as Age)}>{AGE_OPTIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
          <label className="space-y-2 text-sm text-white/75"><span className="font-semibold">Voice</span><select className="w-full rounded-[18px] border border-white/10 bg-black/55 px-4 py-3 text-white" value={presentation} onChange={(e) => setPresentation(e.target.value as Presentation)}>{PRESENTATION_OPTIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        </div> : null}
      </section>

      <section className="rounded-[28px] border border-white/10 bg-black/40 p-4 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
          <div className="space-y-3">
            <input className="w-full rounded-[18px] border border-white/10 bg-black/55 px-4 py-3 text-white placeholder:text-white/35" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accent, creature, robot…" />
            <select className="w-full rounded-[18px] border border-white/10 bg-black/55 px-4 py-3 text-white" value={presetId} onChange={(e) => setPresetId(e.target.value)}>{filtered.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.label}</option>)}</select>
            {preset ? <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-4"><div className="font-bold text-white">{preset.label}</div><div className="mt-1 text-xs font-semibold uppercase tracking-wide text-cyan-200/80">{preset.category}</div><div className="mt-2 text-sm leading-6 text-white/65">{preset.description}</div></div> : null}
          </div>

          <div className="space-y-3">
            <label className="block space-y-2 text-sm text-white/75"><span className="font-semibold">Audition line</span><textarea rows={5} maxLength={600} className="w-full resize-y rounded-[20px] border border-white/10 bg-black/55 px-4 py-3 text-white" value={sampleText} onChange={(e) => setSampleText(e.target.value)} /><span className="text-xs text-white/45">{sampleText.length}/600 · Stored as the clean character reference when approved.</span></label>
            <button type="button" disabled={busy || !character || !preset || !sampleText.trim()} onClick={generate} className="w-full rounded-[20px] border border-cyan-300/30 bg-cyan-400 px-5 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Generating audition…" : "Generate 10-second audition"}</button>
            {error ? <div className="rounded-[16px] border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">{error}</div> : null}
            {message ? <div className="rounded-[16px] border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{message}</div> : null}
            {audioUrl ? <div className="rounded-[20px] border border-white/10 bg-white/[0.035] p-4">
              <audio controls src={audioUrl} className="w-full" />
              {target ? <div className="mt-2 text-xs text-white/45">Render target: {target.id || "default"} · Sage Attention: {target.sageAttentionEnabled ? "on" : "off"}</div> : null}
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" onClick={generate} disabled={busy} className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-white">Regenerate</button><button type="button" onClick={approve} disabled={approving || !generatedVoice} className="rounded-[16px] border border-emerald-300/30 bg-emerald-400 px-4 py-2.5 text-sm font-black text-slate-950 disabled:opacity-40">{approving ? "Approving…" : "Approve character voice"}</button></div>
            </div> : null}
          </div>
        </div>
      </section>

      {approved ? <section className="rounded-[28px] border border-emerald-300/20 bg-emerald-400/10 p-4 sm:p-6"><div className="text-lg font-black text-emerald-50">Voice complete</div><div className="mt-1 text-sm text-emerald-50/75">The approved reference is attached to this character. Voice Effects is the next optional step.</div></section> : null}

      {isAdmin ? <details className="rounded-[28px] border border-amber-300/15 bg-amber-300/[0.04] p-4 sm:p-6"><summary className="cursor-pointer text-sm font-black text-amber-100">Admin: Legacy Voice Studio</summary><div className="mt-4"><VoicesPanel isAdmin /></div></details> : null}
    </div>
  );
}

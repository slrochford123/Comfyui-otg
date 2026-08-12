"use client";

import React, { useEffect, useMemo, useState } from "react";

export type VideoLoraSelectionValue = {
  id: string;
  strength: number;
  highNoiseStrength?: number;
  lowNoiseStrength?: number;
};

type ApiEntry = {
  id: string;
  displayName: string;
  family: "wan" | "ltx";
  baseModelVariant: string;
  supportedModes: string[];
  description: string;
  triggerWords: string[];
  recommendedStrength: number;
  defaultStrength: number;
  allowedRange: { minimum: number; maximum: number };
  promptExample: string;
  dependencies: string[];
  limitations: string[];
  license: string;
  commercialUse: string;
  installedState: Record<string, { installed: boolean; inventoryAvailable: boolean }>;
  selectable: boolean;
  compatibilityReason: string | null;
};

type ApiResponse = {
  ok: boolean;
  selectedBackend?: { id: string; label: string; gpu: string };
  entries?: ApiEntry[];
  compatibleEntries?: ApiEntry[];
  error?: string;
};

export function shouldShowVideoLoraPanel(mediaMode: string, family: string | null | undefined) {
  return mediaMode === "video" && (family === "wan" || family === "ltx");
}

export type TriggerWordAppendResult = {
  prompt: string;
  status: "added" | "already_present" | "empty";
  addedWords: string[];
};

export function appendUniqueVideoLoraTriggerWords(prompt: string, words: string[]): TriggerWordAppendResult {
  const uniqueWords: string[] = [];
  const seenWords = new Set<string>();
  for (const value of words) {
    const word = String(value || "").trim();
    const normalized = word.toLocaleLowerCase();
    if (!word || seenWords.has(normalized)) continue;
    seenWords.add(normalized);
    uniqueWords.push(word);
  }
  if (!uniqueWords.length) return { prompt, status: "empty", addedWords: [] };

  const normalizedPrompt = prompt.toLocaleLowerCase();
  const addedWords = uniqueWords.filter((word) => !normalizedPrompt.includes(word.toLocaleLowerCase()));
  if (!addedWords.length) return { prompt, status: "already_present", addedWords: [] };

  const existing = prompt.trimEnd();
  const addition = addedWords.join(", ");
  const nextPrompt = existing
    ? `${existing}${existing.endsWith(",") ? " " : ", "}${addition}`
    : addition;
  return { prompt: nextPrompt, status: "added", addedWords };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

export default function VideoLoraPanel({
  workflowId,
  family,
  value,
  onChange,
  prompt,
  onPromptChange,
}: {
  workflowId: string;
  family: "wan" | "ltx";
  value: VideoLoraSelectionValue[];
  onChange: (value: VideoLoraSelectionValue[]) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [triggerMessage, setTriggerMessage] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(value.map((selection) => selection.id)));

  useEffect(() => {
    if (!workflowId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setTriggerMessage("");
    setExpandedIds(new Set(value.map((selection) => selection.id)));
    fetch(`/api/video-loras?workflowId=${encodeURIComponent(workflowId)}`, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) throw new Error(String(payload?.error || "Unable to load Video LoRAs."));
        setData(payload);
        const allowed = new Set((payload?.compatibleEntries || []).map((entry: ApiEntry) => entry.id));
        onChange(value.filter((selection) => allowed.has(selection.id)));
      })
      .catch((cause) => {
        if (cause?.name !== "AbortError") setError(String(cause?.message || cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // value and onChange are intentionally excluded: this request follows workflow changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  const entries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.entries || data?.compatibleEntries || []).filter((entry) => {
      if (!needle) return true;
      return [entry.displayName, entry.description, entry.baseModelVariant, ...entry.triggerWords]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data, search]);

  const selectedBackendId = data?.selectedBackend?.id || "rtx3090";
  const selectedById = new Map(value.map((selection) => [selection.id, selection]));
  const entryById = new Map((data?.entries || data?.compatibleEntries || []).map((entry) => [entry.id, entry]));
  const selectedTriggerWords = value.flatMap((selection) => entryById.get(selection.id)?.triggerWords || []);
  const hasSelectedTriggerWords = selectedTriggerWords.some((word) => String(word || "").trim());

  function addTriggerWords(words: string[]) {
    const result = appendUniqueVideoLoraTriggerWords(prompt, words);
    if (result.status === "added") {
      onPromptChange(result.prompt);
      setTriggerMessage("Trigger words added");
    } else if (result.status === "already_present") {
      setTriggerMessage("Trigger words already present");
    }
  }

  function select(entry: ApiEntry) {
    if (selectedById.has(entry.id) || value.length >= 2) return;
    const installed = entry.installedState?.[selectedBackendId]?.installed;
    if (!entry.selectable || !installed) return;
    setTriggerMessage("");
    setExpandedIds((current) => new Set(current).add(entry.id));
    onChange([...value, { id: entry.id, strength: entry.defaultStrength }]);
  }

  function update(id: string, patch: Partial<VideoLoraSelectionValue>) {
    onChange(value.map((selection) => selection.id === id ? { ...selection, ...patch } : selection));
  }

  function remove(id: string) {
    setTriggerMessage("");
    setExpandedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    onChange(value.filter((selection) => selection.id !== id));
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section aria-labelledby="video-loras-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="video-loras-heading" className="text-lg font-black text-white">Video LoRAs</h3>
          <p className="mt-1 text-sm text-white/55">{value.length} of 2 selected. Internal workflow LoRAs stay active and are not listed.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!hasSelectedTriggerWords}
            onClick={() => addTriggerWords(selectedTriggerWords)}
            className="min-h-11 rounded-full border border-cyan-300/25 bg-cyan-500/10 px-4 text-sm font-black text-cyan-50 disabled:cursor-not-allowed disabled:opacity-35"
          >
            Add trigger words
          </button>
          {value.length ? (
            <button type="button" onClick={() => { setTriggerMessage(""); onChange([]); }} className="min-h-11 rounded-full border border-white/15 px-4 text-sm font-black text-white/75">
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      {triggerMessage ? <p role="status" className="rounded-[14px] border border-cyan-300/20 bg-cyan-500/10 px-3 py-2 text-sm font-bold text-cyan-50">{triggerMessage}</p> : null}

      <label className="block">
        <span className="sr-only">Search Video LoRAs</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search compatible Video LoRAs"
          className="min-h-12 w-full rounded-[18px] border border-white/10 bg-black/35 px-4 text-white outline-none focus:border-cyan-300/50"
        />
      </label>

      {loading ? <p className="text-sm text-white/55">Checking the installed LoRA inventory…</p> : null}
      {error ? <p role="alert" className="rounded-[16px] border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}
      {!loading && !error && family === "wan" && !(data?.compatibleEntries || []).length ? (
        <p className="rounded-[16px] border border-amber-400/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-50">
          No approved Wan LoRAs are currently available. Installed files must be added to the compatibility catalog before use.
        </p>
      ) : null}
      {!loading && !error && family !== "wan" && !entries.length ? (
        <p className="rounded-[16px] border border-amber-400/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-50">
          No curated, selectable {family.toUpperCase()} LoRA is compatible with this workflow on the selected backend.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {entries.map((entry) => {
          const selection = selectedById.get(entry.id);
          const installed = entry.installedState?.[selectedBackendId]?.installed || false;
          const disabled = !selection && (value.length >= 2 || !installed || !entry.selectable);
          const expanded = expandedIds.has(entry.id);
          const detailsId = `video-lora-details-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          return (
            <article key={entry.id} className="min-w-0 rounded-[20px] border border-white/10 bg-white/[0.035] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-black text-white">{entry.displayName}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider">
                    <span className={installed ? "rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-100" : "rounded-full bg-amber-500/15 px-2 py-1 text-amber-100"}>{installed ? "Installed" : "Not installed"}</span>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-white/65">{entry.family.toUpperCase()}</span>
                    {selection ? <span className="rounded-full bg-purple-500/20 px-2 py-1 text-purple-100">Selected</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {selection ? (
                    <button type="button" onClick={() => remove(entry.id)} className="min-h-10 rounded-full border border-red-400/25 px-3 text-xs font-black text-red-100">Remove</button>
                  ) : (
                    <button type="button" disabled={disabled} onClick={() => select(entry)} className="min-h-10 rounded-full border border-purple-300/30 bg-purple-500/15 px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35">Select</button>
                  )}
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.displayName}`}
                    onClick={() => toggleExpanded(entry.id)}
                    className="min-h-10 rounded-full border border-white/15 px-3 text-xs font-black text-white/80"
                  >
                    {expanded ? "Collapse" : "Expand"}
                  </button>
                </div>
              </div>

              {expanded ? (
                <div id={detailsId} className="mt-4 border-t border-white/10 pt-4">
                  <p className="text-xs font-bold text-cyan-100/70">Modes: {entry.supportedModes.join(", ").replaceAll("_", " ")}</p>
                  <p className="mt-2 text-sm leading-6 text-white/65">{entry.description}</p>
                  <p className="mt-2 text-xs leading-5 text-white/55"><strong className="text-white/75">Trigger words:</strong> {entry.triggerWords.length ? entry.triggerWords.join(", ") : "No trigger word required; follow the prompt example."}</p>
                  <p className="mt-1 text-xs text-white/55"><strong className="text-white/75">Recommended strength:</strong> {entry.recommendedStrength}</p>
                  {!installed ? <p className="mt-2 text-xs text-amber-100">{data?.selectedBackend?.gpu || "Selected backend"} cannot use this LoRA because it is not installed.</p> : null}
                  {!entry.selectable ? <p className="mt-2 text-xs text-amber-100">{entry.compatibilityReason || "This catalog entry is not selectable."}</p> : null}

                  {selection ? (
                    <div className="mt-4 space-y-3 rounded-[16px] border border-purple-300/20 bg-purple-500/10 p-3">
                      <label className="block">
                        <span className="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-white/65"><span>Strength</span><input aria-label={`${entry.displayName} strength`} type="number" min={entry.allowedRange.minimum} max={entry.allowedRange.maximum} step="0.05" value={selection.strength} onChange={(event) => update(entry.id, { strength: clamp(Number(event.target.value), entry.allowedRange.minimum, entry.allowedRange.maximum) })} className="w-24 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-right text-white" /></span>
                        <input type="range" min={entry.allowedRange.minimum} max={entry.allowedRange.maximum} step="0.05" value={selection.strength} onChange={(event) => update(entry.id, { strength: Number(event.target.value) })} className="mt-2 w-full accent-purple-500" />
                      </label>
                      {family === "wan" ? (
                        <div>
                          <label className="flex items-start gap-2 text-xs leading-5 text-white/70">
                            <input type="checkbox" checked={selection.highNoiseStrength === undefined && selection.lowNoiseStrength === undefined} onChange={(event) => event.target.checked ? update(entry.id, { highNoiseStrength: undefined, lowNoiseStrength: undefined }) : update(entry.id, { highNoiseStrength: selection.strength, lowNoiseStrength: selection.strength })} className="mt-1 accent-purple-500" />
                            <span>Use same strength for high and low noise</span>
                          </label>
                          {selection.highNoiseStrength !== undefined || selection.lowNoiseStrength !== undefined ? (
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              {(["highNoiseStrength", "lowNoiseStrength"] as const).map((key) => (
                                <label key={key} className="text-xs font-black text-white/60">{key === "highNoiseStrength" ? "High Noise" : "Low Noise"}<input type="number" min={entry.allowedRange.minimum} max={entry.allowedRange.maximum} step="0.05" value={selection[key] ?? selection.strength} onChange={(event) => update(entry.id, { [key]: clamp(Number(event.target.value), entry.allowedRange.minimum, entry.allowedRange.maximum) })} className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-white" /></label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <details className="mt-4 rounded-[14px] border border-white/10 p-3 text-sm text-white/65">
                    <summary className="cursor-pointer font-black text-white/80">How to use</summary>
                    <div className="mt-3 space-y-3 leading-6">
                      <div><strong className="text-white/80">Prompt example:</strong> {entry.promptExample}</div>
                      {entry.triggerWords.length ? <button type="button" disabled={!selection} onClick={() => addTriggerWords(entry.triggerWords)} className="min-h-10 rounded-full border border-cyan-300/25 bg-cyan-500/10 px-3 text-xs font-black text-cyan-50 disabled:cursor-not-allowed disabled:opacity-35">Add trigger</button> : null}
                      <div><strong className="text-white/80">Dependencies:</strong> {entry.dependencies.join(" ")}</div>
                      <div><strong className="text-white/80">Limitations:</strong> {entry.limitations.join(" ")}</div>
                      <div className={entry.commercialUse === "not_allowed" ? "rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-red-100" : "rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-amber-50"}><strong>License / commercial use:</strong> {entry.license}</div>
                    </div>
                  </details>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

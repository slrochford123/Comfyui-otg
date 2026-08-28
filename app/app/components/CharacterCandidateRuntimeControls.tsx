"use client";

import React from "react";
import type { EditableCharacterCandidate } from "@/lib/client/characterCandidateEditClient";

export type CharacterEditUiStatus = "idle" | "running" | "error";

export function canApplyCharacterCandidateEdit(
  candidate: EditableCharacterCandidate | null,
  requestedChange: string,
  status: CharacterEditUiStatus,
) {
  return Boolean(candidate?.serverPath && requestedChange.trim() && status !== "running");
}

export function CandidateModifyDialog(props: {
  candidate: EditableCharacterCandidate;
  imageSrc: string;
  requestedChange: string;
  negativePrompt: string;
  advancedOpen: boolean;
  status: CharacterEditUiStatus;
  error?: string;
  onRequestedChange: (value: string) => void;
  onNegativePrompt: (value: string) => void;
  onToggleAdvanced: () => void;
  onExpand: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const enabled = canApplyCharacterCandidateEdit(props.candidate, props.requestedChange, props.status);
  return (
    <div
      className="fixed inset-0 z-[10020] overflow-y-auto overscroll-contain bg-black/90 px-3 sm:px-6"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(7.5rem, calc(6rem + env(safe-area-inset-bottom)))",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Modify character candidate"
    >
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-cyan-300/40 bg-zinc-950 p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Modify Candidate</p>
            <h3 className="mt-1 text-lg font-semibold text-zinc-50">{props.candidate.label}</h3>
          </div>
          <button type="button" onClick={props.onCancel} disabled={props.status === "running"} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-40">Close</button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <button type="button" onClick={props.onExpand} className="block touch-manipulation rounded-xl border border-zinc-800 bg-black/30 p-2" aria-label="Expand source candidate">
            <img src={props.imageSrc} alt="Source candidate for edit" draggable={false} onContextMenu={(event) => event.preventDefault()} className="mx-auto max-h-[32dvh] w-full rounded-lg object-contain select-none sm:max-h-[360px]" />
          </button>
          <div>
            <label className="block text-sm font-medium text-zinc-200">
              Requested Change
              <textarea value={props.requestedChange} onChange={(event) => props.onRequestedChange(event.target.value)} disabled={props.status === "running"} rows={4} placeholder="Example: Change the jacket to deep blue leather." className="mt-2 w-full rounded-xl border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-100 outline-none focus:border-cyan-300 disabled:opacity-60" />
            </label>
            <p className="mt-2 text-xs leading-5 text-zinc-400">Identity, face, hairstyle, proportions, pose, composition, clothing, accessories, and unspecified details are preserved automatically.</p>
            <button type="button" onClick={props.onToggleAdvanced} disabled={props.status === "running"} className="mt-3 text-xs font-semibold text-cyan-200 disabled:opacity-40">{props.advancedOpen ? "Hide Advanced" : "Advanced"}</button>
            {props.advancedOpen ? (
              <label className="mt-3 block text-sm text-zinc-300">
                Negative Prompt (optional)
                <textarea value={props.negativePrompt} onChange={(event) => props.onNegativePrompt(event.target.value)} disabled={props.status === "running"} rows={2} className="mt-1 w-full rounded-xl border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-100 outline-none focus:border-cyan-300 disabled:opacity-60" />
              </label>
            ) : null}
          </div>
        </div>
        {props.status === "running" ? <p className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">Applying the edit. Duplicate submissions are blocked until this job finishes.</p> : null}
        {props.status === "error" ? <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{props.error || "The edit failed. Correct the request if needed, then try Apply Edit again."}</p> : null}
        {!props.candidate.serverPath ? <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">This candidate is missing its stable character asset path and cannot be edited.</p> : null}
        <div
          className="sticky z-10 -mx-4 mt-5 flex flex-wrap gap-3 border-t border-zinc-800 bg-zinc-950/95 px-4 pb-1 pt-4 backdrop-blur sm:-mx-5 sm:px-5"
          style={{ bottom: "max(0px, env(safe-area-inset-bottom))" }}
        >
          <button type="button" onClick={props.onApply} disabled={!enabled} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40">{props.status === "running" ? "Applying Edit..." : "Apply Edit"}</button>
          <button type="button" onClick={props.onCancel} disabled={props.status === "running"} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-40">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function ContinueToCharacterCardButton(props: {
  candidate: EditableCharacterCandidate | null;
  busy: boolean;
  onContinue: () => void;
}) {
  if (!props.candidate) return null;
  const enabled = Boolean(props.candidate.serverPath && !props.busy);
  return (
    <button type="button" onClick={props.onContinue} disabled={!enabled} className="rounded-xl border border-emerald-300 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-40">
      {props.busy ? "Preparing Character Card..." : "Continue to Character Card"}
    </button>
  );
}

export function CharacterCardRuntimeActions(props: {
  hasSource: boolean;
  hasCard: boolean;
  busy: boolean;
  gated: boolean;
  onCreate: () => void;
  onAccept: () => void;
  onBack: () => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" onClick={props.onCreate} disabled={props.busy || !props.hasSource || props.gated} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
        {props.busy ? "Generating..." : props.hasCard ? "Regenerate" : "Create Character Card"}
      </button>
      <button type="button" onClick={props.onAccept} disabled={!props.hasCard || props.busy} className="rounded-xl border border-emerald-300 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-40">
        Accept Character Card
      </button>
      <button type="button" onClick={props.onBack} disabled={props.busy} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-40">
        Back to Candidates
      </button>
    </div>
  );
}

"use client";

import {
  useState,
} from "react";

type StoryBibleFact = {
  id: string;
  subjectEntityId: string | null;
  predicate: string;
  valueText: string;
  objectEntityId: string | null;
};

type StoryConflict = {
  id: string;
  factId: string;
  conflictsWithFactId: string;
  summary: string;
  status: "open" | "resolved" | "dismissed";
  sourceRole: "user" | "assistant" | "system";
};

export type StoryConflictAction =
  | "KEEP_CURRENT_CANON"
  | "USE_PROPOSED_VERSION"
  | "EDIT_PROPOSED_VERSION"
  | "DISMISS_CONFLICT";

type Props = {
  conflicts: StoryConflict[];
  facts: StoryBibleFact[];
  entityNames: Map<string, string>;
  loading: boolean;
  busy: boolean;
  busyConflictId: string;
  error: string;
  onCheckConflicts: () => void;
  onResolveConflict: (
    conflictId: string,
    action: StoryConflictAction,
    valueText?: string,
  ) => void;
};

function describeFact(
  fact: StoryBibleFact | undefined,
  entityNames: Map<string, string>,
) {
  if (!fact) return "Fact no longer exists.";

  const subject = fact.subjectEntityId
    ? entityNames.get(fact.subjectEntityId) || "Unknown entity"
    : "Story";

  const object = fact.objectEntityId
    ? entityNames.get(fact.objectEntityId) || "Unknown entity"
    : "";

  return `${subject} - ${fact.predicate}${
    object
      ? ` -> ${object}`
      : fact.valueText
        ? `: ${fact.valueText}`
        : ""
  }`;
}

export function ConflictReviewPanel({
  conflicts,
  facts,
  entityNames,
  loading,
  busy,
  busyConflictId,
  error,
  onCheckConflicts,
  onResolveConflict,
}: Props) {
  const [editingConflictId, setEditingConflictId] =
    useState("");
  const [editedValue, setEditedValue] =
    useState("");

  const factsById = new Map(
    facts.map((fact) => [fact.id, fact]),
  );

  return (
    <section className="rounded-[20px] border border-white/10 bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
            Conflicts
          </p>

          <h3 className="mt-2 text-lg font-black text-white">
            Conflict Review
          </h3>
        </div>

        <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/45">
          {conflicts.length} open
        </span>
      </div>

      <p className="mt-2 text-sm leading-6 text-white/55">
        Check pending suggestions against approved canon, then
        choose which version canon should keep.
      </p>

      {error ? (
        <div className="mt-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy || loading || Boolean(busyConflictId)}
        onClick={onCheckConflicts}
        className="mt-4 rounded-[14px] border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-white/75 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy
          ? "Checking..."
          : loading
            ? "Loading..."
            : "Check conflicts"}
      </button>

      {conflicts.length ? (
        <div className="mt-4 space-y-3">
          {conflicts.map((conflict) => {
            const proposed = factsById.get(conflict.factId);
            const current = factsById.get(
              conflict.conflictsWithFactId,
            );
            const actionBusy =
              busyConflictId === conflict.id;
            const editing =
              editingConflictId === conflict.id;

            return (
              <article
                key={conflict.id}
                className="rounded-[16px] border border-amber-300/20 bg-amber-300/[0.06] p-3"
              >
                <div className="break-words text-sm font-black leading-6 text-amber-50/90">
                  {conflict.summary}
                </div>

                <div className="mt-3 grid gap-2">
                  <div className="rounded-[12px] border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.1em] text-white/35">
                      Current canon
                    </div>
                    <div className="mt-1 break-words text-xs leading-5 text-white/72">
                      {describeFact(current, entityNames)}
                    </div>
                  </div>

                  <div className="rounded-[12px] border border-amber-200/15 bg-amber-200/[0.06] px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.1em] text-amber-50/45">
                      Proposed version
                    </div>
                    <div className="mt-1 break-words text-xs leading-5 text-amber-50/78">
                      {describeFact(proposed, entityNames)}
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-[10px] uppercase tracking-[0.1em] text-white/35">
                  Source: {conflict.sourceRole} · Status:{" "}
                  {conflict.status}
                </div>

                {editing ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={editedValue}
                      onChange={(event) =>
                        setEditedValue(event.target.value)
                      }
                      rows={3}
                      className="min-h-[84px] w-full resize-y rounded-[12px] border border-white/10 bg-black/35 px-3 py-2 text-sm leading-6 text-white/80 outline-none transition placeholder:text-white/30 focus:border-amber-200/45"
                    />

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={
                          Boolean(busyConflictId) ||
                          !editedValue.trim()
                        }
                        onClick={() => {
                          onResolveConflict(
                            conflict.id,
                            "EDIT_PROPOSED_VERSION",
                            editedValue,
                          );
                          setEditingConflictId("");
                          setEditedValue("");
                        }}
                        className="rounded-[12px] bg-amber-200 px-3 py-2 text-xs font-black text-black transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {actionBusy
                          ? "Resolving..."
                          : "Use edited version"}
                      </button>

                      <button
                        type="button"
                        disabled={Boolean(busyConflictId)}
                        onClick={() => {
                          setEditingConflictId("");
                          setEditedValue("");
                        }}
                        className="rounded-[12px] border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-black text-white/65 transition hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={Boolean(busyConflictId)}
                      onClick={() =>
                        onResolveConflict(
                          conflict.id,
                          "KEEP_CURRENT_CANON",
                        )
                      }
                      className="rounded-[12px] border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-black text-white/70 transition hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {actionBusy
                        ? "Resolving..."
                        : "Keep current canon"}
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(busyConflictId)}
                      onClick={() =>
                        onResolveConflict(
                          conflict.id,
                          "USE_PROPOSED_VERSION",
                        )
                      }
                      className="rounded-[12px] bg-amber-200 px-3 py-2 text-xs font-black text-black transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Use proposed version
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(busyConflictId)}
                      onClick={() => {
                        setEditingConflictId(conflict.id);
                        setEditedValue(proposed?.valueText || "");
                      }}
                      className="rounded-[12px] border border-amber-200/25 bg-amber-200/[0.08] px-3 py-2 text-xs font-black text-amber-50/80 transition hover:bg-amber-200/[0.13] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Edit proposed version
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(busyConflictId)}
                      onClick={() =>
                        onResolveConflict(
                          conflict.id,
                          "DISMISS_CONFLICT",
                        )
                      }
                      className="rounded-[12px] border border-white/10 bg-black/20 px-3 py-2 text-xs font-black text-white/55 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Dismiss conflict
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-[16px] border border-dashed border-white/10 bg-black/20 px-4 py-4 text-sm leading-6 text-white/45">
          No open conflicts have been found.
        </div>
      )}
    </section>
  );
}

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
  sourceRole: "user" | "assistant" | "system";
};

type Props = {
  facts: StoryBibleFact[];
  entityNames: Map<string, string>;
  conflictingFactIds: Set<string>;
  busyFactId: string;
  error: string;
  onApproveFact: (factId: string) => void;
  onRejectFact: (factId: string) => void;
  onEditApproveFact: (
    factId: string,
    valueText: string,
  ) => void;
};

function describeFact(
  fact: StoryBibleFact,
  entityNames: Map<string, string>,
) {
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

export function CanonApprovalQueue({
  facts,
  entityNames,
  conflictingFactIds,
  busyFactId,
  error,
  onApproveFact,
  onRejectFact,
  onEditApproveFact,
}: Props) {
  const [editingFactId, setEditingFactId] =
    useState("");
  const [editedValue, setEditedValue] =
    useState("");

  return (
    <section className="rounded-[20px] border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/60">
            Canon Approvals
          </p>

          <h3 className="mt-2 text-lg font-black text-white">
            Approval Queue
          </h3>
        </div>

        <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/45">
          {facts.length} pending
        </span>
      </div>

      <p className="mt-2 text-sm leading-6 text-white/55">
        AI suggestions stay outside canon until you approve or
        reject them. Approval records a durable review and creates
        user-authorized canon only when it does not conflict with
        current canon.
      </p>

      {error ? (
        <div className="mt-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
          {error}
        </div>
      ) : null}

      {facts.length ? (
        <div className="mt-4 space-y-3">
          {facts.map((fact) => {
            const busy = busyFactId === fact.id;
            const hasConflict =
              conflictingFactIds.has(fact.id);
            const editing =
              editingFactId === fact.id;

            return (
              <article
                key={fact.id}
                className="rounded-[16px] border border-white/10 bg-black/25 p-3"
              >
                <div className="break-words text-sm font-black leading-6 text-white/82">
                  {describeFact(fact, entityNames)}
                </div>

                <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.1em] text-white/35">
                  <span>Source: {fact.sourceRole}</span>
                  {hasConflict ? (
                    <span className="text-amber-100/75">
                      Conflict review required
                    </span>
                  ) : null}
                </div>

                {editing ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={editedValue}
                      onChange={(event) =>
                        setEditedValue(event.target.value)
                      }
                      rows={3}
                      className="min-h-[84px] w-full resize-y rounded-[12px] border border-white/10 bg-black/35 px-3 py-2 text-sm leading-6 text-white/80 outline-none transition placeholder:text-white/30 focus:border-cyan-200/45"
                    />

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={
                          Boolean(busyFactId) ||
                          !editedValue.trim()
                        }
                        onClick={() => {
                          onEditApproveFact(
                            fact.id,
                            editedValue,
                          );
                          setEditingFactId("");
                          setEditedValue("");
                        }}
                        className="rounded-[12px] bg-cyan-300 px-3 py-2 text-xs font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {busy
                          ? "Saving..."
                          : "Save edited canon"}
                      </button>

                      <button
                        type="button"
                        disabled={Boolean(busyFactId)}
                        onClick={() => {
                          setEditingFactId("");
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
                      disabled={
                        Boolean(busyFactId) || hasConflict
                      }
                      onClick={() => onApproveFact(fact.id)}
                      className="rounded-[12px] bg-cyan-300 px-3 py-2 text-xs font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {busy
                        ? "Approving..."
                        : hasConflict
                          ? "Resolve conflict first"
                          : "Approve as canon"}
                    </button>

                    <button
                      type="button"
                      disabled={
                        Boolean(busyFactId) || hasConflict
                      }
                      onClick={() => {
                        setEditingFactId(fact.id);
                        setEditedValue(fact.valueText);
                      }}
                      className="rounded-[12px] border border-cyan-200/20 bg-cyan-200/[0.07] px-3 py-2 text-xs font-black text-cyan-50/80 transition hover:bg-cyan-200/[0.12] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Edit & approve
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(busyFactId)}
                      onClick={() => onRejectFact(fact.id)}
                      className="rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-white/65 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {busy
                        ? "Reviewing..."
                        : "Reject suggestion"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-[16px] border border-dashed border-white/10 bg-black/20 px-4 py-4 text-sm leading-6 text-white/45">
          No suggestions are waiting for canon approval.
        </div>
      )}
    </section>
  );
}

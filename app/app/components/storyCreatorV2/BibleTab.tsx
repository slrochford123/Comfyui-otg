"use client";

import { CanonApprovalQueue } from "./CanonApprovalQueue";
import { ConflictReviewPanel } from "./ConflictReviewPanel";

type StoryBibleEntity = {
  id: string;
  entityType: string;
  name: string;
  sourceRole: "user" | "assistant" | "system";
};

type StoryBibleFactStatus =
  | "canon"
  | "suggestion"
  | "unknown";

type StoryBibleFact = {
  id: string;
  subjectEntityId: string | null;
  predicate: string;
  valueText: string;
  objectEntityId: string | null;
  canonStatus: StoryBibleFactStatus;
  sourceRole: "user" | "assistant" | "system";
};

type StoryBibleFactSection = readonly [
  label: string,
  status: StoryBibleFactStatus,
  facts: StoryBibleFact[],
];

type StoryConflict = {
  id: string;
  factId: string;
  conflictsWithFactId: string;
  summary: string;
  status: "open" | "resolved" | "dismissed";
  sourceRole: "user" | "assistant" | "system";
};

type StoryConflictAction =
  | "KEEP_CURRENT_CANON"
  | "USE_PROPOSED_VERSION"
  | "EDIT_PROPOSED_VERSION"
  | "DISMISS_CONFLICT";

type Props = {
  title: string;
  heading: string;
  readOnlyLabel: string;
  phaseCopy: string;
  storyBibleEntities: StoryBibleEntity[];
  storyBibleFacts: StoryBibleFact[];
  storyBibleFactSections: readonly StoryBibleFactSection[];
  storyBibleEntityNames: Map<string, string>;
  storyBibleLoading: boolean;
  storyBibleError: string;
  canonApprovalFacts: StoryBibleFact[];
  canonApprovalBusyFactId: string;
  canonApprovalError: string;
  storyConflicts: StoryConflict[];
  storyConflictsLoading: boolean;
  storyConflictsBusy: boolean;
  storyConflictBusyId: string;
  storyConflictsError: string;
  onCheckConflicts: () => void;
  onApproveFact: (factId: string) => void;
  onRejectFact: (factId: string) => void;
  onEditApproveFact: (
    factId: string,
    valueText: string,
  ) => void;
  onResolveConflict: (
    conflictId: string,
    action: StoryConflictAction,
    valueText?: string,
  ) => void;
};

const futureBibleSections = [
  "Characters",
  "Locations",
  "Factions",
  "Rules / Powers",
  "Timeline",
  "Tone",
  "Open Questions",
  "Conflicts",
  "Canon Approvals",
] as const;

export function BibleTab({
  title,
  heading,
  readOnlyLabel,
  phaseCopy,
  storyBibleEntities,
  storyBibleFacts,
  storyBibleFactSections,
  storyBibleEntityNames,
  storyBibleLoading,
  storyBibleError,
  canonApprovalFacts,
  canonApprovalBusyFactId,
  canonApprovalError,
  storyConflicts,
  storyConflictsLoading,
  storyConflictsBusy,
  storyConflictBusyId,
  storyConflictsError,
  onCheckConflicts,
  onApproveFact,
  onRejectFact,
  onEditApproveFact,
  onResolveConflict,
}: Props) {
  const conflictingFactIds = new Set(
    storyConflicts.map((conflict) => conflict.factId),
  );

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.85fr)]">
      <section className="min-w-0 rounded-[24px] border border-white/10 bg-black/35 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
              {title}
            </p>

            <h2 className="mt-2 break-words text-xl font-black text-white">
              {heading}
            </h2>
          </div>

          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/45">
            {readOnlyLabel}
          </span>
        </div>

        <p className="mt-2 text-sm leading-6 text-white/60">
          {phaseCopy}
        </p>

        {storyBibleError ? (
          <div className="mt-4 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
            {storyBibleError}
          </div>
        ) : null}

        {storyBibleLoading ? (
          <div className="mt-4 text-sm text-white/45">
            Loading Story Bible...
          </div>
        ) : (
          <>
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/65">
                  Entities
                </h3>

                <span className="text-[10px] text-white/35">
                  {storyBibleEntities.length}
                </span>
              </div>

              {storyBibleEntities.length ? (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {storyBibleEntities.map((entity) => (
                    <div
                      key={entity.id}
                      className="min-w-0 rounded-[12px] border border-white/10 bg-white/[0.035] px-3 py-2"
                    >
                      <div className="break-words text-sm font-black text-white/82">
                        {entity.name}
                      </div>

                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.1em] text-white/35">
                        <span>{entity.entityType}</span>
                        <span>source: {entity.sourceRole}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded-[12px] border border-dashed border-white/10 px-3 py-3 text-xs leading-5 text-white/38">
                  No Story Bible entities yet.
                </div>
              )}
            </div>

            <div className="mt-5 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/65">
                  Facts
                </h3>

                <span className="text-[10px] text-white/35">
                  {storyBibleFacts.length}
                </span>
              </div>

              {storyBibleFactSections.map(([label, status, facts]) => (
                <div key={status} className="mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white/52">
                      {label}
                    </div>

                    <div className="text-[10px] text-white/30">
                      {facts.length}
                    </div>
                  </div>

                  {facts.length ? (
                    <div className="mt-2 space-y-2">
                      {facts.map((fact) => {
                        const subject = fact.subjectEntityId
                          ? storyBibleEntityNames.get(fact.subjectEntityId) ||
                            "Unknown entity"
                          : "Story";

                        const object = fact.objectEntityId
                          ? storyBibleEntityNames.get(fact.objectEntityId) ||
                            "Unknown entity"
                          : "";

                        return (
                          <div
                            key={fact.id}
                            className="min-w-0 rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-2"
                          >
                            <div className="break-words text-xs leading-5 text-white/72">
                              <span className="font-black text-white/88">
                                {subject}
                              </span>
                              {" - "}
                              {fact.predicate}
                              {object
                                ? ` -> ${object}`
                                : fact.valueText
                                  ? `: ${fact.valueText}`
                                  : ""}
                            </div>

                            <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-white/30">
                              Source: {fact.sourceRole}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-white/32">
                      No {label.toLowerCase()} facts.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <aside className="min-w-0 space-y-4">
        <section className="rounded-[24px] border border-white/10 bg-black/35 p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
            V2 Bible Sections
          </p>

          <h3 className="mt-2 text-lg font-black text-white">
            Future Structure
          </h3>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {futureBibleSections.map((section) => (
              <div
                key={section}
                className="rounded-[12px] border border-dashed border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-bold text-white/55"
              >
                {section}
              </div>
            ))}
          </div>
        </section>

        <CanonApprovalQueue
          facts={canonApprovalFacts}
          entityNames={storyBibleEntityNames}
          conflictingFactIds={conflictingFactIds}
          busyFactId={canonApprovalBusyFactId}
          error={canonApprovalError}
          onApproveFact={onApproveFact}
          onRejectFact={onRejectFact}
          onEditApproveFact={onEditApproveFact}
        />
        <ConflictReviewPanel
          conflicts={storyConflicts}
          facts={storyBibleFacts}
          entityNames={storyBibleEntityNames}
          loading={storyConflictsLoading}
          busy={storyConflictsBusy}
          busyConflictId={storyConflictBusyId}
          error={storyConflictsError}
          onCheckConflicts={onCheckConflicts}
          onResolveConflict={onResolveConflict}
        />
      </aside>
    </div>
  );
}

"use client";

import type {
  StoryCreatorAsset,
} from "./StoryAssetGrid";

type StoryProductionPackage = {
  counts?: {
    canonFacts?: number;
    openConflicts?: number;
    assets?: number;
    generationJobs?: number;
  };
  workflowBundle?: string[];
  handoffTargets?: Record<string, string>;
};

type Props = {
  assets: StoryCreatorAsset[];
  canonCount: number;
  openConflictCount: number;
  busy: boolean;
  error: string;
  notice: string;
  storyPackage: StoryProductionPackage | null;
  onCreatePackage: () => void;
};

const productionAreas = [
  {
    title: "Storyboard",
    body: "Use approved canon and Story assets as the source packet for storyboard planning.",
  },
  {
    title: "Shot List",
    body: "Production exports include canon, open conflicts, recent context, and asset/job references.",
  },
  {
    title: "Reference Pack",
    body: "Reference pack points at Qwen Image 2.1 assets, Qwen Image Edit 2.1 card workflows, and saved voice profiles.",
  },
  {
    title: "5-Second Preview",
    body: "MiniMax H3 preview handoff targets the existing H3 generation route with 5- or 10-second support.",
  },
  {
    title: "Production Handoff",
    body: "Build a durable package before moving into Production V2, H3 preview, or external review.",
  },
] as const;

export function ProduceTab({
  assets,
  canonCount,
  openConflictCount,
  busy,
  error,
  notice,
  storyPackage,
  onCreatePackage,
}: Props) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-black/35 p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
        Produce
      </p>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="mt-2 text-xl font-black text-white">
            Production Workspace
          </h2>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
            Build a Story Creator V2 production package from
            approved canon, review warnings, design assets, and
            generation job metadata.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={onCreatePackage}
          className="rounded-[14px] bg-cyan-300 px-5 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Building..." : "Build package"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[16px] border border-white/10 bg-white/[0.035] p-4">
          <div className="text-2xl font-black text-white">
            {canonCount}
          </div>
          <div className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Canon Facts
          </div>
        </div>

        <div className="rounded-[16px] border border-white/10 bg-white/[0.035] p-4">
          <div className="text-2xl font-black text-white">
            {assets.length}
          </div>
          <div className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Assets
          </div>
        </div>

        <div className="rounded-[16px] border border-white/10 bg-white/[0.035] p-4">
          <div className="text-2xl font-black text-white">
            {openConflictCount}
          </div>
          <div className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Open Conflicts
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="mt-4 rounded-[14px] border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-2 text-xs leading-5 text-cyan-50/80">
          {notice}
        </div>
      ) : null}

      <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {productionAreas.map((area) => (
          <div
            key={area.title}
            className="min-w-0 rounded-[16px] border border-dashed border-white/10 bg-white/[0.025] p-4"
          >
            <div className="break-words text-sm font-black text-white">
              {area.title}
            </div>

            <p className="mt-2 text-xs leading-5 text-white/48">
              {area.body}
            </p>
          </div>
        ))}
      </div>

      {storyPackage ? (
        <div className="mt-5 rounded-[18px] border border-white/10 bg-black/25 p-4">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
            Latest Package
          </div>

          <div className="mt-3 grid gap-2 text-xs leading-5 text-white/60 sm:grid-cols-2">
            <div>
              Canon facts:{" "}
              <strong className="text-white">
                {storyPackage.counts?.canonFacts ?? 0}
              </strong>
            </div>
            <div>
              Assets:{" "}
              <strong className="text-white">
                {storyPackage.counts?.assets ?? 0}
              </strong>
            </div>
            <div>
              Generation jobs:{" "}
              <strong className="text-white">
                {storyPackage.counts?.generationJobs ?? 0}
              </strong>
            </div>
            <div>
              Workflow files:{" "}
              <strong className="text-white">
                {storyPackage.workflowBundle?.length ?? 0}
              </strong>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

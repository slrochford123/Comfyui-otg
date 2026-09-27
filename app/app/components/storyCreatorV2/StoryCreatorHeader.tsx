"use client";

type StoryCreatorHeaderProject = {
  id: string;
  title: string;
  updatedAt: number;
};

type Props = {
  project: StoryCreatorHeaderProject;
  updatedLabel: string;
  onBack: () => void;
};

export function StoryCreatorHeader({
  project,
  updatedLabel,
  onBack,
}: Props) {
  return (
    <header className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm sm:p-6">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/70">
              Story Creator V2
            </p>

            <span className="rounded-full border border-purple-200/20 bg-purple-300/[0.08] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-purple-100/70">
              Five-stage studio
            </span>
          </div>

          <h1 className="mt-2 max-w-5xl break-words text-3xl font-black tracking-tight text-white sm:text-4xl">
            {project.title}
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">
            Brainstorm ideas, protect canon, design story assets,
            write from approved facts, and prepare production from
            the same selected Story project.
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
          <button
            type="button"
            onClick={onBack}
            className="rounded-[14px] border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-black text-white/75 transition hover:bg-white/[0.09]"
          >
            Back to Stories
          </button>

          <div className="min-w-0 rounded-[16px] border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-2 text-xs text-white/45">
            <div className="font-black uppercase tracking-[0.14em] text-cyan-100/60">
              Persistent Story ID
            </div>
            <code className="mt-1 block break-all text-cyan-100/75">
              {project.id}
            </code>
            <div className="mt-1">Last updated: {updatedLabel}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

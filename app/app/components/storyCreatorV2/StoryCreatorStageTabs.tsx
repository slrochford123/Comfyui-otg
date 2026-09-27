"use client";

export type StoryCreatorStage =
  | "ideas"
  | "bible"
  | "design"
  | "write"
  | "produce";

export const STORY_CREATOR_STAGES = [
  { id: "ideas", label: "Ideas" },
  { id: "bible", label: "Bible" },
  { id: "design", label: "Design" },
  { id: "write", label: "Write" },
  { id: "produce", label: "Produce" },
] as const satisfies readonly {
  id: StoryCreatorStage;
  label: string;
}[];

type Props = {
  activeStage: StoryCreatorStage;
  onStageChange: (stage: StoryCreatorStage) => void;
};

export function StoryCreatorStageTabs({
  activeStage,
  onStageChange,
}: Props) {
  return (
    <nav
      aria-label="Story Creator V2 stages"
      className="overflow-x-auto rounded-[20px] border border-white/10 bg-black/35 p-2"
    >
      <div className="flex min-w-max gap-2">
        {STORY_CREATOR_STAGES.map((stage) => {
          const selected = stage.id === activeStage;

          return (
            <button
              key={stage.id}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => onStageChange(stage.id)}
              className={
                selected
                  ? "rounded-[14px] border border-cyan-200/40 bg-cyan-300 px-4 py-2.5 text-sm font-black text-black shadow-[0_0_24px_rgba(103,232,249,0.16)]"
                  : "rounded-[14px] border border-white/10 bg-white/[0.045] px-4 py-2.5 text-sm font-black text-white/62 transition hover:border-cyan-200/25 hover:bg-white/[0.08] hover:text-white"
              }
            >
              {stage.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

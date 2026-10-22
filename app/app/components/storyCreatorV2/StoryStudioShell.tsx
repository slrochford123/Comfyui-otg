"use client";

import {
  useEffect,
  type ReactNode,
} from "react";

export type StoryProductionMode =
  | "automatic"
  | "assisted"
  | "manual";

export type StoryStudioTool =
  | "write"
  | "design"
  | "audio"
  | "produce"
  | "movie";

type Props = {
  mode: StoryProductionMode;
  memoryOpen: boolean;
  productionOpen: boolean;
  activeTool: StoryStudioTool;
  canonCount: number;
  suggestionCount: number;
  assetCount: number;
  openConflictCount: number;
  onModeChange: (mode: StoryProductionMode) => void;
  onMemoryOpenChange: (open: boolean) => void;
  onProductionOpenChange: (open: boolean) => void;
  onToolChange: (tool: StoryStudioTool) => void;
  director: ReactNode;
  memory: ReactNode;
  writing: ReactNode;
  design: ReactNode;
  audio: ReactNode;
  production: ReactNode;
  movie: ReactNode;
};

const modes: {
  id: StoryProductionMode;
  label: string;
  detail: string;
}[] = [
  {
    id: "automatic",
    label: "Automatic",
    detail: "Story Director prepares a plan for your approval.",
  },
  {
    id: "assisted",
    label: "AI Assisted",
    detail: "Story Director recommends the next useful action.",
  },
  {
    id: "manual",
    label: "Manual",
    detail: "You choose each writing and production tool.",
  },
];

const tools: {
  id: StoryStudioTool;
  label: string;
}[] = [
  { id: "write", label: "Plan & Write" },
  { id: "design", label: "Visuals" },
  { id: "audio", label: "Audio" },
  { id: "produce", label: "Video" },
  { id: "movie", label: "Movie" },
];

export function StoryStudioShell({
  mode,
  memoryOpen,
  productionOpen,
  activeTool,
  canonCount,
  suggestionCount,
  assetCount,
  openConflictCount,
  onModeChange,
  onMemoryOpenChange,
  onProductionOpenChange,
  onToolChange,
  director,
  memory,
  writing,
  design,
  audio,
  production,
  movie,
}: Props) {
  const selectedMode =
    modes.find((item) => item.id === mode) || modes[1];

  useEffect(() => {
    if (!memoryOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onMemoryOpenChange(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [memoryOpen, onMemoryOpenChange]);

  return (
    <div className="min-w-0 space-y-4">
      <section
        aria-label="Story Studio controls"
        className="border-y border-white/10 bg-black/25 px-3 py-3 sm:px-4"
      >
        <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={memoryOpen}
              onClick={() => onMemoryOpenChange(!memoryOpen)}
              className="min-h-11 rounded-lg border border-white/12 bg-white/[0.05] px-4 py-2 text-sm font-black text-white/78 hover:border-cyan-200/30 hover:bg-white/[0.08]"
            >
              Story Memory
              <span className="ml-2 text-xs font-bold text-cyan-100/55">
                {canonCount} canon
              </span>
            </button>

            <button
              type="button"
              aria-expanded={productionOpen}
              onClick={() =>
                onProductionOpenChange(!productionOpen)
              }
              className="min-h-11 rounded-lg border border-cyan-200/25 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-50 hover:bg-cyan-300/15"
            >
              Production Studio
              <span className="ml-2 text-xs font-bold text-cyan-100/55">
                {assetCount} assets
              </span>
            </button>
        </div>
      </section>

      <main aria-label="Story Director">{director}</main>

      {productionOpen ? (
        <section
          aria-label="Production Studio"
          className="min-w-0 border-y border-white/10 bg-black/20 py-4"
        >
          <div className="flex min-w-0 flex-col gap-3 px-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/55">
                Production Studio
              </p>
              <h2 className="mt-1 text-xl font-black text-white">
                Turn the story into finished media
              </h2>
            </div>

            <div
              role="group"
              aria-label="Production Studio tools"
              className="flex min-w-0 gap-1 overflow-x-auto rounded-lg border border-white/10 bg-black/35 p-1"
            >
              {tools.map((tool) => {
                const selected = tool.id === activeTool;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onToolChange(tool.id)}
                    className={
                      selected
                        ? "min-h-10 shrink-0 rounded-md bg-white px-3 py-2 text-sm font-black text-black"
                        : "min-h-10 shrink-0 rounded-md px-3 py-2 text-sm font-black text-white/55 hover:bg-white/[0.06] hover:text-white"
                    }
                  >
                    {tool.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-white/42">Production mode</div>
            <div className="mt-2 flex min-w-0 flex-wrap gap-2">
              {modes.map((item) => {
                const selected = item.id === mode;
                return <button key={item.id} type="button" aria-pressed={selected} onClick={() => onModeChange(item.id)} className={selected ? "min-h-10 rounded-lg border border-cyan-200/40 bg-cyan-300 px-3 py-2 text-sm font-black text-black" : "min-h-10 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-sm font-black text-white/62 hover:bg-white/[0.07] hover:text-white"}>{item.label}</button>;
              })}
            </div>
            <p className="mt-2 text-xs leading-5 text-white/45">{selectedMode.detail} Paid or GPU-intensive work still requires explicit approval.</p>
          </div>

          <div className="mt-4 min-w-0">
            {activeTool === "write" ? writing : null}
            {activeTool === "design" ? design : null}
            {activeTool === "audio" ? audio : null}
            {activeTool === "produce" ? production : null}
            {activeTool === "movie" ? movie : null}
          </div>
        </section>
      ) : null}

      {memoryOpen ? (
        <div
          className="fixed inset-0 z-[90] flex justify-end bg-black/72 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              onMemoryOpenChange(false);
            }
          }}
        >
          <aside
            aria-label="Story Memory"
            aria-modal="true"
            role="dialog"
            className="h-full w-full max-w-[760px] overflow-y-auto border-l border-white/12 bg-[#090b12] p-4 shadow-2xl sm:p-5"
          >
            <div className="sticky top-0 z-10 -mx-2 mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/10 bg-[#090b12]/95 px-2 pb-4 backdrop-blur">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/55">
                  Story Memory
                </p>
                <h2 className="mt-1 text-xl font-black text-white">
                  Canon and continuity
                </h2>
                <p className="mt-1 text-xs text-white/45">
                  {canonCount} approved, {suggestionCount} proposed,
                  {" "}{openConflictCount} conflicts
                </p>
              </div>

              <div className="flex w-full gap-2 sm:w-auto">
                <button
                  type="button"
                  onClick={() => onMemoryOpenChange(false)}
                  className="min-h-11 flex-1 rounded-lg border border-cyan-200/25 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-50 hover:bg-cyan-300/15 sm:flex-none"
                >
                  Back to Story Director
                </button>
                <button
                  type="button"
                  aria-label="Close Story Memory"
                  title="Close Story Memory"
                  onClick={() => onMemoryOpenChange(false)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/12 bg-white/[0.05] text-xl font-black text-white/72 hover:bg-white/[0.1] hover:text-white"
                >
                  ×
                </button>
              </div>
            </div>

            {memory}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

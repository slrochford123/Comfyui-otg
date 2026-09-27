"use client";

type StoryWritingMode =
  | "outline"
  | "chapter"
  | "episode"
  | "scene"
  | "dialogue";

type Props = {
  mode: StoryWritingMode;
  instruction: string;
  draft: string;
  busy: boolean;
  error: string;
  onModeChange: (mode: StoryWritingMode) => void;
  onInstructionChange: (value: string) => void;
  onGenerate: () => void;
};

const writingModes: {
  id: StoryWritingMode;
  label: string;
}[] = [
  { id: "outline", label: "Story Outline" },
  { id: "chapter", label: "Chapter" },
  { id: "episode", label: "Episode" },
  { id: "scene", label: "Scene" },
  { id: "dialogue", label: "Dialogue" },
];

export function WriteTab({
  mode,
  instruction,
  draft,
  busy,
  error,
  onModeChange,
  onInstructionChange,
  onGenerate,
}: Props) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
      <section className="rounded-[24px] border border-white/10 bg-black/35 p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Write
        </p>

        <h2 className="mt-2 text-xl font-black text-white">
          Writing Workspace
        </h2>

        <p className="mt-2 text-sm leading-6 text-white/60">
          Story Creator writing uses approved canon by default. The
          writer route does not include suggestions or unknowns unless
          a later phase explicitly adds that option.
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {writingModes.map((item) => {
            const selected = item.id === mode;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onModeChange(item.id)}
                className={
                  selected
                    ? "rounded-[16px] border border-cyan-200/35 bg-cyan-300 px-4 py-3 text-left text-sm font-black text-black"
                    : "rounded-[16px] border border-white/10 bg-white/[0.025] px-4 py-3 text-left text-sm font-black text-white/70 transition hover:bg-white/[0.06]"
                }
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/45">
            Direction
          </span>

          <textarea
            value={instruction}
            onChange={(event) =>
              onInstructionChange(event.target.value)
            }
            rows={4}
            placeholder="Optional direction for this writing pass..."
            className="w-full resize-y rounded-[16px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40"
          />
        </label>

        {error ? (
          <div className="mt-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={onGenerate}
          className="mt-4 rounded-[14px] bg-cyan-300 px-5 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Writing..." : "Generate from canon"}
        </button>

        {draft ? (
          <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
              Draft
            </div>

            <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/78">
              {draft}
            </div>
          </div>
        ) : null}
      </section>

      <aside className="rounded-[24px] border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/60">
          Default Policy
        </p>

        <h3 className="mt-2 text-xl font-black text-white">
          Approved Canon Only
        </h3>

        <p className="mt-2 text-sm leading-6 text-white/60">
          Future writing modes will draw from approved canon unless
          the user explicitly chooses another controlled source.
          Suggestions and unknowns remain review material, not canon.
        </p>
      </aside>
    </div>
  );
}

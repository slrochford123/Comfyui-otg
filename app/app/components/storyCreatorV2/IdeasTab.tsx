"use client";

import type { RefObject } from "react";

type StoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type StoryOpenQuestion = {
  id: string;
  question: string;
  status: string;
  sourceRole: "user" | "assistant" | "system";
};

type Props = {
  storyMessages: StoryMessage[];
  messagesLoading: boolean;
  chatBusy: boolean;
  chatError: string;
  draft: string;
  chatEndRef: RefObject<HTMLDivElement | null>;
  extractionBusy: boolean;
  extractionError: string;
  extractionNotice: string;
  extractionSourceMessageId: string;
  openQuestions: StoryOpenQuestion[];
  openQuestionsLoading: boolean;
  openQuestionsError: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onExtract: (sourceMessageId: string) => void;
};

const reservedPanels = [
  {
    title: "Extracted Story Information",
    body: "Coming in the next Story Creator V2 phase.",
  },
  {
    title: "Open Questions",
    body: "Future story gaps and decisions will collect here.",
  },
  {
    title: "Suggestions",
    body: "Future Story Director suggestions will stay separate from canon.",
  },
] as const;

export function IdeasTab({
  storyMessages,
  messagesLoading,
  chatBusy,
  chatError,
  draft,
  chatEndRef,
  extractionBusy,
  extractionError,
  extractionNotice,
  extractionSourceMessageId,
  openQuestions,
  openQuestionsLoading,
  openQuestionsError,
  onDraftChange,
  onSend,
  onExtract,
}: Props) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(240px,0.9fr)]">
      <section className="flex min-h-[620px] min-w-0 flex-col rounded-[24px] border border-cyan-300/15 bg-black/40">
        <div className="border-b border-white/10 p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/60">
            Ideas
          </p>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-black text-white">
              Story Director Conversation
            </h2>

            <span className="text-xs text-white/35">
              {storyMessages.length} saved messages
            </span>
          </div>

          <p className="mt-2 text-xs leading-5 text-white/45">
            Brainstorm and develop the story here. This keeps the
            existing Story Helper route, saved message history, send
            lock, loading state, error state, and project scoping.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {messagesLoading ? (
            <div className="text-sm text-white/45">
              Loading conversation...
            </div>
          ) : storyMessages.length ? (
            storyMessages.map((item) => (
              <div
                key={item.id}
                className={
                  item.role === "user"
                    ? "ml-auto max-w-[88%] break-words rounded-[18px] bg-cyan-300 px-4 py-3 text-sm leading-6 text-black"
                    : "mr-auto max-w-[92%] break-words rounded-[18px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-6 text-white/82"
                }
              >
                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] opacity-55">
                  {item.role === "user" ? "You" : "Story Director"}
                </div>

                <div className="whitespace-pre-wrap">
                  {item.content}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.025] p-5">
              <div className="font-black text-white">
                Start telling me your story.
              </div>

              <p className="mt-2 text-sm leading-6 text-white/52">
                You can describe characters, the world, scenes,
                relationships, problems, ideas, or simply talk
                naturally. This conversation will remain attached to
                this Story.
              </p>
            </div>
          )}

          {chatBusy ? (
            <div className="mr-auto rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/50">
              Story Director is thinking...
            </div>
          ) : null}

          <div ref={chatEndRef} />
        </div>

        <div className="border-t border-white/10 p-4">
          {chatError ? (
            <div className="mb-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
              {chatError}
            </div>
          ) : null}

          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey)
              ) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder="Tell the Story Director what happens next..."
            rows={4}
            disabled={chatBusy}
            className="w-full resize-y rounded-[16px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40 disabled:opacity-60"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] text-white/35">
              Ctrl/Cmd + Enter to send
            </span>

            <button
              type="button"
              disabled={chatBusy || !draft.trim()}
              onClick={onSend}
              className="rounded-[14px] bg-cyan-300 px-5 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chatBusy ? "Thinking..." : "Send"}
            </button>
          </div>
        </div>
      </section>

      <aside className="min-w-0 space-y-4">
        <section className="rounded-[24px] border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/60">
            Extracted Story Information
          </p>

          <h3 className="mt-2 text-lg font-black text-white">
            Send To Bible Suggestions
          </h3>

          <p className="mt-2 text-sm leading-6 text-white/55">
            Extract characters, locations, rules, tone, and open
            questions from a specific saved message. Extracted facts
            enter the Bible as suggestions or unknowns, never canon.
          </p>

          {extractionError ? (
            <div className="mt-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
              {extractionError}
            </div>
          ) : null}

          {extractionNotice ? (
            <div className="mt-3 rounded-[14px] border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs leading-5 text-cyan-100/80">
              {extractionNotice}
            </div>
          ) : null}

          <button
            type="button"
            disabled={
              extractionBusy ||
              messagesLoading ||
              chatBusy ||
              !extractionSourceMessageId
            }
            onClick={() => onExtract(extractionSourceMessageId)}
            className="mt-4 rounded-[14px] bg-cyan-300 px-4 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {extractionBusy
              ? "Extracting..."
              : extractionError
                ? "Retry Extraction"
                : "Extract Story Info"}
          </button>
        </section>

        <section className="rounded-[24px] border border-white/10 bg-black/35 p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Open Questions
          </p>

          <h3 className="mt-2 text-lg font-black text-white">
            Story Gaps
          </h3>

          {openQuestionsError ? (
            <div className="mt-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
              {openQuestionsError}
            </div>
          ) : null}

          {openQuestionsLoading ? (
            <div className="mt-3 text-sm text-white/45">
              Loading questions...
            </div>
          ) : openQuestions.length ? (
            <div className="mt-3 space-y-2">
              {openQuestions.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[14px] border border-white/10 bg-white/[0.04] p-3"
                >
                  <div className="text-xs leading-5 text-white/72">
                    {item.question}
                  </div>

                  <div className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/32">
                    {item.sourceRole}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-white/55">
              Future story gaps and decisions will collect here after
              extraction finds them.
            </p>
          )}
        </section>

        {reservedPanels
          .filter((panel) => panel.title === "Suggestions")
          .map((panel) => (
            <section
              key={panel.title}
              className="rounded-[24px] border border-white/10 bg-black/35 p-5"
            >
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Reserved
              </p>

              <h3 className="mt-2 text-lg font-black text-white">
                {panel.title}
              </h3>

              <p className="mt-2 text-sm leading-6 text-white/55">
                {panel.body}
              </p>
            </section>
          ))}
      </aside>
    </div>
  );
}

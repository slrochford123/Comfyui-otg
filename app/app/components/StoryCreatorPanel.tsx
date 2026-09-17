"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type StoryProject = {
  id: string;
  ownerKey: string;
  title: string;
  format: string;
  genre: string;
  createdAt: number;
  updatedAt: number;
};

type StoryMessage = {
  id: string;
  projectId: string;
  ownerKey: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type Props = {
  ownerKey: string;
};

const STORY_LIMIT = 6;

function formatDate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function errorMessage(
  data: any,
  fallback: string,
) {
  return typeof data?.error === "string" && data.error.trim()
    ? data.error
    : fallback;
}

function assistantText(data: any) {
  if (
    typeof data?.response === "string" &&
    data.response.trim()
  ) {
    return data.response.trim();
  }

  if (
    typeof data?.message?.content === "string" &&
    data.message.content.trim()
  ) {
    return data.message.content.trim();
  }

  if (
    typeof data?.content === "string" &&
    data.content.trim()
  ) {
    return data.content.trim();
  }

  return "";
}

export default function StoryCreatorPanel({
  ownerKey,
}: Props) {
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] =
    useState("");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const [storyMessages, setStoryMessages] =
    useState<StoryMessage[]>([]);
  const [messagesLoading, setMessagesLoading] =
    useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [draft, setDraft] = useState("");

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const selectedProject = useMemo(
    () =>
      projects.find(
        (project) => project.id === selectedProjectId,
      ) || null,
    [projects, selectedProjectId],
  );

  const loadProjects = useCallback(async () => {
    if (!ownerKey) return;

    setBusy(true);

    try {
      const response = await fetch(
        "/api/story-creator/projects",
        {
          cache: "no-store",
          credentials: "include",
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not load Story Creator projects.",
          ),
        );
      }

      const nextProjects = Array.isArray(data?.projects)
        ? data.projects
        : [];

      setProjects(nextProjects);

      setSelectedProjectId((current) => {
        if (
          current &&
          nextProjects.some(
            (project: StoryProject) =>
              project.id === current,
          )
        ) {
          return current;
        }

        return "";
      });

      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not load Story Creator projects.",
      );
    } finally {
      setBusy(false);
    }
  }, [ownerKey]);

  const loadStoryMessages = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setStoryMessages([]);
        return;
      }

      setMessagesLoading(true);
      setChatError("");

      try {
        const response = await fetch(
          `/api/story-creator/messages?projectId=${encodeURIComponent(projectId)}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            errorMessage(
              data,
              "Could not load Story Director conversation.",
            ),
          );
        }

        setStoryMessages(
          Array.isArray(data?.messages)
            ? data.messages
            : [],
        );
      } catch (error) {
        setChatError(
          error instanceof Error
            ? error.message
            : "Could not load Story Director conversation.",
        );
      } finally {
        setMessagesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setStoryMessages([]);
      setChatError("");
      setDraft("");
      return;
    }

    void loadStoryMessages(selectedProjectId);
  }, [selectedProjectId, loadStoryMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [storyMessages, chatBusy]);

  async function createProject() {
    if (!ownerKey || busy) return;

    if (projects.length >= STORY_LIMIT) {
      setNotice(
        `Story Creator supports up to ${STORY_LIMIT} active stories. Delete one before creating another.`,
      );
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const response = await fetch(
        "/api/story-creator/projects",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title:
              newTitle.trim() || "Untitled Story",
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not create Story.",
          ),
        );
      }

      const project = data?.project as StoryProject;

      setProjects((current) => [
        project,
        ...current.filter(
          (item) => item.id !== project.id,
        ),
      ]);

      setSelectedProjectId(project.id);
      setNewTitle("");
      setNotice("Story created.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not create Story.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function renameProject(
    project: StoryProject,
  ) {
    if (!ownerKey || busy) return;

    const nextTitle =
      window
        .prompt("Rename Story", project.title)
        ?.trim() || "";

    if (
      !nextTitle ||
      nextTitle === project.title
    ) {
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const response = await fetch(
        "/api/story-creator/projects",
        {
          method: "PATCH",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: project.id,
            title: nextTitle,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not rename Story.",
          ),
        );
      }

      const updated = data?.project as StoryProject;

      setProjects((current) =>
        current.map((item) =>
          item.id === updated.id
            ? updated
            : item,
        ),
      );

      setNotice("Story renamed.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not rename Story.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(
    project: StoryProject,
  ) {
    if (!ownerKey || busy) return;

    const confirmed = window.confirm(
      `Delete "${project.title}"?\n\nThe project and its Story Director conversation will be permanently removed.`,
    );

    if (!confirmed) return;

    setBusy(true);
    setNotice("");

    try {
      const response = await fetch(
        "/api/story-creator/projects",
        {
          method: "DELETE",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: project.id,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not delete Story.",
          ),
        );
      }

      setProjects((current) =>
        current.filter(
          (item) => item.id !== project.id,
        ),
      );

      setSelectedProjectId((current) =>
        current === project.id
          ? ""
          : current,
      );

      setNotice("Story deleted.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not delete Story.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function persistMessage(
    projectId: string,
    role: StoryMessage["role"],
    content: string,
  ) {
    const response = await fetch(
      "/api/story-creator/messages",
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          role,
          content,
        }),
      },
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        errorMessage(
          data,
          "Could not save Story Director message.",
        ),
      );
    }

    return data.message as StoryMessage;
  }

  async function sendStoryMessage() {
    const project = selectedProject;
    const content = draft.trim();

    if (
      !project ||
      !content ||
      chatBusy
    ) {
      return;
    }

    setChatBusy(true);
    setChatError("");

    try {
      const savedUserMessage =
        await persistMessage(
          project.id,
          "user",
          content,
        );

      const history = [
        ...storyMessages,
        savedUserMessage,
      ];

      setStoryMessages(history);
      setDraft("");

      const aiResponse = await fetch(
        "/api/ollama-ai/chat",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-otg-ai-assistance": "1",
            "x-otg-ai-assistance-profile":
              "story-helper",
          },
          body: JSON.stringify({
            messages: history.map(
              ({ role, content }) => ({
                role,
                content,
              }),
            ),
          }),
        },
      );

      const aiData = await aiResponse
        .json()
        .catch(() => ({}));

      if (!aiResponse.ok) {
        throw new Error(
          errorMessage(
            aiData,
            "Story Director could not respond.",
          ),
        );
      }

      const responseText =
        assistantText(aiData);

      if (!responseText) {
        throw new Error(
          "Story Director returned an empty response.",
        );
      }

      const savedAssistantMessage =
        await persistMessage(
          project.id,
          "assistant",
          responseText,
        );

      setStoryMessages([
        ...history,
        savedAssistantMessage,
      ]);

      setProjects((current) =>
        current.map((item) =>
          item.id === project.id
            ? {
                ...item,
                updatedAt:
                  savedAssistantMessage.createdAt,
              }
            : item,
        ),
      );
    } catch (error) {
      setChatError(
        error instanceof Error
          ? error.message
          : "Story Director request failed.",
      );
    } finally {
      setChatBusy(false);
    }
  }

  if (selectedProject) {
    return (
      <div className="space-y-4">
        <div className="rounded-[28px] border border-white/10 bg-black/45 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/70">
                Story Creator
              </p>

              <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
                {selectedProject.title}
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">
                Your Story Director conversation is
                saved inside this Story and reloads
                whenever you return.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setSelectedProjectId("")
              }
              className="rounded-[14px] border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-black text-white/75 transition hover:bg-white/[0.09]"
            >
              Back to Stories
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <section className="flex min-h-[620px] flex-col rounded-[24px] border border-cyan-300/15 bg-black/40">
            <div className="border-b border-white/10 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/60">
                Story Director
              </p>

              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-black text-white">
                  Conversation
                </h2>

                <span className="text-xs text-white/35">
                  {storyMessages.length} saved messages
                </span>
              </div>

              <p className="mt-2 text-xs leading-5 text-white/45">
                Uses the existing Story Helper strict-canon
                protections. User and assistant turns are
                persisted server-side.
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
                        ? "ml-auto max-w-[88%] rounded-[18px] bg-cyan-300 px-4 py-3 text-sm leading-6 text-black"
                        : "mr-auto max-w-[92%] rounded-[18px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-6 text-white/82"
                    }
                  >
                    <div className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] opacity-55">
                      {item.role === "user"
                        ? "You"
                        : "Story Director"}
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
                    You can describe characters, the world,
                    scenes, relationships, problems, ideas,
                    or simply talk naturally. This
                    conversation will remain attached to
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
                onChange={(event) =>
                  setDraft(event.target.value)
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    void sendStoryMessage();
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
                  disabled={
                    chatBusy ||
                    !draft.trim()
                  }
                  onClick={() =>
                    void sendStoryMessage()
                  }
                  className="rounded-[14px] bg-cyan-300 px-5 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {chatBusy
                    ? "Thinking..."
                    : "Send"}
                </button>
              </div>
            </div>
          </section>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Story Bible
              </p>

              <h2 className="mt-2 text-xl font-black text-white">
                Canon & Continuity
              </h2>

              <p className="mt-2 text-sm leading-6 text-white/60">
                Structured characters, relationships,
                locations, world rules, timeline,
                unresolved questions, and canon status
                arrive in Phase 2.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Assets
              </p>

              <h2 className="mt-2 text-xl font-black text-white">
                Production
              </h2>

              <p className="mt-2 text-sm leading-6 text-white/60">
                Character references, locations,
                storyboards, video, voices, music, and
                SFX attach here in later phases.
              </p>
            </div>

            <div className="rounded-[24px] border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/60">
                Persistent Story ID
              </div>

              <code className="mt-2 block break-all text-xs leading-5 text-cyan-100/75">
                {selectedProject.id}
              </code>

              <div className="mt-3 text-xs text-white/45">
                Last updated:{" "}
                {formatDate(
                  selectedProject.updatedAt,
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-white/10 bg-black/45 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/70">
          SLR Studios
        </p>

        <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
          Story Creator
        </h1>

        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">
          Develop a story with an AI creative partner,
          preserve its canon, and eventually turn
          characters, locations, scenes, dialogue,
          images, voices, music, and video into one
          connected production.
        </p>
      </div>

      <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/45">
              New Story
            </span>

            <input
              value={newTitle}
              onChange={(event) =>
                setNewTitle(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createProject();
                }
              }}
              placeholder="Story title — or leave blank"
              maxLength={120}
              className="w-full rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-white/30 focus:border-cyan-300/40"
            />
          </label>

          <button
            type="button"
            onClick={() => void createProject()}
            disabled={
              busy ||
              projects.length >= STORY_LIMIT
            }
            className="rounded-[14px] bg-cyan-300 px-5 py-3 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? "Working..."
              : "+ New Story"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-white/45">
            {projects.length} of {STORY_LIMIT} active
            Stories
          </span>

          {projects.length >= STORY_LIMIT ? (
            <span className="font-bold text-amber-200/80">
              Delete a Story to create another.
            </span>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">
          {notice}
        </div>
      ) : null}

      {projects.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className="rounded-[24px] border border-white/10 bg-black/35 p-5"
            >
              <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200/55">
                Story Project
              </div>

              <h2 className="mt-2 line-clamp-2 text-xl font-black text-white">
                {project.title}
              </h2>

              <div className="mt-3 text-xs text-white/45">
                Updated{" "}
                {formatDate(project.updatedAt)}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedProjectId(
                      project.id,
                    )
                  }
                  className="rounded-[12px] bg-white px-4 py-2 text-xs font-black text-black transition hover:bg-cyan-100"
                >
                  Continue
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void renameProject(project)
                  }
                  disabled={busy}
                  className="rounded-[12px] border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-black text-white/75 transition hover:bg-white/[0.09]"
                >
                  Rename
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void deleteProject(project)
                  }
                  disabled={busy}
                  className="rounded-[12px] border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs font-black text-red-100/80 transition hover:bg-red-500/15"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-white/15 bg-black/25 p-8 text-center">
          <div className="text-lg font-black text-white">
            No Story projects yet
          </div>

          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/55">
            Create the first Story and begin talking
            naturally with its persistent Story Director.
          </p>
        </div>
      )}
    </div>
  );
}

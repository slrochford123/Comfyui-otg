"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type StoryProject = {
  id: string;
  ownerKey: string;
  title: string;
  format: string;
  genre: string;
  createdAt: number;
  updatedAt: number;
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

export default function StoryCreatorPanel({ ownerKey }: Props) {
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const loadProjects = useCallback(async () => {
    if (!ownerKey) return;

    setBusy(true);

    try {
      const response = await fetch(
        `/api/story-creator/projects?owner=${encodeURIComponent(ownerKey)}`,
        {
          cache: "no-store",
          credentials: "include",
          headers: {
            "x-otg-story-owner": ownerKey,
          },
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Could not load Story Creator projects.",
        );
      }

      const nextProjects = Array.isArray(data?.projects)
        ? data.projects
        : [];

      setProjects(nextProjects);

      setSelectedProjectId((current) => {
        if (
          current &&
          nextProjects.some((project: StoryProject) => project.id === current)
        ) {
          return current;
        }

        return "";
      });

      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load Story Creator projects.",
      );
    } finally {
      setBusy(false);
    }
  }, [ownerKey]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function createProject() {
    if (!ownerKey || busy) return;

    if (projects.length >= STORY_LIMIT) {
      setMessage(
        `Story Creator supports up to ${STORY_LIMIT} active stories. Delete one before creating another.`,
      );
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/story-creator/projects", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-story-owner": ownerKey,
        },
        body: JSON.stringify({
          ownerKey,
          title: newTitle.trim() || "Untitled Story",
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Could not create Story.",
        );
      }

      const project = data?.project as StoryProject;

      setProjects((current) => [
        project,
        ...current.filter((item) => item.id !== project.id),
      ]);

      setSelectedProjectId(project.id);
      setNewTitle("");
      setMessage("Story created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create Story.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function renameProject(project: StoryProject) {
    if (!ownerKey || busy) return;

    const nextTitle =
      window.prompt("Rename Story", project.title)?.trim() || "";

    if (!nextTitle || nextTitle === project.title) return;

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/story-creator/projects", {
        method: "PATCH",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-story-owner": ownerKey,
        },
        body: JSON.stringify({
          ownerKey,
          id: project.id,
          title: nextTitle,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Could not rename Story.",
        );
      }

      const updated = data?.project as StoryProject;

      setProjects((current) =>
        current.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      );

      setMessage("Story renamed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not rename Story.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(project: StoryProject) {
    if (!ownerKey || busy) return;

    const confirmed = window.confirm(
      `Delete "${project.title}"?\n\nThis Phase 1A project record will be permanently removed.`,
    );

    if (!confirmed) return;

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/story-creator/projects", {
        method: "DELETE",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-otg-story-owner": ownerKey,
        },
        body: JSON.stringify({
          ownerKey,
          id: project.id,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Could not delete Story.",
        );
      }

      setProjects((current) =>
        current.filter((item) => item.id !== project.id),
      );

      setSelectedProjectId((current) =>
        current === project.id ? "" : current,
      );

      setMessage("Story deleted.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not delete Story.",
      );
    } finally {
      setBusy(false);
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
                This Story workspace is now persistent. Phase 1B will place the
                Story Director conversation and Story Bible inside this project.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSelectedProjectId("")}
              className="rounded-[14px] border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-black text-white/75 transition hover:bg-white/[0.09]"
            >
              Back to Stories
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
              Story Director
            </p>

            <h2 className="mt-2 text-xl font-black text-white">
              Conversation
            </h2>

            <p className="mt-2 text-sm leading-6 text-white/60">
              The recovered Story Helper conversation and strict-canon engine
              will move here in Phase 1B.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
              Story Bible
            </p>

            <h2 className="mt-2 text-xl font-black text-white">
              Canon & Continuity
            </h2>

            <p className="mt-2 text-sm leading-6 text-white/60">
              Characters, relationships, locations, world rules, timeline,
              unresolved questions, and canon status will live here.
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
              Character references, locations, storyboards, video, voices,
              music, and SFX will attach to the Story in later phases.
            </p>
          </div>
        </div>

        <div className="rounded-[24px] border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-black text-white">
              Persistent Story ID:
            </span>

            <code className="break-all text-cyan-100/75">
              {selectedProject.id}
            </code>
          </div>

          <div className="mt-2 text-xs text-white/45">
            Last updated: {formatDate(selectedProject.updatedAt)}
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
          Develop a story with an AI creative partner, preserve its canon, and
          eventually turn characters, locations, scenes, dialogue, images,
          voices, music, and video into one connected production.
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
              onChange={(event) => setNewTitle(event.target.value)}
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
            disabled={busy || projects.length >= STORY_LIMIT}
            className="rounded-[14px] bg-cyan-300 px-5 py-3 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Working..." : "+ New Story"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-white/45">
            {projects.length} of {STORY_LIMIT} active Stories
          </span>

          {projects.length >= STORY_LIMIT ? (
            <span className="font-bold text-amber-200/80">
              Delete a Story to create another.
            </span>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">
          {message}
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
                Updated {formatDate(project.updatedAt)}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                  className="rounded-[12px] bg-white px-4 py-2 text-xs font-black text-black transition hover:bg-cyan-100"
                >
                  Continue
                </button>

                <button
                  type="button"
                  onClick={() => void renameProject(project)}
                  disabled={busy}
                  className="rounded-[12px] border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-black text-white/75 transition hover:bg-white/[0.09]"
                >
                  Rename
                </button>

                <button
                  type="button"
                  onClick={() => void deleteProject(project)}
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
            Create the first Story. In the next phase, its Story Director and
            Story Bible will live inside this persistent project.
          </p>
        </div>
      )}
    </div>
  );
}

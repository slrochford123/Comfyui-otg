"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StudioOrientationButton from "./StudioOrientationButton";
import type { EditorProject } from "@/lib/timelineEditor/store";
import { newClientRequestId } from "@/lib/client/requestId";

type Summary = Omit<EditorProject, "state">;
type GalleryItem = {
  fileName: string;
  name: string;
  source: string;
  video: boolean;
  url: string;
};
const channel = "otg-sequence-v1";
const button =
  "min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold disabled:opacity-40";
const toolbarButton =
  "min-h-10 shrink-0 rounded-md border border-white/20 px-2 text-xs font-semibold disabled:opacity-40";
const field =
  "min-h-11 min-w-0 rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-white";
async function api(route: string, body?: unknown) {
  const response = await fetch(route, {
    credentials: "include",
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw new Error(data.error || "The timeline editor request failed.");
  return data;
}
export default function TimelineEditorEvaluation({ secureEditorUrl }: { secureEditorUrl: string }) {
  const router = useRouter();
  const studioRef = useRef<HTMLElement>(null);
  const reviewDialog = useRef<HTMLDialogElement>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [project, setProject] = useState<Summary | null>(null);
  const [name, setName] = useState("My edit");
  const [ready, setReady] = useState(false);
  const [needsHttps, setNeedsHttps] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Create or open a project.");
  const [gallery, setGallery] = useState<GalleryItem[] | null>(null);
  const [output, setOutput] = useState<{ id: string; url: string } | null>(
    null,
  );
  const frame = useRef<HTMLIFrameElement>(null);
  const dirty = useRef(false);
  const actionInProgress = useRef(false);
  const createRequest = useRef<{ name: string; id: string } | null>(null);
  const saveWaiters = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const send = useCallback(
    (message: Record<string, unknown>) =>
      frame.current?.contentWindow?.postMessage(
        { channel, ...message },
        location.origin,
      ),
    [],
  );
  useEffect(() => {
    setNeedsHttps(window.isSecureContext === false);
    let canceled = false;
    void api("/api/timeline-editor")
      .then((data) => {
        if (!canceled) setProjects(data.projects);
      })
      .catch((error) => {
        if (!canceled) setError(error.message);
      });
    return () => {
      canceled = true;
    };
  }, []);
  const saveCurrent = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        const requestId = newClientRequestId();
        const timer = setTimeout(() => {
          saveWaiters.current.delete(requestId);
          reject(
            new Error(
              "The save is taking too long. Keep this project open and retry.",
            ),
          );
        }, 300000);
        saveWaiters.current.set(requestId, { resolve, reject, timer });
        send({ type: "save", requestId });
      }),
    [send],
  );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel
      )
        return;
      const data = event.data;
      if (data.type === "ready") {
        setReady(true);
        setStatus(
          "Timeline ready. Import phone media inside the editor or choose OTG Gallery.",
        );
      }
      if (data.type === "dirty") dirty.current = true;
      if (data.type === "rendering") setRendering(data.active === true);
      if (data.type === "status") setStatus(String(data.message));
      if (data.type === "saved") {
        dirty.current = data.clean !== true;
        setProjects((items) =>
          items.map((item) =>
            item.id === project?.id
              ? { ...item, name: String(data.name || item.name) }
              : item,
          ),
        );
        setStatus("Project saved to your account.");
        setProject((current) =>
          current
            ? {
                ...current,
                revision: Number(data.revision),
                name: String(data.name || current.name),
              }
            : null,
        );
      }
      if (data.type === "load-error") {
        setLoadFailed(true);
        setError(String(data.message));
        setStatus(
          "Project loading failed. Reopen it or choose another project.",
        );
      }
      if (data.type === "error")
        setError(String(data.message || "The editor action failed."));
      if (data.type === "saved" || data.type === "error")
        for (const id of data.requests || []) {
          const waiter = saveWaiters.current.get(id);
          if (waiter) {
            clearTimeout(waiter.timer);
            saveWaiters.current.delete(id);
            if (data.type === "saved") waiter.resolve();
            else waiter.reject(new Error(String(data.message)));
          }
        }
      if (data.type === "export" && /^[0-9a-f-]{36}$/.test(data.media?.id)) {
        setOutput({
          id: data.media.id,
          url: "/api/timeline-editor/media?id=" + data.media.id,
        });
        setReviewOpen(true);
        setStatus(
          "Edited video saved to your account. Play, download or add it to Gallery.",
        );
      }
      if (data.type === "new-project") {
        setProjectMenuOpen(true);
        setStatus("Use New project to start another saved edit.");
      }
    };
    const warning = (event: BeforeUnloadEvent) => {
      if (dirty.current || rendering) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("message", receive);
    window.addEventListener("beforeunload", warning);
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("beforeunload", warning);
    };
  }, [rendering, project?.id]);
  useEffect(
    () => () => {
      for (const waiter of saveWaiters.current.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Editor closed."));
      }
      saveWaiters.current.clear();
    },
    [],
  );
  async function run(action: () => Promise<void>) {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "The editor action failed.",
      );
    } finally {
      actionInProgress.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!project || ready || loadFailed) return;
    const timer = setTimeout(() => {
      setLoadFailed(true);
      setError(
        "The project did not finish loading. Check the connection and sign in again if needed.",
      );
    }, 90000);
    return () => clearTimeout(timer);
  }, [project?.id, ready, loadFailed]);
  useEffect(() => {
    if (reviewOpen && output) reviewDialog.current?.showModal();
  }, [reviewOpen, output]);
  async function selectProject(next: Summary) {
    if (ready && dirty.current) await saveCurrent();
    setReady(false);
    setLoadFailed(false);
    dirty.current = false;
    setProject(next);
    setOutput(null);
    setReviewOpen(false);
    setProjectMenuOpen(false);
    setStatus("Opening " + next.name + "…");
  }
  return (
    <main
      ref={studioRef}
      className={`relative flex flex-col bg-slate-950 text-white ${project ? "h-dvh min-h-0 overflow-hidden" : "min-h-dvh"}`}
    >
      <header className="relative z-30 flex shrink-0 items-center gap-2 border-b border-white/15 px-2 py-1">
        <button
          className={toolbarButton}
          disabled={busy || rendering}
          onClick={() => void run(async () => {
            if (dirty.current) await saveCurrent();
            router.push("/app");
          })}
        >
          Back to app
        </button>
        {project ? (
          <>
            <StudioOrientationButton targetRef={studioRef} />
            <button
              className={toolbarButton}
              aria-expanded={projectMenuOpen}
              aria-controls="timeline-project-controls"
              onClick={() => setProjectMenuOpen((open) => !open)}
            >
              Project
            </button>
          </>
        ) : null}
      </header>
      <section
        id="timeline-project-controls"
        aria-label="Project controls"
        hidden={!!project && !projectMenuOpen}
        className={project
          ? "absolute inset-x-2 top-14 z-20 max-h-[calc(100%-4rem)] space-y-3 overflow-auto rounded-xl border border-white/20 bg-slate-950 p-3 shadow-xl"
          : "space-y-2 border-b border-white/15 p-3"}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto font-bold">
            Final Export Studio{" "}
            <span className="text-xs text-cyan-200">
              Sequence · Free
            </span>
          </h1>
          {project ? (
            <button className={button} onClick={() => setProjectMenuOpen(false)}>
              Close menu
            </button>
          ) : null}
          <a
            className="text-xs underline"
            href="/api/timeline-editor/app/source.tar.gz"
          >
            Editor source and license
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="New project name"
            className={field}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className={button}
            disabled={busy || rendering || (!!project && !ready && !loadFailed)}
            onClick={() =>
              void run(async () => {
                if (ready && dirty.current) await saveCurrent();
                if (createRequest.current?.name !== name)
                  createRequest.current = { name, id: newClientRequestId() };
                const data = await api("/api/timeline-editor", {
                  action: "create",
                  name,
                  requestId: createRequest.current.id,
                });
                createRequest.current = null;
                setProjects((items) => [data.project, ...items]);
                await selectProject(data.project);
              })
            }
          >
            New project
          </button>
          <select
            aria-label="Open saved project"
            className={field}
            value={project?.id || ""}
            disabled={busy || rendering || (!!project && !ready && !loadFailed)}
            onChange={(event) => {
              const next = projects.find(
                (item) => item.id === event.target.value,
              );
              if (next) void run(() => selectProject(next));
            }}
          >
            <option value="">Open saved project</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            className={button}
            disabled={busy || !ready}
            onClick={() => void run(saveCurrent)}
          >
            Save project
          </button>
          <button
            className={button}
            disabled={busy || !ready || rendering}
            onClick={() =>
              void run(async () => {
                const data = await api("/api/gallery?media=video&per=100");
                setGallery(
                  data.items.filter((item: GalleryItem) => item.video),
                );
              })
            }
          >
            OTG Gallery
          </button>
          {output ? (
            <button className={button} onClick={() => {
              setProjectMenuOpen(false);
              setReviewOpen(true);
            }}>
              Review export
            </button>
          ) : null}
        </div>
        <p role="status" className="text-xs text-white/70">
          {status}
        </p>
        {needsHttps ? (
          <p className="rounded-lg border border-amber-400/40 bg-amber-950/40 p-3 text-sm text-amber-100">
            Browser video decoding and export require HTTPS. Your saved projects
            are available after signing in at this site’s secure address.{" "}
            <a
              className="font-semibold underline"
              href={secureEditorUrl}
            >
              Open secure editor
            </a>
          </p>
        ) : null}
      </section>
      {error && !reviewOpen ? (
        <div
          role="alert"
          className="absolute inset-x-2 top-14 z-30 flex items-start gap-2 rounded-lg bg-red-950 p-2 text-sm text-red-100"
        >
          <p className="flex-1">{error}</p>
          <button aria-label="Dismiss message" onClick={() => setError("")}>
            Close
          </button>
        </div>
      ) : null}
      {project ? (
        <iframe
          key={project.id}
          ref={frame}
          title="Free multitrack video editor"
          src={`/api/timeline-editor/app/otg.html?project=${project.id}`}
          className="min-h-0 w-full flex-1 border-0"
          allow="fullscreen"
        />
      ) : (
        <section className="mx-auto max-w-2xl space-y-3 p-6 text-sm text-white/75">
          <h2 className="text-lg font-bold text-white">
            Edit your clips on a timeline
          </h2>
          <p>
            Create a project, import videos or audio from your phone, and
            arrange clips on separate tracks. Trim, split, copy, paste, adjust
            sound, add titles, then export MP4 or WebM.
          </p>
          <p>
            Edits and source media save to your account. The editor renders
            on your device and includes its source under AGPL-3.0.
          </p>
        </section>
      )}
      {output && reviewOpen ? (
        <dialog
          ref={reviewDialog}
          aria-label="Review edited video"
          onClose={() => setReviewOpen(false)}
          className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none space-y-3 overflow-auto border-0 bg-slate-950 p-3 text-white"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">Edited video</h2>
            <button className={button} autoFocus onClick={() => setReviewOpen(false)}>
              Back to studio
            </button>
          </div>
          <p role="status" className="text-sm text-white/70">{status}</p>
          {error ? <p role="alert" className="rounded-lg bg-red-950 p-2 text-red-100">{error}</p> : null}
          <video
            controls
            playsInline
            src={output.url}
            className="mx-auto max-h-72 w-full"
          />
          <div className="flex gap-2">
            <a className={button} href={output.url + "&download=1"}>
              Download edited video
            </a>
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("/api/timeline-editor/media", {
                    action: "save-gallery",
                    id: output.id,
                    title: project?.name,
                  });
                  setStatus("Edited video saved to OTG Gallery.");
                })
              }
            >
              Save to Gallery
            </button>
          </div>
        </dialog>
      ) : null}
      {gallery !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose OTG clips"
          className="fixed inset-0 z-[100001] overflow-auto bg-slate-950 p-4 text-white"
        >
          <div className="mb-4 flex justify-between">
            <h2 className="text-xl font-bold">OTG Gallery clips</h2>
            <button className={button} onClick={() => setGallery(null)}>
              Close Gallery
            </button>
          </div>
          {gallery.length === 0 ? (
            <p>Your Gallery has no video clips yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {gallery.map((item) => (
                <article
                  key={item.source + item.fileName}
                  className="space-y-2 rounded-lg border border-white/20 p-3"
                >
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    src={item.url}
                    className="max-h-40 w-full"
                  />
                  <p>{item.name}</p>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const data = await api("/api/timeline-editor/media", {
                          action: "import-gallery",
                          projectId: project!.id,
                          name: item.fileName,
                          scope: item.source,
                        });
                        send({ type: "import", media: [data.media] });
                        setGallery(null);
                        setStatus(
                          "Adding the OTG clip to the editor media library…",
                        );
                      })
                    }
                  >
                    Add clip to editor
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}

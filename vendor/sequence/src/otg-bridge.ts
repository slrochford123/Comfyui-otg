import { store } from "./core/store";
import { emptyProject, validateProject, type Project } from "./core/model";
import { assetFiles } from "./engine/client";
import { importFiles, relinkAsset } from "./core/actions";
import { exports } from "./engine/export";

const channel = "otg-sequence-v1";
const projectId = new URLSearchParams(location.search).get("project") || "";
let serverRevision = 0;
let bindings: Record<string, string> = {};
let saving = false;
let pending = false;
let lastProject: Project | undefined;
let lastExport = "";
let exportUploads = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let saveRequests: string[] = [];
function notify(type: string, detail: Record<string, unknown> = {}) {
  parent.postMessage({ channel, type, ...detail }, location.origin);
}
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
    throw new Error(data.error || "The editor request failed.");
  return data;
}
async function upload(file: Blob, name: string, exported = false) {
  const form = new FormData();
  form.set("session", projectId);
  form.set("file", file, name);
  const response = await fetch(
    "/api/timeline-editor/media" + (exported ? "?export=1" : ""),
    { method: "POST", credentials: "include", body: form },
  );
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw new Error(data.error || "Media could not be saved.");
  return data.media as { id: string; url: string; name: string };
}
async function save() {
  if (saving) {
    pending = true;
    return;
  }
  saving = true;
  clearTimeout(timer);
  timer = undefined;
  const requests = saveRequests;
  saveRequests = [];
  try {
    const snapshot = store.get().project;
    for (const asset of snapshot.assets) {
      if (bindings[asset.id]) continue;
      const file = assetFiles.get(asset.id);
      if (!file)
        throw new Error(
          "Relink missing media before saving this project to your account.",
        );
      notify("status", { message: "Saving " + asset.name + "…" });
      bindings[asset.id] = (await upload(file, asset.name)).id;
    }
    const result = await api("/api/timeline-editor", {
      action: "save",
      id: projectId,
      revision: serverRevision,
      state: { project: snapshot, media: bindings },
    });
    serverRevision = result.project.revision;
    const clean = store.get().project === snapshot;
    if (!clean) {
      saveRequests.push(...requests);
      pending = true;
    }
    notify("saved", {
      revision: serverRevision,
      name: snapshot.name,
      clean,
      requests: clean ? requests : [],
    });
  } catch (error) {
    notify("error", {
      message: error instanceof Error ? error.message : String(error),
      requests,
    });
  } finally {
    saving = false;
    if (pending) {
      pending = false;
      void save();
    }
  }
}
export async function startOtgBridge() {
  if (!/^[0-9a-f-]{36}$/.test(projectId))
    throw new Error("Open this editor from a project in your account.");
  const data = await api("/api/timeline-editor?id=" + projectId);
  serverRevision = data.project.revision;
  const snapshot = data.project.state as {
    project: Project;
    media: Record<string, string>;
  } | null;
  const project = snapshot
    ? validateProject(snapshot.project)
    : {
        ...emptyProject(),
        id: projectId,
        name: data.project.name,
        width: 1280,
        height: 720,
      };
  bindings = snapshot?.media || {};
  store.replace(project, false);
  store.clearHistory();
  if (project.assets.length) {
    const rows = (
      await api("/api/timeline-editor/media?projectId=" + projectId)
    ).media as { id: string; name: string; url: string }[];
    for (const asset of project.assets) {
      const media = rows.find((item) => item.id === bindings[asset.id]);
      if (!media)
        throw new Error(
          "A saved source is unavailable. Reopen the project or relink its media.",
        );
      const response = await fetch(media.url, { credentials: "include" });
      if (!response.ok)
        throw new Error("Saved source media could not be loaded.");
      const blob = await response.blob();
      await relinkAsset(
        asset.id,
        new File([blob], asset.name, { type: asset.type || blob.type }),
      );
    }
  }
  store.patch({ dirty: false });
  lastProject = store.get().project;
  store.subscribe(() => {
    const current = store.get().project;
    if (current === lastProject) return;
    lastProject = current;
    notify("dirty");
    clearTimeout(timer);
    timer = setTimeout(() => void save(), 1200);
  });
  exports.subscribe(() => {
    const job = exports.get();
    if (job.status !== "complete" || !job.blob || job.id === lastExport) {
      notify("rendering", { active: job.status === "rendering" || exportUploads > 0 });
      return;
    }
    lastExport = job.id;
    exportUploads += 1;
    notify("rendering", { active: true });
    notify("status", { message: "Saving the completed export…" });
    void upload(
      job.blob,
      (job.settings?.name || "edited-video") +
        "." +
        (job.settings?.format || "mp4"),
      true,
    )
      .then((media) => notify("export", { media }))
      .catch((error) => notify("error", { message: error.message }))
      .finally(() => {
        exportUploads -= 1;
        notify("rendering", {
          active: exports.get().status === "rendering" || exportUploads > 0,
        });
      });
  });
  window.addEventListener("message", (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      event.data?.channel !== channel
    )
      return;
    if (event.data.type === "save") {
      if (typeof event.data.requestId === "string")
        saveRequests.push(event.data.requestId);
      void save();
    }
    if (event.data.type === "import" && Array.isArray(event.data.media)) {
      void (async () => {
        for (const media of event.data.media as {
          id: string;
          name: string;
          url: string;
        }[]) {
          if (
            !/^\/api\/timeline-editor\/media\?id=[0-9a-f-]{36}$/.test(media.url)
          )
            throw new Error("Invalid owned media URL.");
          const response = await fetch(media.url, { credentials: "include" });
          if (!response.ok)
            throw new Error("The OTG clip could not be loaded.");
          const blob = await response.blob();
          const before = new Set(
            store.get().project.assets.map((asset) => asset.id),
          );
          await importFiles([
            new File([blob], media.name, { type: blob.type }),
          ]);
          const added = store
            .get()
            .project.assets.find((asset) => !before.has(asset.id));
          if (added) bindings[added.id] = media.id;
        }
        await save();
      })().catch((error) => notify("error", { message: error.message }));
    }
  });
  window.addEventListener("otg:save", () => void save());
  window.addEventListener("otg:new-project", () => notify("new-project"));
  window.addEventListener("beforeunload", (event) => {
    if (saving || pending || timer || exportUploads || exports.get().status === "rendering") {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  notify("ready");
}

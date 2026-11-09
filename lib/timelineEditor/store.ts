import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { RequestError } from "@/lib/requestError";
import { timelineEditorEnabled } from "./availability";

export const TIMELINE_EDITOR_VERSION = "sequence-0.2.1";
export type EditorProject = {
  id: string;
  name: string;
  revision: number;
  updatedAt: number;
  state: Record<string, unknown> | null;
};
export type EditorMedia = {
  id: string;
  projectId: string;
  name: string;
  kind: "video" | "audio" | "image";
  extension: string;
  duration: number;
  width: number;
  height: number;
  size: number;
  exported: boolean;
};
let connection: Database.Database | undefined;
export function requireTimelineEditor() {
  if (!timelineEditorEnabled()) throw new RequestError("Not found.", 404);
}
export function editorRoot(owner: string) {
  return path.join(
    OTG_DATA_ROOT,
    "timeline-editor-evaluation",
    safeSegment(owner),
  );
}
function db() {
  if (connection) return connection;
  const directory = path.join(OTG_DATA_ROOT, "timeline-editor-evaluation");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "editor.sqlite");
  connection = new Database(file);
  fs.chmodSync(file, 0o600);
  connection.pragma("journal_mode = WAL");
  connection.pragma("busy_timeout = 10000");
  connection.exec(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
    revision INTEGER NOT NULL, updated INTEGER NOT NULL, state TEXT, hash TEXT);
    CREATE TABLE IF NOT EXISTS versions (
    project TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL,
    PRIMARY KEY(project,revision));
    CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, record TEXT NOT NULL);
`);
  return connection;
}
export function listEditorProjects(owner: string) {
  return db()
    .prepare(
      "SELECT id,name,revision,updated AS updatedAt FROM projects WHERE owner=? ORDER BY updated DESC LIMIT 100",
    )
    .all(owner);
}
export function editorProject(owner: string, id: unknown): EditorProject {
  const row = db()
    .prepare(
      "SELECT id,name,revision,updated AS updatedAt,state FROM projects WHERE owner=? AND id=?",
    )
    .get(owner, String(id)) as
    (Omit<EditorProject, "state"> & { state: string | null }) | undefined;
  if (!row) throw new RequestError("Project not found.", 404);
  return { ...row, state: row.state ? JSON.parse(row.state) : null };
}
export function createEditorProject(
  owner: string,
  name: unknown,
  requestedId?: string,
): EditorProject {
  const title =
    String(name || "Untitled edit")
      .trim()
      .slice(0, 120) || "Untitled edit";
  const id = requestedId || randomUUID();
  if (!/^[0-9a-f-]{36}$/.test(id))
    throw new RequestError("Invalid project request ID.", 400);
  db()
    .prepare("INSERT OR IGNORE INTO projects VALUES (?,?,?,0,?,NULL,NULL)")
    .run(id, owner, title, Date.now());
  return editorProject(owner, id);
}
export function saveEditorProject(
  owner: string,
  id: string,
  revision: unknown,
  state: unknown,
) {
  const projectId = id;
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    !Number.isSafeInteger(revision)
  )
    throw new RequestError("A project state and revision are required.", 400);
  const snapshot = state as {
    project?: { assets?: { id?: unknown }[] };
    media?: Record<string, unknown>;
  };
  const assets = snapshot.project?.assets;
  if (
    !Array.isArray(assets) ||
    assets.length > 200 ||
    !snapshot.media ||
    typeof snapshot.media !== "object"
  )
    throw new RequestError("The project media list is invalid.", 400);
  for (const asset of assets) {
    const id = snapshot.media[String(asset.id)];
    if (typeof id !== "string")
      throw new RequestError(
        "Wait for your imported media to finish saving.",
        400,
      );
    const media = editorMedia(owner, id);
    if (media.projectId !== projectId)
      throw new RequestError("Media belongs to another project.", 400);
  }
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized) > 4 * 1024 * 1024)
    throw new RequestError("This evaluation project exceeds 4 MB.", 413);
  const hash = createHash("sha256").update(serialized).digest("hex");
  return db()
    .transaction(() => {
      const project = editorProject(owner, id);
      const previous = db()
        .prepare("SELECT hash FROM projects WHERE owner=? AND id=?")
        .get(owner, id) as { hash: string | null };
      if (previous.hash === hash) return project;
      if (project.revision !== revision)
        throw new RequestError(
          "This project changed in another window. Reopen it before saving.",
          409,
        );
      const next = project.revision + 1;
      db()
        .prepare("INSERT INTO versions VALUES (?,?,?)")
        .run(id, next, serialized);
      db()
        .prepare(
          "UPDATE projects SET revision=?,updated=?,state=?,hash=?,name=? WHERE owner=? AND id=?",
        )
        .run(
          next,
          Date.now(),
          serialized,
          hash,
          String((snapshot.project as { name?: string }).name || project.name)
            .trim()
            .slice(0, 120) || project.name,
          owner,
          id,
        );
      return editorProject(owner, id);
    })
    .immediate();
}
export function addEditorMedia(owner: string, record: EditorMedia) {
  editorProject(owner, record.projectId);
  db()
    .prepare("INSERT INTO media VALUES (?,?,?,?)")
    .run(record.id, owner, record.projectId, JSON.stringify(record));
  return { ...record, url: `/api/timeline-editor/media?id=${record.id}` };
}
export function editorMedia(owner: string, id: unknown): EditorMedia {
  const row = db()
    .prepare("SELECT record FROM media WHERE owner=? AND id=?")
    .get(owner, String(id)) as { record: string } | undefined;
  if (!row) throw new RequestError("Media not found.", 404);
  return JSON.parse(row.record);
}
export function editorMediaFile(owner: string, media: EditorMedia) {
  return path.join(editorRoot(owner), "media", media.id + media.extension);
}

export function listEditorMedia(owner: string, projectId: string) {
  const rows = db()
    .prepare("SELECT record FROM media WHERE owner=? AND project=?")
    .all(owner, projectId) as { record: string }[];
  return rows.map((row) => {
    const media = JSON.parse(row.record) as EditorMedia;
    return { ...media, url: `/api/timeline-editor/media?id=${media.id}` };
  });
}

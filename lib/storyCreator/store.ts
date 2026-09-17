import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const STORY_CREATOR_PROJECT_LIMIT = 6;

export type StoryCreatorProject = {
  id: string;
  ownerKey: string;
  title: string;
  format: string;
  genre: string;
  status: "active";
  createdAt: number;
  updatedAt: number;
};

export type StoryCreatorMessageRole = "user" | "assistant";

export type StoryCreatorMessage = {
  id: string;
  projectId: string;
  ownerKey: string;
  role: StoryCreatorMessageRole;
  content: string;
  createdAt: number;
};

let dbInstance: Database.Database | null = null;

function storyCreatorRoot() {
  const configured =
    String(process.env.OTG_DATA_DIR || "").trim() ||
    String(process.env.OTG_DATA_ROOT || "").trim();

  if (configured) {
    return path.join(configured, "story-creator");
  }

  return path.join(os.homedir(), "AI", "runtime", "story-creator");
}

function databasePath() {
  const root = storyCreatorRoot();
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, "story-creator.sqlite");
}

function db() {
  if (dbInstance) return dbInstance;

  const database = new Database(databasePath());

  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  database.exec(`
    CREATE TABLE IF NOT EXISTS story_projects (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      title TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_story_projects_owner_updated
      ON story_projects(owner_key, updated_at DESC);

    CREATE TABLE IF NOT EXISTS story_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_story_messages_project_created
      ON story_messages(project_id, created_at ASC);
  `);

  dbInstance = database;
  return database;
}

function cleanOwnerKey(value: unknown) {
  const key = String(value || "").trim();

  if (!key) {
    throw new Error("Story Creator owner is required.");
  }

  return key.slice(0, 240);
}

function cleanTitle(value: unknown) {
  const title = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!title) return "Untitled Story";

  return title.slice(0, 120);
}

function cleanShort(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function cleanProjectId(value: unknown) {
  const id = String(value || "").trim();

  if (!id) {
    throw new Error("Story project id is required.");
  }

  return id;
}

function cleanMessageContent(value: unknown) {
  const content = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();

  if (!content) {
    throw new Error("Story message content is required.");
  }

  return content.slice(0, 100_000);
}

function cleanMessageRole(value: unknown): StoryCreatorMessageRole {
  if (value === "user" || value === "assistant") {
    return value;
  }

  throw new Error("Story message role must be user or assistant.");
}

function storyProjectNotFoundError() {
  const error = new Error("Story project not found.") as Error & {
    code?: string;
  };

  error.code = "STORY_PROJECT_NOT_FOUND";
  return error;
}

function rowToProject(row: any): StoryCreatorProject {
  return {
    id: String(row.id),
    ownerKey: String(row.owner_key),
    title: String(row.title),
    format: String(row.format || ""),
    genre: String(row.genre || ""),
    status: "active",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToMessage(row: any): StoryCreatorMessage {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content || ""),
    createdAt: Number(row.created_at),
  };
}

function assertOwnedActiveProject(
  ownerKeyInput: unknown,
  projectIdInput: unknown,
) {
  const ownerKey = cleanOwnerKey(ownerKeyInput);
  const projectId = cleanProjectId(projectIdInput);

  const row = db()
    .prepare(`
      SELECT *
      FROM story_projects
      WHERE id = ?
        AND owner_key = ?
        AND status = 'active'
      LIMIT 1
    `)
    .get(projectId, ownerKey) as any;

  if (!row) {
    throw storyProjectNotFoundError();
  }

  return {
    ownerKey,
    projectId,
    project: rowToProject(row),
  };
}

export function listStoryCreatorProjects(ownerKeyInput: unknown) {
  const ownerKey = cleanOwnerKey(ownerKeyInput);

  const rows = db()
    .prepare(`
      SELECT *
      FROM story_projects
      WHERE owner_key = ?
        AND status = 'active'
      ORDER BY updated_at DESC
    `)
    .all(ownerKey);

  return rows.map(rowToProject);
}

export function createStoryCreatorProject(input: {
  ownerKey: unknown;
  title?: unknown;
  format?: unknown;
  genre?: unknown;
}) {
  const ownerKey = cleanOwnerKey(input.ownerKey);

  const countRow = db()
    .prepare(`
      SELECT COUNT(*) AS count
      FROM story_projects
      WHERE owner_key = ?
        AND status = 'active'
    `)
    .get(ownerKey) as { count: number };

  if (
    Number(countRow?.count || 0) >=
    STORY_CREATOR_PROJECT_LIMIT
  ) {
    const error = new Error(
      `Story Creator supports up to ${STORY_CREATOR_PROJECT_LIMIT} active stories.`,
    ) as Error & { code?: string };

    error.code = "STORY_PROJECT_LIMIT";
    throw error;
  }

  const now = Date.now();

  const project: StoryCreatorProject = {
    id: randomUUID(),
    ownerKey,
    title: cleanTitle(input.title),
    format: cleanShort(input.format),
    genre: cleanShort(input.genre),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  db()
    .prepare(`
      INSERT INTO story_projects (
        id,
        owner_key,
        title,
        format,
        genre,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `)
    .run(
      project.id,
      project.ownerKey,
      project.title,
      project.format,
      project.genre,
      project.createdAt,
      project.updatedAt,
    );

  return project;
}

export function updateStoryCreatorProject(input: {
  ownerKey: unknown;
  id: unknown;
  title?: unknown;
  format?: unknown;
  genre?: unknown;
}) {
  const ownerKey = cleanOwnerKey(input.ownerKey);
  const id = cleanProjectId(input.id);

  const existing = db()
    .prepare(`
      SELECT *
      FROM story_projects
      WHERE id = ?
        AND owner_key = ?
        AND status = 'active'
      LIMIT 1
    `)
    .get(id, ownerKey) as any;

  if (!existing) {
    throw storyProjectNotFoundError();
  }

  const nextTitle =
    input.title === undefined
      ? String(existing.title)
      : cleanTitle(input.title);

  const nextFormat =
    input.format === undefined
      ? String(existing.format || "")
      : cleanShort(input.format);

  const nextGenre =
    input.genre === undefined
      ? String(existing.genre || "")
      : cleanShort(input.genre);

  const updatedAt = Date.now();

  db()
    .prepare(`
      UPDATE story_projects
      SET title = ?,
          format = ?,
          genre = ?,
          updated_at = ?
      WHERE id = ?
        AND owner_key = ?
        AND status = 'active'
    `)
    .run(
      nextTitle,
      nextFormat,
      nextGenre,
      updatedAt,
      id,
      ownerKey,
    );

  return rowToProject({
    ...existing,
    title: nextTitle,
    format: nextFormat,
    genre: nextGenre,
    updated_at: updatedAt,
  });
}

export function deleteStoryCreatorProject(input: {
  ownerKey: unknown;
  id: unknown;
}) {
  const ownerKey = cleanOwnerKey(input.ownerKey);
  const id = cleanProjectId(input.id);

  const result = db()
    .prepare(`
      DELETE FROM story_projects
      WHERE id = ?
        AND owner_key = ?
    `)
    .run(id, ownerKey);

  if (!result.changes) {
    throw storyProjectNotFoundError();
  }

  return { ok: true };
}

export function listStoryCreatorMessages(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );

  const rows = db()
    .prepare(`
      SELECT
        rowid AS message_rowid,
        id,
        project_id,
        owner_key,
        role,
        content,
        created_at
      FROM story_messages
      WHERE project_id = ?
        AND owner_key = ?
      ORDER BY created_at ASC, message_rowid ASC
    `)
    .all(projectId, ownerKey);

  return rows.map(rowToMessage);
}

export function addStoryCreatorMessage(input: {
  ownerKey: unknown;
  projectId: unknown;
  role: unknown;
  content: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );

  const role = cleanMessageRole(input.role);
  const content = cleanMessageContent(input.content);
  const now = Date.now();

  const message: StoryCreatorMessage = {
    id: randomUUID(),
    projectId,
    ownerKey,
    role,
    content,
    createdAt: now,
  };

  const write = db().transaction(() => {
    db()
      .prepare(`
        INSERT INTO story_messages (
          id,
          project_id,
          owner_key,
          role,
          content,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        message.id,
        message.projectId,
        message.ownerKey,
        message.role,
        message.content,
        message.createdAt,
      );

    db()
      .prepare(`
        UPDATE story_projects
        SET updated_at = ?
        WHERE id = ?
          AND owner_key = ?
          AND status = 'active'
      `)
      .run(
        now,
        projectId,
        ownerKey,
      );
  });

  write();

  return message;
}

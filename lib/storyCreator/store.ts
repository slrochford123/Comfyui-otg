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
  `);

  dbInstance = database;
  return database;
}

function cleanOwnerKey(value: unknown) {
  const key = String(value || "").trim();
  if (!key) throw new Error("Story Creator owner is required.");
  return key.slice(0, 240);
}

function cleanTitle(value: unknown) {
  const title = String(value || "").trim().replace(/\s+/g, " ");
  if (!title) return "Untitled Story";
  return title.slice(0, 120);
}

function cleanShort(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
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

  if (Number(countRow?.count || 0) >= STORY_CREATOR_PROJECT_LIMIT) {
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
  const id = String(input.id || "").trim();

  if (!id) throw new Error("Story project id is required.");

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
    const error = new Error("Story project not found.") as Error & {
      code?: string;
    };
    error.code = "STORY_PROJECT_NOT_FOUND";
    throw error;
  }

  const nextTitle =
    input.title === undefined ? String(existing.title) : cleanTitle(input.title);

  const nextFormat =
    input.format === undefined ? String(existing.format || "") : cleanShort(input.format);

  const nextGenre =
    input.genre === undefined ? String(existing.genre || "") : cleanShort(input.genre);

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
    .run(nextTitle, nextFormat, nextGenre, updatedAt, id, ownerKey);

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
  const id = String(input.id || "").trim();

  if (!id) throw new Error("Story project id is required.");

  const result = db()
    .prepare(`
      DELETE FROM story_projects
      WHERE id = ?
        AND owner_key = ?
    `)
    .run(id, ownerKey);

  if (!result.changes) {
    const error = new Error("Story project not found.") as Error & {
      code?: string;
    };
    error.code = "STORY_PROJECT_NOT_FOUND";
    throw error;
  }

  return { ok: true };
}

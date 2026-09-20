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
  matureLanguageEnabled: boolean;
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

export type StoryCreatorTurnStatus =
  | "running"
  | "assistant_saved"
  | "completed"
  | "failed";

export type StoryCreatorTurn = {
  id: string;
  projectId: string;
  ownerKey: string;
  clientTurnId: string;
  requestContent: string;
  userMessageId: string;
  assistantMessageId: string | null;
  status: StoryCreatorTurnStatus;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  lastError: string;
  createdAt: number;
  updatedAt: number;
};

export type StoryCreatorTurnClaim =
  | {
      action: "claimed";
      turn: StoryCreatorTurn;
      userMessage: StoryCreatorMessage;
      assistantMessage: null;
      leaseToken: string;
    }
  | {
      action: "resume_assistant";
      turn: StoryCreatorTurn;
      userMessage: StoryCreatorMessage;
      assistantMessage: StoryCreatorMessage;
      leaseToken: string;
    }
  | {
      action: "in_progress";
      turn: StoryCreatorTurn;
      userMessage: StoryCreatorMessage;
      assistantMessage: StoryCreatorMessage | null;
    }
  | {
      action: "completed";
      turn: StoryCreatorTurn;
      userMessage: StoryCreatorMessage;
      assistantMessage: StoryCreatorMessage;
    };

export type StoryBibleFactStatus =
  | "canon"
  | "suggestion"
  | "unknown";

export type StoryBibleSourceRole =
  | "user"
  | "assistant"
  | "system";

export type StoryBibleEntity = {
  id: string;
  projectId: string;
  ownerKey: string;
  entityType: string;
  name: string;
  sourceRole: StoryBibleSourceRole;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type StoryBibleFact = {
  id: string;
  projectId: string;
  ownerKey: string;
  subjectEntityId: string | null;
  predicate: string;
  valueText: string;
  objectEntityId: string | null;
  canonStatus: StoryBibleFactStatus;
  sourceRole: StoryBibleSourceRole;
  sourceMessageId: string | null;
  supersedesFactId: string | null;
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
      mature_language_enabled INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS story_turns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      client_turn_id TEXT NOT NULL,
      request_content TEXT NOT NULL,
      user_message_id TEXT NOT NULL,
      assistant_message_id TEXT,
      status TEXT NOT NULL
        CHECK(status IN ('running', 'assistant_saved', 'completed', 'failed')),
      lease_token TEXT,
      lease_expires_at INTEGER,
      last_error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,

      UNIQUE(
        owner_key,
        project_id,
        client_turn_id
      ),

      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,

      FOREIGN KEY (user_message_id)
        REFERENCES story_messages(id)
        ON DELETE CASCADE,

      FOREIGN KEY (assistant_message_id)
        REFERENCES story_messages(id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_story_turns_project_status_updated
      ON story_turns(
        project_id,
        status,
        updated_at ASC
      );

    CREATE TABLE IF NOT EXISTS story_entities (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      source_role TEXT NOT NULL
        CHECK(source_role IN ('user', 'assistant', 'system')),
      source_message_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (source_message_id)
        REFERENCES story_messages(id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_story_entities_project_name
      ON story_entities(
        project_id,
        name COLLATE NOCASE,
        created_at ASC
      );

    CREATE TABLE IF NOT EXISTS story_facts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      subject_entity_id TEXT,
      predicate TEXT NOT NULL,
      value_text TEXT NOT NULL DEFAULT '',
      object_entity_id TEXT,
      canon_status TEXT NOT NULL
        CHECK(canon_status IN ('canon', 'suggestion', 'unknown')),
      source_role TEXT NOT NULL
        CHECK(source_role IN ('user', 'assistant', 'system')),
      source_message_id TEXT,
      supersedes_fact_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,

      CHECK(
        canon_status = 'unknown'
        OR length(trim(value_text)) > 0
        OR object_entity_id IS NOT NULL
      ),

      CHECK(
        NOT (
          source_role = 'assistant'
          AND canon_status = 'canon'
        )
      ),

      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,

      FOREIGN KEY (subject_entity_id)
        REFERENCES story_entities(id)
        ON DELETE CASCADE,

      FOREIGN KEY (object_entity_id)
        REFERENCES story_entities(id)
        ON DELETE SET NULL,

      FOREIGN KEY (source_message_id)
        REFERENCES story_messages(id)
        ON DELETE SET NULL,

      FOREIGN KEY (supersedes_fact_id)
        REFERENCES story_facts(id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_story_facts_project_status
      ON story_facts(
        project_id,
        canon_status,
        created_at ASC
      );

    CREATE INDEX IF NOT EXISTS idx_story_facts_subject_predicate
      ON story_facts(
        subject_entity_id,
        predicate,
        created_at ASC
      );

    CREATE INDEX IF NOT EXISTS idx_story_facts_supersedes
      ON story_facts(supersedes_fact_id);

    CREATE TRIGGER IF NOT EXISTS trg_story_facts_non_user_canon
      BEFORE INSERT ON story_facts
      FOR EACH ROW
      WHEN NEW.canon_status = 'canon'
        AND NEW.source_role <> 'user'
      BEGIN
        SELECT RAISE(
          ABORT,
          'STORY_BIBLE_NON_USER_CANON_FORBIDDEN'
        );
      END;
  `);

  const storyProjectColumns =
    database
      .prepare("PRAGMA table_info(story_projects)")
      .all() as Array<{ name: string }>;

  if (
    storyProjectColumns.every(
      (column) =>
        column.name !== "mature_language_enabled",
    )
  ) {
    database.exec(
      "ALTER TABLE story_projects ADD COLUMN mature_language_enabled INTEGER NOT NULL DEFAULT 0",
    );
  }

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

function cleanMatureLanguageEnabled(
  value: unknown,
  fallback: boolean,
) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    const error = new Error(
      "Mature Language must be true or false.",
    ) as Error & { code?: string };

    error.code = "STORY_PROJECT_INVALID";
    throw error;
  }

  return value;
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

const STORY_CREATOR_TURN_CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORY_CREATOR_TURN_DEFAULT_LEASE_MS =
  5 * 60 * 1000;

const STORY_CREATOR_TURN_MAX_LEASE_MS =
  10 * 60 * 1000;

function storyCreatorTurnError(
  code: string,
  message: string,
  status = 409,
) {
  const error =
    new Error(message) as Error & {
      code?: string;
      status?: number;
    };

  error.code = code;
  error.status = status;

  return error;
}

function cleanStoryCreatorClientTurnId(
  value: unknown,
) {
  const id =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    !STORY_CREATOR_TURN_CLIENT_ID_PATTERN.test(id)
  ) {
    throw storyCreatorTurnError(
      "STORY_DIRECTOR_CLIENT_TURN_ID_INVALID",
      "Story Director clientTurnId must be an opaque UUID.",
      400,
    );
  }

  return id;
}

function cleanStoryCreatorTurnLeaseMs(
  value: unknown,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return STORY_CREATOR_TURN_DEFAULT_LEASE_MS;
  }

  const milliseconds =
    Math.floor(Number(value));

  if (
    !Number.isFinite(milliseconds) ||
    milliseconds < 1 ||
    milliseconds >
      STORY_CREATOR_TURN_MAX_LEASE_MS
  ) {
    throw storyCreatorTurnError(
      "STORY_DIRECTOR_TURN_LEASE_INVALID",
      "Story Director turn lease is invalid.",
      400,
    );
  }

  return milliseconds;
}

function cleanStoryCreatorTurnLeaseToken(
  value: unknown,
) {
  const token =
    String(value || "").trim();

  if (!token) {
    throw storyCreatorTurnError(
      "STORY_DIRECTOR_TURN_LEASE_TOKEN_REQUIRED",
      "Story Director turn lease token is required.",
      409,
    );
  }

  return token.slice(0, 240);
}

function cleanStoryCreatorTurnLastError(
  value: unknown,
) {
  return (
    String(value || "")
      .replace(/\r\n/g, "\n")
      .trim() ||
    "Story Director request failed."
  ).slice(0, 4000);
}

function cleanStoryCreatorTurnStatus(
  value: unknown,
): StoryCreatorTurnStatus {
  if (
    value === "running" ||
    value === "assistant_saved" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }

  throw storyCreatorTurnError(
    "STORY_DIRECTOR_TURN_STATE_CORRUPT",
    "Story Director turn state is invalid.",
    500,
  );
}

function cleanStoryBibleSourceRole(
  value: unknown,
): StoryBibleSourceRole {
  if (
    value === "user" ||
    value === "assistant" ||
    value === "system"
  ) {
    return value;
  }

  throw new Error(
    "Story Bible source role must be user, assistant, or system.",
  );
}

function cleanStoryBibleFactStatus(
  value: unknown,
): StoryBibleFactStatus {
  if (
    value === "canon" ||
    value === "suggestion" ||
    value === "unknown"
  ) {
    return value;
  }

  throw new Error(
    "Story Bible fact status must be canon, suggestion, or unknown.",
  );
}

function cleanStoryBibleEntityType(value: unknown) {
  const entityType = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!entityType) {
    throw new Error("Story Bible entity type is required.");
  }

  return entityType.slice(0, 80);
}

function cleanStoryBibleEntityName(value: unknown) {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!name) {
    throw new Error("Story Bible entity name is required.");
  }

  return name.slice(0, 160);
}

function cleanStoryBiblePredicate(value: unknown) {
  const predicate = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!predicate) {
    throw new Error("Story Bible fact predicate is required.");
  }

  return predicate.slice(0, 160);
}

function cleanStoryBibleFactValue(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 100_000);
}

function cleanOptionalStoryBibleId(value: unknown) {
  const id = String(value || "").trim();
  return id ? id.slice(0, 240) : null;
}

function storyBibleError(
  code: string,
  message: string,
) {
  const error = new Error(message) as Error & {
    code?: string;
  };

  error.code = code;
  return error;
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
    matureLanguageEnabled:
      Number(row.mature_language_enabled || 0) === 1,
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

function rowToStoryCreatorTurn(
  row: any,
): StoryCreatorTurn {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    clientTurnId:
      String(row.client_turn_id),
    requestContent:
      String(row.request_content || ""),
    userMessageId:
      String(row.user_message_id),
    assistantMessageId:
      row.assistant_message_id
        ? String(row.assistant_message_id)
        : null,
    status:
      cleanStoryCreatorTurnStatus(row.status),
    leaseToken:
      row.lease_token
        ? String(row.lease_token)
        : null,
    leaseExpiresAt:
      row.lease_expires_at === null ||
      row.lease_expires_at === undefined
        ? null
        : Number(row.lease_expires_at),
    lastError:
      String(row.last_error || ""),
    createdAt:
      Number(row.created_at),
    updatedAt:
      Number(row.updated_at),
  };
}

function rowToStoryBibleEntity(
  row: any,
): StoryBibleEntity {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    entityType: String(row.entity_type || ""),
    name: String(row.name || ""),
    sourceRole: cleanStoryBibleSourceRole(
      row.source_role,
    ),
    sourceMessageId: row.source_message_id
      ? String(row.source_message_id)
      : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStoryBibleFact(
  row: any,
): StoryBibleFact {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    subjectEntityId: row.subject_entity_id
      ? String(row.subject_entity_id)
      : null,
    predicate: String(row.predicate || ""),
    valueText: String(row.value_text || ""),
    objectEntityId: row.object_entity_id
      ? String(row.object_entity_id)
      : null,
    canonStatus: cleanStoryBibleFactStatus(
      row.canon_status,
    ),
    sourceRole: cleanStoryBibleSourceRole(
      row.source_role,
    ),
    sourceMessageId: row.source_message_id
      ? String(row.source_message_id)
      : null,
    supersedesFactId: row.supersedes_fact_id
      ? String(row.supersedes_fact_id)
      : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
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

export function getStoryCreatorProject(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  return assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  ).project;
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
  matureLanguageEnabled?: unknown;
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
    matureLanguageEnabled:
      cleanMatureLanguageEnabled(
        input.matureLanguageEnabled,
        false,
      ),
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
        mature_language_enabled,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `)
    .run(
      project.id,
      project.ownerKey,
      project.title,
      project.format,
      project.genre,
      project.matureLanguageEnabled ? 1 : 0,
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
  matureLanguageEnabled?: unknown;
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

  const nextMatureLanguageEnabled =
    cleanMatureLanguageEnabled(
      input.matureLanguageEnabled,
      Number(
        existing.mature_language_enabled || 0,
      ) === 1,
    );

  const updatedAt = Date.now();

  db()
    .prepare(`
      UPDATE story_projects
      SET title = ?,
          format = ?,
          genre = ?,
          mature_language_enabled = ?,
          updated_at = ?
      WHERE id = ?
        AND owner_key = ?
        AND status = 'active'
    `)
    .run(
      nextTitle,
      nextFormat,
      nextGenre,
      nextMatureLanguageEnabled ? 1 : 0,
      updatedAt,
      id,
      ownerKey,
    );

  return rowToProject({
    ...existing,
    title: nextTitle,
    format: nextFormat,
    genre: nextGenre,
    mature_language_enabled:
      nextMatureLanguageEnabled ? 1 : 0,
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

function selectStoryCreatorTurnRow(
  ownerKey: string,
  projectId: string,
  clientTurnId: string,
) {
  return db()
    .prepare(`
      SELECT *
      FROM story_turns
      WHERE owner_key = ?
        AND project_id = ?
        AND client_turn_id = ?
      LIMIT 1
    `)
    .get(
      ownerKey,
      projectId,
      clientTurnId,
    ) as any;
}

function requireStoryCreatorTurnMessage(
  input: {
    ownerKey: string;
    projectId: string;
    messageId: string;
    expectedRole:
      StoryCreatorMessageRole;
  },
) {
  const row = db()
    .prepare(`
      SELECT *
      FROM story_messages
      WHERE id = ?
        AND project_id = ?
        AND owner_key = ?
      LIMIT 1
    `)
    .get(
      input.messageId,
      input.projectId,
      input.ownerKey,
    ) as any;

  if (!row) {
    throw storyCreatorTurnError(
      "STORY_DIRECTOR_TURN_STATE_CORRUPT",
      "Story Director turn references a missing message.",
      500,
    );
  }

  const message = rowToMessage(row);

  if (
    message.role !==
      input.expectedRole
  ) {
    throw storyCreatorTurnError(
      "STORY_DIRECTOR_TURN_STATE_CORRUPT",
      "Story Director turn message role is invalid.",
      500,
    );
  }

  return message;
}

function requireStoryCreatorTurn(
  ownerKey: string,
  projectId: string,
  clientTurnId: string,
) {
  const row =
    selectStoryCreatorTurnRow(
      ownerKey,
      projectId,
      clientTurnId,
    );

  if (!row) {
    throw storyCreatorTurnError(
      "STORY_DIRECTOR_TURN_NOT_FOUND",
      "Story Director turn was not found.",
      404,
    );
  }

  return rowToStoryCreatorTurn(row);
}

function assertStoryCreatorTurnLease(
  turn: StoryCreatorTurn,
  leaseToken: string,
  now: number,
) {
  if (
    turn.leaseToken !== leaseToken ||
    turn.leaseExpiresAt === null ||
    turn.leaseExpiresAt <= now
  ) {
    throw storyCreatorTurnError(
      "STORY_DIRECTOR_TURN_LEASE_LOST",
      "Story Director turn lease is no longer owned by this request.",
      409,
    );
  }
}

export function claimStoryCreatorTurn(
  input: {
    ownerKey: unknown;
    projectId: unknown;
    clientTurnId: unknown;
    content: unknown;
    leaseMs?: unknown;
  },
): StoryCreatorTurnClaim {
  const ownerKey =
    cleanOwnerKey(input.ownerKey);

  const projectId =
    cleanProjectId(input.projectId);

  const clientTurnId =
    cleanStoryCreatorClientTurnId(
      input.clientTurnId,
    );

  const content =
    cleanMessageContent(input.content);

  const leaseMs =
    cleanStoryCreatorTurnLeaseMs(
      input.leaseMs,
    );

  const leaseToken = randomUUID();

  const write =
    db().transaction(
      (): StoryCreatorTurnClaim => {
        const now = Date.now();

        assertOwnedActiveProject(
          ownerKey,
          projectId,
        );

        const existingRow =
          selectStoryCreatorTurnRow(
            ownerKey,
            projectId,
            clientTurnId,
          );

        if (!existingRow) {
          const userMessage:
            StoryCreatorMessage = {
              id: randomUUID(),
              projectId,
              ownerKey,
              role: "user",
              content,
              createdAt: now,
            };

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
              userMessage.id,
              userMessage.projectId,
              userMessage.ownerKey,
              userMessage.role,
              userMessage.content,
              userMessage.createdAt,
            );

          db()
            .prepare(`
              INSERT INTO story_turns (
                id,
                project_id,
                owner_key,
                client_turn_id,
                request_content,
                user_message_id,
                assistant_message_id,
                status,
                lease_token,
                lease_expires_at,
                last_error,
                created_at,
                updated_at
              )
              VALUES (
                ?, ?, ?, ?, ?, ?,
                NULL,
                'running',
                ?, ?,
                '',
                ?, ?
              )
            `)
            .run(
              randomUUID(),
              projectId,
              ownerKey,
              clientTurnId,
              content,
              userMessage.id,
              leaseToken,
              now + leaseMs,
              now,
              now,
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

          return {
            action: "claimed",
            turn:
              requireStoryCreatorTurn(
                ownerKey,
                projectId,
                clientTurnId,
              ),
            userMessage,
            assistantMessage: null,
            leaseToken,
          };
        }

        const turn =
          rowToStoryCreatorTurn(
            existingRow,
          );

        if (
          turn.requestContent !== content
        ) {
          throw storyCreatorTurnError(
            "STORY_DIRECTOR_TURN_ID_CONFLICT",
            "This Story Director clientTurnId was already used for different content.",
            409,
          );
        }

        const userMessage =
          requireStoryCreatorTurnMessage({
            ownerKey,
            projectId,
            messageId:
              turn.userMessageId,
            expectedRole: "user",
          });

        const assistantMessage =
          turn.assistantMessageId
            ? requireStoryCreatorTurnMessage({
                ownerKey,
                projectId,
                messageId:
                  turn.assistantMessageId,
                expectedRole:
                  "assistant",
              })
            : null;

        if (
          turn.status === "completed"
        ) {
          if (!assistantMessage) {
            throw storyCreatorTurnError(
              "STORY_DIRECTOR_TURN_STATE_CORRUPT",
              "Completed Story Director turn has no assistant message.",
              500,
            );
          }

          return {
            action: "completed",
            turn,
            userMessage,
            assistantMessage,
          };
        }

        const leaseIsLive =
          Boolean(turn.leaseToken) &&
          turn.leaseExpiresAt !== null &&
          turn.leaseExpiresAt > now;

        if (leaseIsLive) {
          return {
            action: "in_progress",
            turn,
            userMessage,
            assistantMessage,
          };
        }

        if (
          turn.status ===
          "assistant_saved"
        ) {
          if (!assistantMessage) {
            throw storyCreatorTurnError(
              "STORY_DIRECTOR_TURN_STATE_CORRUPT",
              "Assistant-saved Story Director turn has no assistant message.",
              500,
            );
          }

          db()
            .prepare(`
              UPDATE story_turns
              SET lease_token = ?,
                  lease_expires_at = ?,
                  last_error = '',
                  updated_at = ?
              WHERE id = ?
            `)
            .run(
              leaseToken,
              now + leaseMs,
              now,
              turn.id,
            );

          return {
            action:
              "resume_assistant",
            turn:
              requireStoryCreatorTurn(
                ownerKey,
                projectId,
                clientTurnId,
              ),
            userMessage,
            assistantMessage,
            leaseToken,
          };
        }

        if (assistantMessage) {
          throw storyCreatorTurnError(
            "STORY_DIRECTOR_TURN_STATE_CORRUPT",
            "Running or failed Story Director turn unexpectedly has an assistant message.",
            500,
          );
        }

        db()
          .prepare(`
            UPDATE story_turns
            SET status = 'running',
                lease_token = ?,
                lease_expires_at = ?,
                last_error = '',
                updated_at = ?
            WHERE id = ?
          `)
          .run(
            leaseToken,
            now + leaseMs,
            now,
            turn.id,
          );

        return {
          action: "claimed",
          turn:
            requireStoryCreatorTurn(
              ownerKey,
              projectId,
              clientTurnId,
            ),
          userMessage,
          assistantMessage: null,
          leaseToken,
        };
      },
    );

  return write.immediate();
}

export function saveStoryCreatorTurnAssistant(
  input: {
    ownerKey: unknown;
    projectId: unknown;
    clientTurnId: unknown;
    leaseToken: unknown;
    content: unknown;
    leaseMs?: unknown;
  },
) {
  const ownerKey =
    cleanOwnerKey(input.ownerKey);

  const projectId =
    cleanProjectId(input.projectId);

  const clientTurnId =
    cleanStoryCreatorClientTurnId(
      input.clientTurnId,
    );

  const leaseToken =
    cleanStoryCreatorTurnLeaseToken(
      input.leaseToken,
    );

  const content =
    cleanMessageContent(input.content);

  const leaseMs =
    cleanStoryCreatorTurnLeaseMs(
      input.leaseMs,
    );


  const write =
    db().transaction(() => {
      const now = Date.now();

      const turn =
        requireStoryCreatorTurn(
          ownerKey,
          projectId,
          clientTurnId,
        );

      if (
        turn.status === "completed"
      ) {
        throw storyCreatorTurnError(
          "STORY_DIRECTOR_TURN_STATE_INVALID",
          "Completed Story Director turns are replayed through claim and cannot save another assistant message.",
          409,
        );
      }

      if (
        turn.status ===
        "assistant_saved"
      ) {
        assertStoryCreatorTurnLease(
          turn,
          leaseToken,
          now,
        );

        if (!turn.assistantMessageId) {
          throw storyCreatorTurnError(
            "STORY_DIRECTOR_TURN_STATE_CORRUPT",
            "Assistant-saved Story Director turn has no assistant message.",
            500,
          );
        }

        return requireStoryCreatorTurnMessage({
          ownerKey,
          projectId,
          messageId:
            turn.assistantMessageId,
          expectedRole:
            "assistant",
        });
      }

      if (
        turn.status !== "running"
      ) {
        throw storyCreatorTurnError(
          "STORY_DIRECTOR_TURN_STATE_INVALID",
          "Story Director turn is not ready for an assistant message.",
          409,
        );
      }

      assertStoryCreatorTurnLease(
        turn,
        leaseToken,
        now,
      );

      const assistantMessage:
        StoryCreatorMessage = {
          id: randomUUID(),
          projectId,
          ownerKey,
          role: "assistant",
          content,
          createdAt: now,
        };

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
          assistantMessage.id,
          assistantMessage.projectId,
          assistantMessage.ownerKey,
          assistantMessage.role,
          assistantMessage.content,
          assistantMessage.createdAt,
        );

      db()
        .prepare(`
          UPDATE story_turns
          SET assistant_message_id = ?,
              status = 'assistant_saved',
              lease_expires_at = ?,
              last_error = '',
              updated_at = ?
          WHERE id = ?
        `)
        .run(
          assistantMessage.id,
          now + leaseMs,
          now,
          turn.id,
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

      return assistantMessage;
    });

  return write.immediate();
}

export function completeStoryCreatorTurn(
  input: {
    ownerKey: unknown;
    projectId: unknown;
    clientTurnId: unknown;
    leaseToken: unknown;
  },
) {
  const ownerKey =
    cleanOwnerKey(input.ownerKey);

  const projectId =
    cleanProjectId(input.projectId);

  const clientTurnId =
    cleanStoryCreatorClientTurnId(
      input.clientTurnId,
    );

  const leaseToken =
    cleanStoryCreatorTurnLeaseToken(
      input.leaseToken,
    );


  const write =
    db().transaction(() => {
      const now = Date.now();

      const turn =
        requireStoryCreatorTurn(
          ownerKey,
          projectId,
          clientTurnId,
        );

      if (
        turn.status === "completed"
      ) {
        return turn;
      }

      if (
        turn.status !==
        "assistant_saved"
      ) {
        throw storyCreatorTurnError(
          "STORY_DIRECTOR_TURN_STATE_INVALID",
          "Story Director turn cannot complete before the assistant message is saved.",
          409,
        );
      }

      assertStoryCreatorTurnLease(
        turn,
        leaseToken,
        now,
      );

      db()
        .prepare(`
          UPDATE story_turns
          SET status = 'completed',
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error = '',
              updated_at = ?
          WHERE id = ?
        `)
        .run(
          now,
          turn.id,
        );

      return requireStoryCreatorTurn(
        ownerKey,
        projectId,
        clientTurnId,
      );
    });

  return write.immediate();
}

export function failStoryCreatorTurn(
  input: {
    ownerKey: unknown;
    projectId: unknown;
    clientTurnId: unknown;
    leaseToken: unknown;
    error: unknown;
  },
) {
  const ownerKey =
    cleanOwnerKey(input.ownerKey);

  const projectId =
    cleanProjectId(input.projectId);

  const clientTurnId =
    cleanStoryCreatorClientTurnId(
      input.clientTurnId,
    );

  const leaseToken =
    cleanStoryCreatorTurnLeaseToken(
      input.leaseToken,
    );

  const lastError =
    cleanStoryCreatorTurnLastError(
      input.error,
    );


  const write =
    db().transaction(() => {
      const now = Date.now();

      const turn =
        requireStoryCreatorTurn(
          ownerKey,
          projectId,
          clientTurnId,
        );

      if (
        turn.status === "failed"
      ) {
        return turn;
      }

      if (
        turn.status !== "running"
      ) {
        throw storyCreatorTurnError(
          "STORY_DIRECTOR_TURN_STATE_INVALID",
          "Story Director turn can only fail before the assistant message is saved.",
          409,
        );
      }

      assertStoryCreatorTurnLease(
        turn,
        leaseToken,
        now,
      );

      db()
        .prepare(`
          UPDATE story_turns
          SET status = 'failed',
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error = ?,
              updated_at = ?
          WHERE id = ?
        `)
        .run(
          lastError,
          now,
          turn.id,
        );

      return requireStoryCreatorTurn(
        ownerKey,
        projectId,
        clientTurnId,
      );
    });

  return write.immediate();
}

function assertStoryBibleSourceMessage(input: {
  ownerKey: string;
  projectId: string;
  sourceRole: StoryBibleSourceRole;
  sourceMessageId: string | null;
}) {
  if (!input.sourceMessageId) {
    return;
  }

  const row = db()
    .prepare(`
      SELECT role
      FROM story_messages
      WHERE id = ?
        AND project_id = ?
        AND owner_key = ?
      LIMIT 1
    `)
    .get(
      input.sourceMessageId,
      input.projectId,
      input.ownerKey,
    ) as { role?: string } | undefined;

  if (!row) {
    throw storyBibleError(
      "STORY_BIBLE_SOURCE_MESSAGE_NOT_FOUND",
      "Story Bible source message was not found in this Story.",
    );
  }

  if (
    input.sourceRole !== "system" &&
    String(row.role || "") !== input.sourceRole
  ) {
    throw storyBibleError(
      "STORY_BIBLE_SOURCE_ROLE_MISMATCH",
      "Story Bible source role does not match its source message.",
    );
  }
}

function assertOwnedStoryBibleEntity(input: {
  ownerKey: string;
  projectId: string;
  entityId: string;
}) {
  const row = db()
    .prepare(`
      SELECT *
      FROM story_entities
      WHERE id = ?
        AND project_id = ?
        AND owner_key = ?
      LIMIT 1
    `)
    .get(
      input.entityId,
      input.projectId,
      input.ownerKey,
    ) as any;

  if (!row) {
    throw storyBibleError(
      "STORY_BIBLE_ENTITY_NOT_FOUND",
      "Story Bible entity was not found in this Story.",
    );
  }

  return rowToStoryBibleEntity(row);
}

function assertOwnedStoryBibleFact(input: {
  ownerKey: string;
  projectId: string;
  factId: string;
}) {
  const row = db()
    .prepare(`
      SELECT *
      FROM story_facts
      WHERE id = ?
        AND project_id = ?
        AND owner_key = ?
      LIMIT 1
    `)
    .get(
      input.factId,
      input.projectId,
      input.ownerKey,
    ) as any;

  if (!row) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_NOT_FOUND",
      "Story Bible fact was not found in this Story.",
    );
  }

  return rowToStoryBibleFact(row);
}

export function listStoryBibleEntities(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const rows = db()
    .prepare(`
      SELECT
        rowid AS entity_rowid,
        *
      FROM story_entities
      WHERE project_id = ?
        AND owner_key = ?
      ORDER BY
        created_at ASC,
        entity_rowid ASC
    `)
    .all(
      projectId,
      ownerKey,
    );

  return rows.map(rowToStoryBibleEntity);
}

export function createStoryBibleEntity(input: {
  ownerKey: unknown;
  projectId: unknown;
  entityType: unknown;
  name: unknown;
  sourceRole: unknown;
  sourceMessageId?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const entityType =
    cleanStoryBibleEntityType(input.entityType);

  const name =
    cleanStoryBibleEntityName(input.name);

  const sourceRole =
    cleanStoryBibleSourceRole(input.sourceRole);

  const sourceMessageId =
    cleanOptionalStoryBibleId(
      input.sourceMessageId,
    );

  assertStoryBibleSourceMessage({
    ownerKey,
    projectId,
    sourceRole,
    sourceMessageId,
  });

  const now = Date.now();

  const entity: StoryBibleEntity = {
    id: randomUUID(),
    projectId,
    ownerKey,
    entityType,
    name,
    sourceRole,
    sourceMessageId,
    createdAt: now,
    updatedAt: now,
  };

  const write = db().transaction(() => {
    db()
      .prepare(`
        INSERT INTO story_entities (
          id,
          project_id,
          owner_key,
          entity_type,
          name,
          source_role,
          source_message_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entity.id,
        entity.projectId,
        entity.ownerKey,
        entity.entityType,
        entity.name,
        entity.sourceRole,
        entity.sourceMessageId,
        entity.createdAt,
        entity.updatedAt,
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

  return entity;
}

export function listStoryBibleFacts(input: {
  ownerKey: unknown;
  projectId: unknown;
  includeSuperseded?: boolean;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const sql = input.includeSuperseded
    ? `
      SELECT
        f.rowid AS fact_rowid,
        f.*
      FROM story_facts AS f
      WHERE f.project_id = ?
        AND f.owner_key = ?
      ORDER BY
        f.created_at ASC,
        fact_rowid ASC
    `
    : `
      SELECT
        f.rowid AS fact_rowid,
        f.*
      FROM story_facts AS f
      WHERE f.project_id = ?
        AND f.owner_key = ?
        AND NOT EXISTS (
          SELECT 1
          FROM story_facts AS newer
          WHERE newer.supersedes_fact_id = f.id
            AND newer.project_id = f.project_id
            AND newer.owner_key = f.owner_key
        )
      ORDER BY
        f.created_at ASC,
        fact_rowid ASC
    `;

  const rows = db()
    .prepare(sql)
    .all(
      projectId,
      ownerKey,
    );

  return rows.map(rowToStoryBibleFact);
}

export function addStoryBibleFact(input: {
  ownerKey: unknown;
  projectId: unknown;
  subjectEntityId?: unknown;
  predicate: unknown;
  valueText?: unknown;
  objectEntityId?: unknown;
  canonStatus: unknown;
  sourceRole: unknown;
  sourceMessageId?: unknown;
  supersedesFactId?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const subjectEntityId =
    cleanOptionalStoryBibleId(
      input.subjectEntityId,
    );

  const objectEntityId =
    cleanOptionalStoryBibleId(
      input.objectEntityId,
    );

  const supersedesFactId =
    cleanOptionalStoryBibleId(
      input.supersedesFactId,
    );

  const predicate =
    cleanStoryBiblePredicate(input.predicate);

  const valueText =
    cleanStoryBibleFactValue(
      input.valueText,
    );

  const canonStatus =
    cleanStoryBibleFactStatus(
      input.canonStatus,
    );

  const sourceRole =
    cleanStoryBibleSourceRole(
      input.sourceRole,
    );

  const sourceMessageId =
    cleanOptionalStoryBibleId(
      input.sourceMessageId,
    );

  if (
    sourceRole === "assistant" &&
    canonStatus === "canon"
  ) {
    throw storyBibleError(
      "STORY_BIBLE_ASSISTANT_CANON_FORBIDDEN",
      "Assistant-authored Story Bible facts cannot become canon without user adoption.",
    );
  }

  if (
    sourceRole === "system" &&
    canonStatus === "canon"
  ) {
    throw storyBibleError(
      "STORY_BIBLE_SYSTEM_CANON_FORBIDDEN",
      "System-authored Story Bible facts cannot become canon without explicit user adoption.",
    );
  }

  if (
    canonStatus !== "unknown" &&
    !valueText &&
    !objectEntityId
  ) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_VALUE_REQUIRED",
      "Canon and suggestion facts require a value or object entity.",
    );
  }

  if (subjectEntityId) {
    assertOwnedStoryBibleEntity({
      ownerKey,
      projectId,
      entityId: subjectEntityId,
    });
  }

  if (objectEntityId) {
    assertOwnedStoryBibleEntity({
      ownerKey,
      projectId,
      entityId: objectEntityId,
    });
  }

  assertStoryBibleSourceMessage({
    ownerKey,
    projectId,
    sourceRole,
    sourceMessageId,
  });

  if (supersedesFactId) {
    const previous =
      assertOwnedStoryBibleFact({
        ownerKey,
        projectId,
        factId: supersedesFactId,
      });

    const alreadySuperseded = db()
      .prepare(`
        SELECT id
        FROM story_facts
        WHERE supersedes_fact_id = ?
          AND project_id = ?
          AND owner_key = ?
        LIMIT 1
      `)
      .get(
        supersedesFactId,
        projectId,
        ownerKey,
      );

    if (alreadySuperseded) {
      throw storyBibleError(
        "STORY_BIBLE_FACT_ALREADY_SUPERSEDED",
        "Story Bible fact already has a newer revision.",
      );
    }

    if (
      previous.subjectEntityId !==
        subjectEntityId ||
      previous.predicate !== predicate
    ) {
      throw storyBibleError(
        "STORY_BIBLE_REVISION_SCOPE_MISMATCH",
        "A Story Bible revision must keep the same subject and predicate.",
      );
    }
  }

  const now = Date.now();

  const fact: StoryBibleFact = {
    id: randomUUID(),
    projectId,
    ownerKey,
    subjectEntityId,
    predicate,
    valueText,
    objectEntityId,
    canonStatus,
    sourceRole,
    sourceMessageId,
    supersedesFactId,
    createdAt: now,
    updatedAt: now,
  };

  const write = db().transaction(() => {
    db()
      .prepare(`
        INSERT INTO story_facts (
          id,
          project_id,
          owner_key,
          subject_entity_id,
          predicate,
          value_text,
          object_entity_id,
          canon_status,
          source_role,
          source_message_id,
          supersedes_fact_id,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        )
      `)
      .run(
        fact.id,
        fact.projectId,
        fact.ownerKey,
        fact.subjectEntityId,
        fact.predicate,
        fact.valueText,
        fact.objectEntityId,
        fact.canonStatus,
        fact.sourceRole,
        fact.sourceMessageId,
        fact.supersedesFactId,
        fact.createdAt,
        fact.updatedAt,
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

  return fact;
}


function assertStoryBibleProposalProvenance(input: {
  sourceRole: StoryBibleSourceRole;
  sourceMessageId: string | null;
}) {
  if (input.sourceRole === "user") {
    throw storyBibleError(
      "STORY_BIBLE_PROPOSAL_SOURCE_ROLE_FORBIDDEN",
      "Story Bible proposals must use assistant or system provenance.",
    );
  }

  if (
    input.sourceRole === "assistant" &&
    !input.sourceMessageId
  ) {
    throw storyBibleError(
      "STORY_BIBLE_PROPOSAL_SOURCE_MESSAGE_REQUIRED",
      "Assistant Story Bible proposals must reference their originating assistant message.",
    );
  }
}

/*
 * STORY_BIBLE_PROPOSAL_REPLAY_IDEMPOTENCY_V1
 *
 * Automatic extraction may be retried for the same persisted
 * assistant message. Replaying the same normalized proposal from
 * that exact source message must return the original row rather
 * than create another durable proposal.
 *
 * This intentionally does NOT merge proposals across different
 * source messages. Cross-message entity/fact resolution belongs
 * to the extraction layer, where ambiguity can be considered
 * explicitly instead of silently merging story data.
 */
export function proposeStoryBibleEntity(input: {
  ownerKey: unknown;
  projectId: unknown;
  entityType: unknown;
  name: unknown;
  sourceRole: unknown;
  sourceMessageId?: unknown;
}) {
  const sourceRole =
    cleanStoryBibleSourceRole(
      input.sourceRole,
    );

  const sourceMessageId =
    cleanOptionalStoryBibleId(
      input.sourceMessageId,
    );

  assertStoryBibleProposalProvenance({
    sourceRole,
    sourceMessageId,
  });

  const {
    ownerKey,
    projectId,
  } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const entityType =
    cleanStoryBibleEntityType(
      input.entityType,
    );

  const name =
    cleanStoryBibleEntityName(
      input.name,
    );

  /*
   * Validate the supplied assistant source even when a replay
   * would return an already-existing proposal. This prevents
   * idempotency from becoming a provenance-validation bypass.
   */
  assertStoryBibleSourceMessage({
    ownerKey,
    projectId,
    sourceRole,
    sourceMessageId,
  });

  if (sourceMessageId) {
    const existing = db()
      .prepare(`
        SELECT
          rowid AS entity_rowid,
          *
        FROM story_entities
        WHERE project_id = ?
          AND owner_key = ?
          AND source_role = ?
          AND source_message_id = ?
          AND entity_type = ? COLLATE NOCASE
          AND name = ? COLLATE NOCASE
        ORDER BY
          created_at ASC,
          entity_rowid ASC
        LIMIT 1
      `)
      .get(
        projectId,
        ownerKey,
        sourceRole,
        sourceMessageId,
        entityType,
        name,
      );

    if (existing) {
      return rowToStoryBibleEntity(
        existing,
      );
    }
  }

  return createStoryBibleEntity({
    ownerKey,
    projectId,
    entityType,
    name,
    sourceRole,
    sourceMessageId,
  });
}

export function proposeStoryBibleFact(input: {
  ownerKey: unknown;
  projectId: unknown;
  subjectEntityId?: unknown;
  predicate: unknown;
  valueText?: unknown;
  objectEntityId?: unknown;
  canonStatus: unknown;
  sourceRole: unknown;
  sourceMessageId?: unknown;
}) {
  const canonStatus =
    cleanStoryBibleFactStatus(
      input.canonStatus,
    );

  if (canonStatus === "canon") {
    throw storyBibleError(
      "STORY_BIBLE_PROPOSAL_CANON_FORBIDDEN",
      "Story Bible proposals may only be suggestions or unknowns.",
    );
  }

  const sourceRole =
    cleanStoryBibleSourceRole(
      input.sourceRole,
    );

  const sourceMessageId =
    cleanOptionalStoryBibleId(
      input.sourceMessageId,
    );

  assertStoryBibleProposalProvenance({
    sourceRole,
    sourceMessageId,
  });

  const {
    ownerKey,
    projectId,
  } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const subjectEntityId =
    cleanOptionalStoryBibleId(
      input.subjectEntityId,
    );

  const objectEntityId =
    cleanOptionalStoryBibleId(
      input.objectEntityId,
    );

  const predicate =
    cleanStoryBiblePredicate(
      input.predicate,
    );

  const valueText =
    cleanStoryBibleFactValue(
      input.valueText,
    );

  if (
    canonStatus !== "unknown" &&
    !valueText &&
    !objectEntityId
  ) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_VALUE_REQUIRED",
      "Canon and suggestion facts require a value or object entity.",
    );
  }

  if (subjectEntityId) {
    assertOwnedStoryBibleEntity({
      ownerKey,
      projectId,
      entityId:
        subjectEntityId,
    });
  }

  if (objectEntityId) {
    assertOwnedStoryBibleEntity({
      ownerKey,
      projectId,
      entityId:
        objectEntityId,
    });
  }

  /*
   * Validate provenance before any replay lookup. A caller cannot
   * use an existing proposal to bypass assistant-message matching.
   */
  assertStoryBibleSourceMessage({
    ownerKey,
    projectId,
    sourceRole,
    sourceMessageId,
  });

  if (sourceMessageId) {
    const existing = db()
      .prepare(`
        SELECT
          rowid AS fact_rowid,
          *
        FROM story_facts
        WHERE project_id = ?
          AND owner_key = ?
          AND source_role = ?
          AND source_message_id = ?
          AND canon_status = ?
          AND predicate = ? COLLATE NOCASE
          AND (
            (
              subject_entity_id IS NULL
              AND ? IS NULL
            )
            OR subject_entity_id = ?
          )
          AND (
            (
              object_entity_id IS NULL
              AND ? IS NULL
            )
            OR object_entity_id = ?
          )
          AND value_text = ?
          AND supersedes_fact_id IS NULL
        ORDER BY
          created_at ASC,
          fact_rowid ASC
        LIMIT 1
      `)
      .get(
        projectId,
        ownerKey,
        sourceRole,
        sourceMessageId,
        canonStatus,
        predicate,
        subjectEntityId,
        subjectEntityId,
        objectEntityId,
        objectEntityId,
        valueText,
      );

    if (existing) {
      return rowToStoryBibleFact(
        existing,
      );
    }
  }

  return addStoryBibleFact({
    ownerKey,
    projectId,
    subjectEntityId,
    predicate,
    valueText,
    objectEntityId,
    canonStatus,
    sourceRole,
    sourceMessageId,
  });
}

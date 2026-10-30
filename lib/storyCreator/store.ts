import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {privateMediaEnvironmentEnabled} from "@/lib/privateMediaRuntime";
import {
  QWEN21_IMAGE_EDIT_WORKFLOW_ID,
  QWEN21_STORY_CREATE_WORKFLOW_FILE,
  QWEN21_TURBO_CONTRACT,
} from "@/lib/imageGenerateWorkflows";
import {
  normalizeStoryProductionPlan,
  type StoryProductionPlan,
  type StoryProductionPlanRecord,
} from "./productionPlan";

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

export type StoryConflictStatus =
  | "open"
  | "resolved"
  | "dismissed";

export type StoryConflictResolutionAction =
  | "KEEP_CURRENT_CANON"
  | "USE_PROPOSED_VERSION"
  | "EDIT_PROPOSED_VERSION"
  | "DISMISS_CONFLICT";

export type StoryConflict = {
  id: string;
  projectId: string;
  ownerKey: string;
  factId: string;
  conflictsWithFactId: string;
  summary: string;
  status: StoryConflictStatus;
  sourceRole: StoryBibleSourceRole;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type StoryFactReviewDecision =
  | "approved"
  | "rejected";

export type StoryFactReview = {
  id: string;
  projectId: string;
  ownerKey: string;
  proposalFactId: string;
  decision: StoryFactReviewDecision;
  resultFactId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type StoryAssetType =
  | "character"
  | "location"
  | "object"
  | "reference"
  | "character_card"
  | "voice"
  | "video"
  | "production_package";

export type StoryAssetStatus =
  | "planned"
  | "generating"
  | "ready"
  | "failed";

export type StoryAsset = {
  id: string;
  projectId: string;
  ownerKey: string;
  assetType: StoryAssetType;
  name: string;
  prompt: string;
  status: StoryAssetStatus;
  provider: string;
  url: string | null;
  filePath: string | null;
  jobId: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type StoryVisualAssetKind =
  | "character"
  | "villain"
  | "creature"
  | "animal"
  | "location"
  | "environment"
  | "object"
  | "prop"
  | "vehicle"
  | "storyboard"
  | "scene_image"
  | "shot_reference";

export type StoryVisualVersionStatus =
  | "planned"
  | "generating"
  | "ready"
  | "failed"
  | "approved"
  | "rejected";

export type StoryVisualAssetVersion = {
  id: string;
  projectId: string;
  ownerKey: string;
  assetId: string;
  version: number;
  kind: StoryVisualAssetKind;
  status: StoryVisualVersionStatus;
  parentVersionId: string | null;
  prompt: string;
  provider: string;
  model: string;
  workflowId: string;
  url: string | null;
  filePath: string | null;
  jobId: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type StoryVisualAssetBinding = {
  id: string;
  projectId: string;
  ownerKey: string;
  assetId: string;
  versionId: string;
  bindingType: "project" | "entity" | "scene" | "shot";
  entityId: string | null;
  planVersion: number | null;
  sceneId: string | null;
  shotId: string | null;
  role: string;
  approved: boolean;
  createdAt: number;
  updatedAt: number;
};

export type StoryVisualAssetRecord = StoryAsset & {
  visualKind: StoryVisualAssetKind;
  versions: StoryVisualAssetVersion[];
  bindings: StoryVisualAssetBinding[];
};

export type StoryGenerationJobStatus =
  | "planned"
  | "submitted"
  | "running"
  | "complete"
  | "failed";

export type StoryGenerationJob = {
  id: string;
  projectId: string;
  ownerKey: string;
  assetId: string | null;
  jobType: string;
  provider: string;
  status: StoryGenerationJobStatus;
  promptId: string | null;
  externalJobId: string | null;
  endpoint: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  errorText: string;
  createdAt: number;
  updatedAt: number;
};

export type StoryAssetCompletionOutput = {
  url: unknown;
  filePath?: unknown;
  promptId?: unknown;
  outputNodeId?: unknown;
  filename?: unknown;
  subfolder?: unknown;
  type?: unknown;
  comfyBaseUrl?: unknown;
  backend?: unknown;
  seed?: unknown;
  width?: unknown;
  height?: unknown;
  provider?: unknown;
  model?: unknown;
  metadata?: unknown;
};

export type StoryAssetJobMutationResult = {
  asset: StoryAsset | null;
  job: StoryGenerationJob;
};

export type StoryExport = {
  id: string;
  projectId: string;
  ownerKey: string;
  exportType: string;
  status: "ready" | "failed";
  payload: Record<string, unknown>;
  filePath: string | null;
  createdAt: number;
  updatedAt: number;
};

export type StoryOpenQuestion = {
  id: string;
  projectId: string;
  ownerKey: string;
  question: string;
  status: "open" | "answered" | "dismissed";
  sourceRole: StoryBibleSourceRole;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type StoryExtractionEntityInput = {
  entityType?: unknown;
  name?: unknown;
};

export type StoryExtractionFactInput = {
  subjectName?: unknown;
  predicate?: unknown;
  valueText?: unknown;
  canonStatus?: unknown;
};

export type StoryExtractionOpenQuestionInput = {
  question?: unknown;
};

export type StoryExtractionApplyResult = {
  sourceMessageId: string;
  entitiesCreated: number;
  entitiesReused: number;
  factsCreated: number;
  factsReused: number;
  factsAutoSaved: number;
  questionsCreated: number;
  questionsReused: number;
  conflictsCreated: number;
  conflictsExisting: number;
  skipped: string[];
};

export type StoryMemoryReview = {
  id: string;
  projectId: string;
  ownerKey: string;
  throughMessageId: string;
  messageIds: string[];
  factsSaved: number;
  conflictsFound: number;
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

    CREATE TABLE IF NOT EXISTS story_conflicts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      conflicts_with_fact_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open', 'resolved', 'dismissed')),
      source_role TEXT NOT NULL DEFAULT 'system'
        CHECK(source_role IN ('user', 'assistant', 'system')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (fact_id)
        REFERENCES story_facts(id)
        ON DELETE CASCADE,
      FOREIGN KEY (conflicts_with_fact_id)
        REFERENCES story_facts(id)
        ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_story_conflicts_pair
      ON story_conflicts(
        project_id,
        owner_key,
        fact_id,
        conflicts_with_fact_id
      );

    CREATE INDEX IF NOT EXISTS idx_story_conflicts_project_status
      ON story_conflicts(
        project_id,
        owner_key,
        status,
        created_at ASC
      );

    CREATE TABLE IF NOT EXISTS story_fact_reviews (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      proposal_fact_id TEXT NOT NULL,
      decision TEXT NOT NULL
        CHECK(decision IN ('approved', 'rejected')),
      result_fact_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (proposal_fact_id)
        REFERENCES story_facts(id)
        ON DELETE CASCADE,
      FOREIGN KEY (result_fact_id)
        REFERENCES story_facts(id)
        ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_story_fact_reviews_proposal
      ON story_fact_reviews(
        project_id,
        owner_key,
        proposal_fact_id
      );

    CREATE INDEX IF NOT EXISTS idx_story_fact_reviews_project_decision
      ON story_fact_reviews(
        project_id,
        owner_key,
        decision,
        created_at ASC
      );

    CREATE TABLE IF NOT EXISTS story_memory_reviews (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      through_message_id TEXT NOT NULL,
      message_ids_json TEXT NOT NULL DEFAULT '[]',
      facts_saved INTEGER NOT NULL DEFAULT 0,
      conflicts_found INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (through_message_id)
        REFERENCES story_messages(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_story_memory_reviews_project_created
      ON story_memory_reviews(
        project_id,
        owner_key,
        created_at DESC
      );

    CREATE TABLE IF NOT EXISTS story_fact_tombstones (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      subject_entity_id TEXT,
      predicate TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      source_fact_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (subject_entity_id)
        REFERENCES story_entities(id)
        ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_story_fact_tombstone_scope
      ON story_fact_tombstones(
        project_id,
        owner_key,
        COALESCE(subject_entity_id, ''),
        predicate,
        normalized_value
      );

    CREATE TABLE IF NOT EXISTS story_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      asset_type TEXT NOT NULL
        CHECK(asset_type IN (
          'character',
          'location',
          'object',
          'reference',
          'character_card',
          'voice',
          'video',
          'production_package'
        )),
      name TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK(status IN ('planned', 'generating', 'ready', 'failed')),
      provider TEXT NOT NULL DEFAULT '',
      url TEXT,
      file_path TEXT,
      job_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_story_assets_project_updated
      ON story_assets(
        project_id,
        owner_key,
        updated_at DESC
      );

    CREATE TABLE IF NOT EXISTS story_character_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      asset_id TEXT,
      profile_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES story_assets(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS story_location_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      asset_id TEXT,
      profile_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES story_assets(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS story_voice_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      asset_id TEXT,
      profile_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES story_assets(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS story_generation_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      asset_id TEXT,
      job_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK(status IN ('planned', 'submitted', 'running', 'complete', 'failed')),
      prompt_id TEXT,
      external_job_id TEXT,
      endpoint TEXT NOT NULL DEFAULT '',
      request_json TEXT NOT NULL DEFAULT '{}',
      response_json TEXT NOT NULL DEFAULT '{}',
      error_text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES story_assets(id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_story_generation_jobs_project_updated
      ON story_generation_jobs(
        project_id,
        owner_key,
        updated_at DESC
      );

    CREATE TABLE IF NOT EXISTS story_open_questions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      question TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open', 'answered', 'dismissed')),
      source_role TEXT NOT NULL DEFAULT 'system'
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

    CREATE TABLE IF NOT EXISTS story_timeline_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      source_role TEXT NOT NULL DEFAULT 'system'
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

    CREATE TABLE IF NOT EXISTS story_memory_chunks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      chunk_type TEXT NOT NULL DEFAULT 'note',
      content TEXT NOT NULL,
      source_role TEXT NOT NULL DEFAULT 'system'
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

    CREATE TABLE IF NOT EXISTS story_embeddings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      memory_chunk_id TEXT,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      embedding_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (memory_chunk_id)
        REFERENCES story_memory_chunks(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS story_production_plans (
      project_id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'approved')),
      plan_json TEXT NOT NULL DEFAULT '{}',
      approved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_story_production_plans_owner_updated
      ON story_production_plans(owner_key, updated_at DESC);

    CREATE TABLE IF NOT EXISTS story_production_plan_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL
        CHECK(status IN ('draft', 'approved')),
      plan_json TEXT NOT NULL,
      source_role TEXT NOT NULL DEFAULT 'user'
        CHECK(source_role IN ('user', 'assistant', 'system')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      UNIQUE(project_id, owner_key, version)
    );

    CREATE INDEX IF NOT EXISTS idx_story_production_plan_versions
      ON story_production_plan_versions(
        project_id,
        owner_key,
        version DESC
      );

    CREATE TABLE IF NOT EXISTS story_exports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      export_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready'
        CHECK(status IN ('ready', 'failed')),
      payload_json TEXT NOT NULL DEFAULT '{}',
      file_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_story_exports_project_updated
      ON story_exports(
        project_id,
        owner_key,
        updated_at DESC
      );
  `);

  migrateStoryCreatorSchema(database);

  dbInstance = database;
  return database;
}

function migrateStoryCreatorSchema(database: Database.Database) {
  const conflictTable = database
    .prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name = 'story_conflicts'
      LIMIT 1
    `)
    .get() as { sql?: string } | undefined;

  const conflictSql = String(conflictTable?.sql || "");
  const conflictColumns = database
    .prepare("PRAGMA table_info(story_conflicts)")
    .all() as { name?: string }[];
  const hasResolvedAt = conflictColumns.some(
    (column) => column.name === "resolved_at",
  );
  const hasDismissedStatus =
    conflictSql.includes("'dismissed'");

  if (!hasDismissedStatus) {
    database.exec(`
      PRAGMA foreign_keys = OFF;

      DROP TABLE IF EXISTS story_conflicts_next;

      CREATE TABLE story_conflicts_next (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        conflicts_with_fact_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open', 'resolved', 'dismissed')),
        source_role TEXT NOT NULL DEFAULT 'system'
          CHECK(source_role IN ('user', 'assistant', 'system')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resolved_at INTEGER,
        FOREIGN KEY (project_id)
          REFERENCES story_projects(id)
          ON DELETE CASCADE,
        FOREIGN KEY (fact_id)
          REFERENCES story_facts(id)
          ON DELETE CASCADE,
        FOREIGN KEY (conflicts_with_fact_id)
          REFERENCES story_facts(id)
          ON DELETE CASCADE
      );

      INSERT INTO story_conflicts_next (
        id,
        project_id,
        owner_key,
        fact_id,
        conflicts_with_fact_id,
        summary,
        status,
        source_role,
        created_at,
        updated_at,
        resolved_at
      )
      SELECT
        id,
        project_id,
        owner_key,
        fact_id,
        conflicts_with_fact_id,
        summary,
        status,
        source_role,
        created_at,
        updated_at,
        ${hasResolvedAt ? "resolved_at" : "NULL"}
      FROM story_conflicts;

      DROP TABLE story_conflicts;
      ALTER TABLE story_conflicts_next RENAME TO story_conflicts;
      PRAGMA foreign_keys = ON;
    `);
  } else if (!hasResolvedAt) {
    database.exec(`
      ALTER TABLE story_conflicts
      ADD COLUMN resolved_at INTEGER;
    `);
  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_story_conflicts_pair
      ON story_conflicts(
        project_id,
        owner_key,
        fact_id,
        conflicts_with_fact_id
      );

    CREATE INDEX IF NOT EXISTS idx_story_conflicts_project_status
      ON story_conflicts(
        project_id,
        owner_key,
        status,
        created_at ASC
      );

    CREATE TABLE IF NOT EXISTS story_visual_asset_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      visual_kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK(status IN (
          'planned', 'generating', 'ready',
          'failed', 'approved', 'rejected'
        )),
      parent_version_id TEXT,
      prompt TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      url TEXT,
      file_path TEXT,
      job_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES story_assets(id)
        ON DELETE CASCADE,
      FOREIGN KEY (parent_version_id)
        REFERENCES story_visual_asset_versions(id)
        ON DELETE SET NULL,
      UNIQUE(project_id, owner_key, asset_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_story_visual_versions_asset
      ON story_visual_asset_versions(
        project_id, owner_key, asset_id, version DESC
      );

    CREATE TABLE IF NOT EXISTS story_visual_asset_bindings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      binding_type TEXT NOT NULL
        CHECK(binding_type IN ('project', 'entity', 'scene', 'shot')),
      entity_id TEXT,
      plan_version INTEGER,
      scene_id TEXT,
      shot_id TEXT,
      role TEXT NOT NULL DEFAULT 'reference',
      approved INTEGER NOT NULL DEFAULT 0
        CHECK(approved IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES story_projects(id)
        ON DELETE CASCADE,
      FOREIGN KEY (asset_id)
        REFERENCES story_assets(id)
        ON DELETE CASCADE,
      FOREIGN KEY (version_id)
        REFERENCES story_visual_asset_versions(id)
        ON DELETE CASCADE,
      FOREIGN KEY (entity_id)
        REFERENCES story_entities(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_story_visual_bindings_target
      ON story_visual_asset_bindings(
        project_id, owner_key, binding_type,
        entity_id, plan_version, scene_id, shot_id
      );

    INSERT OR IGNORE INTO story_visual_asset_versions (
      id, project_id, owner_key, asset_id, version, visual_kind, status,
      parent_version_id, prompt, provider, model, workflow_id, url, file_path,
      job_id, metadata_json, created_at, updated_at
    )
    SELECT
      'legacy-' || id,
      project_id,
      owner_key,
      id,
      1,
      CASE
        WHEN asset_type = 'character' OR asset_type = 'character_card' THEN 'character'
        WHEN asset_type = 'location' THEN 'location'
        WHEN asset_type = 'object' THEN 'object'
        ELSE 'scene_image'
      END,
      CASE
        WHEN status = 'ready' THEN 'ready'
        WHEN status = 'generating' THEN 'generating'
        WHEN status = 'failed' THEN 'failed'
        ELSE 'planned'
      END,
      NULL,
      prompt,
      provider,
      CASE WHEN provider LIKE 'qwen%' THEN provider ELSE '' END,
      COALESCE(json_extract(metadata_json, '$.workflow'), ''),
      url,
      file_path,
      job_id,
      json_set(metadata_json, '$.migratedFromLegacyAsset', 1),
      created_at,
      updated_at
    FROM story_assets
    WHERE asset_type NOT IN ('voice', 'video', 'production_package');
  `);

  const factColumns = database
    .prepare("PRAGMA table_info(story_facts)")
    .all() as Array<{ name?: unknown }>;
  if (!factColumns.some((column) => String(column.name) === "deleted_at")) {
    database.exec("ALTER TABLE story_facts ADD COLUMN deleted_at INTEGER");
  }
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

function cleanRequiredProjectTitle(value: unknown) {
  const raw = String(value || "").trim();

  if (!raw) {
    const error = new Error(
      "A Story title is required before creating a project.",
    ) as Error & { code?: string };

    error.code = "STORY_PROJECT_TITLE_REQUIRED";
    throw error;
  }

  return cleanTitle(raw);
}

function storyProjectConflictError(message: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = "STORY_PROJECT_TITLE_CONFLICT";
  return error;
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

function cleanStoryConflictStatus(
  value: unknown,
): StoryConflictStatus {
  if (
    value === "open" ||
    value === "resolved" ||
    value === "dismissed"
  ) {
    return value;
  }

  throw new Error(
    "Story conflict status must be open, resolved, or dismissed.",
  );
}

function cleanStoryConflictResolutionAction(
  value: unknown,
): StoryConflictResolutionAction {
  if (
    value === "KEEP_CURRENT_CANON" ||
    value === "USE_PROPOSED_VERSION" ||
    value === "EDIT_PROPOSED_VERSION" ||
    value === "DISMISS_CONFLICT"
  ) {
    return value;
  }

  throw storyBibleError(
    "STORY_CONFLICT_ACTION_INVALID",
    "Story conflict resolution action is not supported.",
  );
}

function cleanStoryFactReviewDecision(
  value: unknown,
): StoryFactReviewDecision {
  if (value === "approved" || value === "rejected") {
    return value;
  }

  throw new Error(
    "Story fact review decision must be approved or rejected.",
  );
}

function cleanStoryAssetType(value: unknown): StoryAssetType {
  if (
    value === "character" ||
    value === "location" ||
    value === "object" ||
    value === "reference" ||
    value === "character_card" ||
    value === "voice" ||
    value === "video" ||
    value === "production_package"
  ) {
    return value;
  }

  throw new Error("Story asset type is not supported.");
}

function cleanStoryAssetStatus(
  value: unknown,
): StoryAssetStatus {
  if (
    value === "planned" ||
    value === "generating" ||
    value === "ready" ||
    value === "failed"
  ) {
    return value;
  }

  throw new Error("Story asset status is not supported.");
}

function cleanStoryVisualAssetKind(
  value: unknown,
): StoryVisualAssetKind {
  const kinds: StoryVisualAssetKind[] = [
    "character",
    "villain",
    "creature",
    "animal",
    "location",
    "environment",
    "object",
    "prop",
    "vehicle",
    "storyboard",
    "scene_image",
    "shot_reference",
  ];
  if (kinds.includes(value as StoryVisualAssetKind)) {
    return value as StoryVisualAssetKind;
  }
  throw new Error("Story visual asset kind is not supported.");
}

function cleanStoryVisualVersionStatus(
  value: unknown,
): StoryVisualVersionStatus {
  const statuses: StoryVisualVersionStatus[] = [
    "planned",
    "generating",
    "ready",
    "failed",
    "approved",
    "rejected",
  ];
  if (statuses.includes(value as StoryVisualVersionStatus)) {
    return value as StoryVisualVersionStatus;
  }
  throw new Error("Story visual version status is not supported.");
}

function cleanStoryGenerationJobStatus(
  value: unknown,
): StoryGenerationJobStatus {
  if (
    value === "planned" ||
    value === "submitted" ||
    value === "running" ||
    value === "complete" ||
    value === "failed"
  ) {
    return value;
  }

  throw new Error("Story generation job status is not supported.");
}

function cleanStoryExportStatus(value: unknown) {
  if (value === "ready" || value === "failed") {
    return value;
  }

  throw new Error("Story export status is not supported.");
}

function cleanStoryOpenQuestionStatus(value: unknown) {
  if (
    value === "open" ||
    value === "answered" ||
    value === "dismissed"
  ) {
    return value;
  }

  throw new Error(
    "Story open question status is not supported.",
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

function cleanStoryLongText(value: unknown, max = 100_000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function cleanStoryJson(value: unknown, max = 500_000) {
  if (value === undefined || value === null || value === "") {
    return "{}";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "{}";
    JSON.parse(trimmed);
    return trimmed.slice(0, max);
  }

  return JSON.stringify(value).slice(0, max);
}

function parseStoryJson(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function cleanOptionalStoryBibleId(value: unknown) {
  const id = String(value || "").trim();
  return id ? id.slice(0, 240) : null;
}

function normalizeStoryExtractionKey(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function rowToStoryConflict(
  row: any,
): StoryConflict {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    factId: String(row.fact_id),
    conflictsWithFactId: String(
      row.conflicts_with_fact_id,
    ),
    summary: String(row.summary || ""),
    status: cleanStoryConflictStatus(row.status),
    sourceRole: cleanStoryBibleSourceRole(
      row.source_role,
    ),
    resolvedAt: row.resolved_at
      ? Number(row.resolved_at)
      : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStoryFactReview(
  row: any,
): StoryFactReview {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    proposalFactId: String(row.proposal_fact_id),
    decision: cleanStoryFactReviewDecision(
      row.decision,
    ),
    resultFactId: row.result_fact_id
      ? String(row.result_fact_id)
      : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStoryAsset(row: any): StoryAsset {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    assetType: cleanStoryAssetType(row.asset_type),
    name: String(row.name || ""),
    prompt: String(row.prompt || ""),
    status: cleanStoryAssetStatus(row.status),
    provider: String(row.provider || ""),
    url: row.url ? String(row.url) : null,
    filePath: row.file_path ? String(row.file_path) : null,
    jobId: row.job_id ? String(row.job_id) : null,
    metadata: parseStoryJson(row.metadata_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStoryVisualVersion(
  row: any,
): StoryVisualAssetVersion {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    assetId: String(row.asset_id),
    version: Number(row.version),
    kind: cleanStoryVisualAssetKind(row.visual_kind),
    status: cleanStoryVisualVersionStatus(row.status),
    parentVersionId: row.parent_version_id
      ? String(row.parent_version_id)
      : null,
    prompt: String(row.prompt || ""),
    provider: String(row.provider || ""),
    model: String(row.model || ""),
    workflowId: String(row.workflow_id || ""),
    url: row.url ? String(row.url) : null,
    filePath: row.file_path ? String(row.file_path) : null,
    jobId: row.job_id ? String(row.job_id) : null,
    metadata: parseStoryJson(row.metadata_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStoryVisualBinding(
  row: any,
): StoryVisualAssetBinding {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    assetId: String(row.asset_id),
    versionId: String(row.version_id),
    bindingType: row.binding_type,
    entityId: row.entity_id ? String(row.entity_id) : null,
    planVersion: row.plan_version === null
      ? null
      : Number(row.plan_version),
    sceneId: row.scene_id ? String(row.scene_id) : null,
    shotId: row.shot_id ? String(row.shot_id) : null,
    role: String(row.role || "reference"),
    approved: Boolean(row.approved),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStoryGenerationJob(row: any): StoryGenerationJob {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    assetId: row.asset_id ? String(row.asset_id) : null,
    jobType: String(row.job_type || ""),
    provider: String(row.provider || ""),
    status: cleanStoryGenerationJobStatus(row.status),
    promptId: row.prompt_id ? String(row.prompt_id) : null,
    externalJobId: row.external_job_id
      ? String(row.external_job_id)
      : null,
    endpoint: String(row.endpoint || ""),
    request: parseStoryJson(row.request_json),
    response: parseStoryJson(row.response_json),
    errorText: String(row.error_text || ""),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStoryExport(row: any): StoryExport {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    exportType: String(row.export_type || ""),
    status: cleanStoryExportStatus(row.status),
    payload: parseStoryJson(row.payload_json),
    filePath: row.file_path ? String(row.file_path) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStoryOpenQuestion(row: any): StoryOpenQuestion {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    question: String(row.question || ""),
    status: cleanStoryOpenQuestionStatus(row.status),
    sourceRole: cleanStoryBibleSourceRole(row.source_role),
    sourceMessageId: row.source_message_id
      ? String(row.source_message_id)
      : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToStoryProductionPlanRecord(
  row: any,
): StoryProductionPlanRecord {
  const projectId = String(row.project_id);
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(String(row.plan_json || "{}"));
  } catch {
    parsed = {};
  }

  return {
    projectId,
    ownerKey: String(row.owner_key),
    version: Number(row.version || 1),
    status: row.status === "approved" ? "approved" : "draft",
    plan: normalizeStoryProductionPlan(parsed, projectId),
    approvedAt: row.approved_at == null
      ? null
      : Number(row.approved_at),
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
  const title = cleanRequiredProjectTitle(input.title);

  const titleExists = db()
    .prepare(`
      SELECT title
      FROM story_projects
      WHERE owner_key = ?
        AND status = 'active'
    `)
    .all(ownerKey)
    .some(
      (row: any) =>
        normalizeStoryExtractionKey(String(row.title || "")) ===
        normalizeStoryExtractionKey(title),
    );

  if (titleExists) {
    throw storyProjectConflictError(
      "A Story with that title already exists. Choose a different title or continue the existing Story.",
    );
  }

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
    title,
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
      : cleanRequiredProjectTitle(input.title);

  if (
    input.title !== undefined &&
    db()
      .prepare(`
        SELECT title
        FROM story_projects
        WHERE owner_key = ?
          AND status = 'active'
          AND id <> ?
      `)
      .all(ownerKey, id)
      .some(
        (row: any) =>
          normalizeStoryExtractionKey(String(row.title || "")) ===
          normalizeStoryExtractionKey(nextTitle),
      )
  ) {
    throw storyProjectConflictError(
      "A Story with that title already exists. Choose a different title.",
    );
  }

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

function assertOwnedStoryCreatorMessage(input: {
  ownerKey: string;
  projectId: string;
  messageId: string;
}) {
  const row = db()
    .prepare(`
      SELECT
        id,
        project_id,
        owner_key,
        role,
        content,
        created_at
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
    throw storyBibleError(
      "STORY_MESSAGE_NOT_FOUND",
      "Story Director source message was not found in this Story.",
    );
  }

  return rowToMessage(row);
}

export function getStoryCreatorMessage(input: {
  ownerKey: unknown;
  projectId: unknown;
  messageId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );

  const messageId = cleanOptionalStoryBibleId(
    input.messageId,
  );

  if (!messageId) {
    throw storyBibleError(
      "STORY_EXTRACT_SOURCE_MESSAGE_REQUIRED",
      "Story extraction requires a stored source message.",
    );
  }

  return assertOwnedStoryCreatorMessage({
    ownerKey,
    projectId,
    messageId,
  });
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

function insertStoryBibleEntityRow(
  entity: StoryBibleEntity,
) {
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
}

function insertStoryOpenQuestionRow(
  item: StoryOpenQuestion,
) {
  db()
    .prepare(`
      INSERT INTO story_open_questions (
        id,
        project_id,
        owner_key,
        question,
        status,
        source_role,
        source_message_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      item.id,
      item.projectId,
      item.ownerKey,
      item.question,
      item.status,
      item.sourceRole,
      item.sourceMessageId,
      item.createdAt,
      item.updatedAt,
    );
}

function assertOwnedStoryConflict(input: {
  ownerKey: string;
  projectId: string;
  conflictId: string;
}) {
  const row = db()
    .prepare(`
      SELECT *
      FROM story_conflicts
      WHERE id = ?
        AND project_id = ?
        AND owner_key = ?
      LIMIT 1
    `)
    .get(
      input.conflictId,
      input.projectId,
      input.ownerKey,
    ) as any;

  if (!row) {
    throw storyBibleError(
      "STORY_CONFLICT_NOT_FOUND",
      "Story conflict was not found in this Story.",
    );
  }

  return rowToStoryConflict(row);
}

function isStoryBibleFactSuperseded(input: {
  ownerKey: string;
  projectId: string;
  factId: string;
}) {
  const row = db()
    .prepare(`
      SELECT id
      FROM story_facts
      WHERE supersedes_fact_id = ?
        AND project_id = ?
        AND owner_key = ?
        AND deleted_at IS NULL
      LIMIT 1
    `)
    .get(
      input.factId,
      input.projectId,
      input.ownerKey,
    );

  return Boolean(row);
}

function listActiveStoryCanonFactsForScope(input: {
  ownerKey: string;
  projectId: string;
  subjectEntityId: string | null;
  predicate: string;
}) {
  const rows = db()
    .prepare(`
      SELECT
        f.rowid AS fact_rowid,
        f.*
      FROM story_facts AS f
      WHERE f.project_id = ?
        AND f.owner_key = ?
        AND f.deleted_at IS NULL
        AND f.canon_status = 'canon'
        AND f.deleted_at IS NULL
        AND (
          (? IS NULL AND f.subject_entity_id IS NULL)
          OR f.subject_entity_id = ?
        )
        AND f.predicate = ?
        AND NOT EXISTS (
          SELECT 1
          FROM story_facts AS newer
          WHERE newer.supersedes_fact_id = f.id
            AND newer.project_id = f.project_id
            AND newer.owner_key = f.owner_key
        )
        AND NOT EXISTS (
          SELECT 1
          FROM story_fact_reviews AS review
          WHERE review.proposal_fact_id = f.id
            AND review.project_id = f.project_id
            AND review.owner_key = f.owner_key
        )
      ORDER BY
        f.created_at ASC,
        fact_rowid ASC
    `)
    .all(
      input.projectId,
      input.ownerKey,
      input.subjectEntityId,
      input.subjectEntityId,
      input.predicate,
    );

  return rows.map(rowToStoryBibleFact);
}

function insertStoryBibleFactRow(fact: StoryBibleFact) {
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
}

function insertStoryFactReviewRow(
  review: StoryFactReview,
) {
  db()
    .prepare(`
      INSERT INTO story_fact_reviews (
        id,
        project_id,
        owner_key,
        proposal_fact_id,
        decision,
        result_fact_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      review.id,
      review.projectId,
      review.ownerKey,
      review.proposalFactId,
      review.decision,
      review.resultFactId,
      review.createdAt,
      review.updatedAt,
    );
}

function touchStoryProject(input: {
  ownerKey: string;
  projectId: string;
  now: number;
}) {
  db()
    .prepare(`
      UPDATE story_projects
      SET updated_at = ?
      WHERE id = ?
        AND owner_key = ?
        AND status = 'active'
    `)
    .run(
      input.now,
      input.projectId,
      input.ownerKey,
    );
}

function storyFactAlreadyReviewedError() {
  return storyBibleError(
    "STORY_BIBLE_FACT_ALREADY_REVIEWED",
    "Story Bible suggestion has already been reviewed.",
  );
}

function withStoryFactReviewWrite<T>(
  write: () => T,
) {
  try {
    return write();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error || "");

    if (
      message.includes("story_fact_reviews") ||
      message.includes("idx_story_fact_reviews_proposal")
    ) {
      throw storyFactAlreadyReviewedError();
    }

    throw error;
  }
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
        AND f.deleted_at IS NULL
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
        AND f.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM story_facts AS newer
          WHERE newer.supersedes_fact_id = f.id
            AND newer.project_id = f.project_id
            AND newer.owner_key = f.owner_key
        )
        AND NOT EXISTS (
          SELECT 1
          FROM story_fact_reviews AS review
          WHERE review.proposal_fact_id = f.id
            AND review.project_id = f.project_id
            AND review.owner_key = f.owner_key
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

export function listPendingStoryBibleFacts(input: {
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
        f.rowid AS fact_rowid,
        f.*
      FROM story_facts AS f
      WHERE f.project_id = ?
        AND f.owner_key = ?
        AND f.canon_status = 'suggestion'
        AND f.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM story_facts AS newer
          WHERE newer.supersedes_fact_id = f.id
            AND newer.project_id = f.project_id
            AND newer.owner_key = f.owner_key
        )
        AND NOT EXISTS (
          SELECT 1
          FROM story_fact_reviews AS review
          WHERE review.proposal_fact_id = f.id
            AND review.project_id = f.project_id
            AND review.owner_key = f.owner_key
        )
      ORDER BY
        f.created_at ASC,
        fact_rowid ASC
    `)
    .all(projectId, ownerKey);

  return rows.map(rowToStoryBibleFact);
}

export function getStoryFactReview(input: {
  ownerKey: unknown;
  projectId: unknown;
  proposalFactId: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const proposalFactId =
    cleanOptionalStoryBibleId(
      input.proposalFactId,
    );

  if (!proposalFactId) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_ID_REQUIRED",
      "Story Bible fact id is required.",
    );
  }

  const row = db()
    .prepare(`
      SELECT *
      FROM story_fact_reviews
      WHERE project_id = ?
        AND owner_key = ?
        AND proposal_fact_id = ?
      LIMIT 1
    `)
    .get(
      projectId,
      ownerKey,
      proposalFactId,
    ) as any;

  return row ? rowToStoryFactReview(row) : null;
}

export function listStoryFactReviews(input: {
  ownerKey: unknown;
  projectId: unknown;
  decision?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const decision = input.decision
    ? cleanStoryFactReviewDecision(input.decision)
    : "";

  const rows = db()
    .prepare(`
      SELECT
        rowid AS review_rowid,
        *
      FROM story_fact_reviews
      WHERE project_id = ?
        AND owner_key = ?
        AND (? = '' OR decision = ?)
      ORDER BY
        created_at ASC,
        review_rowid ASC
    `)
    .all(
      projectId,
      ownerKey,
      decision,
      decision,
    );

  return rows.map(rowToStoryFactReview);
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

function insertStoryFactTombstone(input: {
  fact: StoryBibleFact;
  now: number;
}) {
  db().prepare(`
    INSERT OR IGNORE INTO story_fact_tombstones (
      id, project_id, owner_key, subject_entity_id, predicate,
      normalized_value, source_fact_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.fact.projectId,
    input.fact.ownerKey,
    input.fact.subjectEntityId,
    input.fact.predicate,
    normalizeFactComparisonValue(input.fact),
    input.fact.id,
    input.now,
  );
}

export function reviseStoryCanonFact(input: {
  ownerKey: unknown;
  projectId: unknown;
  factId: unknown;
  valueText: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  const factId = cleanOptionalStoryBibleId(input.factId);
  if (!factId) throw storyBibleError("STORY_BIBLE_FACT_ID_REQUIRED", "Canon entry is required.");
  const current = assertOwnedStoryBibleFact({ ownerKey, projectId, factId });
  if (current.canonStatus !== "canon") {
    throw storyBibleError("STORY_BIBLE_CANON_REQUIRED", "Only canon entries can be edited here.");
  }
  const valueText = cleanStoryBibleFactValue(input.valueText);
  if (!valueText) {
    throw storyBibleError("STORY_BIBLE_FACT_VALUE_REQUIRED", "Canon text cannot be empty.");
  }
  const now = Date.now();
  const revised = db().transaction(() => {
    insertStoryFactTombstone({ fact: current, now });
    return addStoryBibleFact({
      ownerKey,
      projectId,
      subjectEntityId: current.subjectEntityId,
      predicate: current.predicate,
      valueText,
      objectEntityId: current.objectEntityId,
      canonStatus: "canon",
      sourceRole: "user",
      supersedesFactId: current.id,
    });
  })();
  return revised;
}

export function deleteStoryCanonFact(input: {
  ownerKey: unknown;
  projectId: unknown;
  factId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  const factId = cleanOptionalStoryBibleId(input.factId);
  if (!factId) throw storyBibleError("STORY_BIBLE_FACT_ID_REQUIRED", "Canon entry is required.");
  const fact = assertOwnedStoryBibleFact({ ownerKey, projectId, factId });
  if (fact.canonStatus !== "canon") {
    throw storyBibleError("STORY_BIBLE_CANON_REQUIRED", "Only canon entries can be deleted here.");
  }
  const now = Date.now();
  db().transaction(() => {
    insertStoryFactTombstone({ fact, now });
    db().prepare(`
      UPDATE story_facts
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_key = ? AND deleted_at IS NULL
    `).run(now, now, fact.id, projectId, ownerKey);
    db().prepare(`
      UPDATE story_conflicts
      SET status = 'dismissed', resolved_at = ?, updated_at = ?
      WHERE project_id = ? AND owner_key = ? AND status = 'open'
        AND (fact_id = ? OR conflicts_with_fact_id = ?)
    `).run(now, now, projectId, ownerKey, fact.id, fact.id);
    touchStoryProject({ ownerKey, projectId, now });
  })();
  return { id: fact.id, deletedAt: now };
}

function cleanStoryExtractionFactStatus(
  value: unknown,
): StoryBibleFactStatus {
  return value === "unknown" ? "unknown" : "suggestion";
}

function isCurrentStoryBibleFact(input: {
  ownerKey: string;
  projectId: string;
  factId: string;
}) {
  const row = db()
    .prepare(`
      SELECT id
      FROM story_facts AS f
      WHERE f.id = ?
        AND f.project_id = ?
        AND f.owner_key = ?
        AND f.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM story_facts AS newer
          WHERE newer.supersedes_fact_id = f.id
            AND newer.project_id = f.project_id
            AND newer.owner_key = f.owner_key
        )
        AND NOT EXISTS (
          SELECT 1
          FROM story_fact_reviews AS review
          WHERE review.proposal_fact_id = f.id
            AND review.project_id = f.project_id
            AND review.owner_key = f.owner_key
        )
      LIMIT 1
    `)
    .get(
      input.factId,
      input.projectId,
      input.ownerKey,
    );

  return Boolean(row);
}

function insertDeterministicStoryConflictsForFacts(input: {
  ownerKey: string;
  projectId: string;
  proposals: StoryBibleFact[];
  now: number;
}) {
  let conflictsCreated = 0;
  let conflictsExisting = 0;
  const seenPairs = new Set<string>();

  const entityRows = db()
    .prepare(`
      SELECT id, name
      FROM story_entities
      WHERE project_id = ?
        AND owner_key = ?
    `)
    .all(
      input.projectId,
      input.ownerKey,
    ) as { id: string; name: string }[];

  const entityNames = new Map(
    entityRows.map((entity) => [
      String(entity.id),
      String(entity.name || ""),
    ]),
  );

  const activeCanonStatement = db()
    .prepare(`
      SELECT
        f.rowid AS fact_rowid,
        f.*
      FROM story_facts AS f
      WHERE f.project_id = ?
        AND f.owner_key = ?
        AND f.canon_status = 'canon'
        AND f.deleted_at IS NULL
        AND (
          (? IS NULL AND f.subject_entity_id IS NULL)
          OR f.subject_entity_id = ?
        )
        AND f.predicate = ?
        AND NOT EXISTS (
          SELECT 1
          FROM story_facts AS newer
          WHERE newer.supersedes_fact_id = f.id
            AND newer.project_id = f.project_id
            AND newer.owner_key = f.owner_key
        )
        AND NOT EXISTS (
          SELECT 1
          FROM story_fact_reviews AS review
          WHERE review.proposal_fact_id = f.id
            AND review.project_id = f.project_id
            AND review.owner_key = f.owner_key
        )
      ORDER BY
        f.created_at ASC,
        fact_rowid ASC
    `);

  const insertConflictStatement = db()
    .prepare(`
      INSERT OR IGNORE INTO story_conflicts (
        id,
        project_id,
        owner_key,
        fact_id,
        conflicts_with_fact_id,
        summary,
        status,
        source_role,
        created_at,
        updated_at,
        resolved_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'open', 'system', ?, ?, NULL)
    `);

  for (const proposal of input.proposals) {
    if (proposal.canonStatus !== "suggestion") continue;

    if (
      !isCurrentStoryBibleFact({
        ownerKey: input.ownerKey,
        projectId: input.projectId,
        factId: proposal.id,
      })
    ) {
      continue;
    }

    const canonFacts =
      activeCanonStatement
        .all(
          input.projectId,
          input.ownerKey,
          proposal.subjectEntityId,
          proposal.subjectEntityId,
          proposal.predicate,
        )
        .map(rowToStoryBibleFact);

    for (const canon of canonFacts) {
      if (!factsDisagree(proposal, canon)) continue;

      const pairKey = [
        proposal.id,
        canon.id,
      ].join("\u0001");

      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const result = insertConflictStatement.run(
        randomUUID(),
        input.projectId,
        input.ownerKey,
        proposal.id,
        canon.id,
        conflictSummary({
          candidate: proposal,
          canon,
          entityNames,
        }),
        input.now,
        input.now,
      );

      if (result.changes) {
        conflictsCreated += 1;
      } else {
        conflictsExisting += 1;
      }
    }
  }

  return {
    conflictsCreated,
    conflictsExisting,
  };
}

export function applyStoryExtraction(input: {
  ownerKey: unknown;
  projectId: unknown;
  sourceMessageId: unknown;
  entities?: StoryExtractionEntityInput[];
  facts?: StoryExtractionFactInput[];
  openQuestions?: StoryExtractionOpenQuestionInput[];
  autoCanonizeNonconflicting?: boolean;
  debugFailurePoint?: unknown;
}): StoryExtractionApplyResult {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const sourceMessageId =
    cleanOptionalStoryBibleId(
      input.sourceMessageId,
    );

  if (!sourceMessageId) {
    throw storyBibleError(
      "STORY_EXTRACT_SOURCE_MESSAGE_REQUIRED",
      "Story extraction requires a stored source message.",
    );
  }

  assertOwnedStoryCreatorMessage({
    ownerKey,
    projectId,
    messageId: sourceMessageId,
  });

  const debugFailurePoint = String(
    input.debugFailurePoint || "",
  );

  const now = Date.now();

  const write = db().transaction(() => {
    const result: StoryExtractionApplyResult = {
      sourceMessageId,
      entitiesCreated: 0,
      entitiesReused: 0,
      factsCreated: 0,
      factsReused: 0,
      factsAutoSaved: 0,
      questionsCreated: 0,
      questionsReused: 0,
      conflictsCreated: 0,
      conflictsExisting: 0,
      skipped: [],
    };

    const entityRows = db()
      .prepare(`
        SELECT *
        FROM story_entities
        WHERE project_id = ?
          AND owner_key = ?
        ORDER BY created_at ASC, rowid ASC
      `)
      .all(projectId, ownerKey)
      .map(rowToStoryBibleEntity);

    const entityByName = new Map(
      entityRows.map((entity) => [
        normalizeStoryExtractionKey(entity.name),
        entity,
      ]),
    );

    for (const candidate of Array.isArray(input.entities)
      ? input.entities.slice(0, 30)
      : []) {
      const name =
        cleanStoryBibleEntityName(candidate.name);
      const entityType =
        cleanStoryBibleEntityType(
          candidate.entityType || "other",
        );
      const key = normalizeStoryExtractionKey(name);
      const existing = entityByName.get(key);

      if (existing) {
        result.entitiesReused += 1;
        continue;
      }

      const entity: StoryBibleEntity = {
        id: randomUUID(),
        projectId,
        ownerKey,
        entityType,
        name,
        sourceRole: "assistant",
        sourceMessageId,
        createdAt: now,
        updatedAt: now,
      };

      insertStoryBibleEntityRow(entity);
      entityByName.set(key, entity);
      result.entitiesCreated += 1;

      if (debugFailurePoint === "afterEntityWrite") {
        throw storyBibleError(
          "STORY_EXTRACT_DEBUG_FAILURE",
          "Forced Story extraction failure after entity write.",
        );
      }
    }

    const factRows = db()
      .prepare(`
        SELECT *
        FROM story_facts
        WHERE project_id = ?
          AND owner_key = ?
        ORDER BY created_at ASC, rowid ASC
      `)
      .all(projectId, ownerKey)
      .map(rowToStoryBibleFact);

    const factByKey = new Map(
      factRows.map((fact) => [
        [
          fact.subjectEntityId || "",
          fact.predicate,
          fact.valueText,
          fact.objectEntityId || "",
          fact.canonStatus,
        ].join("\u0001"),
        fact,
      ]),
    );

    const affectedProposals: StoryBibleFact[] = [];

    for (const candidate of Array.isArray(input.facts)
      ? input.facts.slice(0, 60)
      : []) {
      const subjectName = String(
        candidate.subjectName || "",
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 160);
      const predicate =
        cleanStoryBiblePredicate(candidate.predicate);
      const valueText =
        cleanStoryBibleFactValue(
          candidate.valueText,
        );
      let canonStatus =
        cleanStoryExtractionFactStatus(
          candidate.canonStatus,
        );
      const subject =
        subjectName
          ? entityByName.get(
              normalizeStoryExtractionKey(subjectName),
            )
          : undefined;

      if (subjectName && !subject) {
        result.skipped.push(
          `fact subject not found: ${subjectName}`,
        );
        continue;
      }

      if (
        canonStatus === "suggestion" &&
        !valueText
      ) {
        result.skipped.push(
          `suggestion missing value: ${predicate}`,
        );
        continue;
      }

      if (
        input.autoCanonizeNonconflicting &&
        canonStatus === "suggestion"
      ) {
        const normalizedValue = normalizeFactComparisonValue({
          valueText,
          objectEntityId: null,
        });
        const deletedMatch = db()
          .prepare(`
            SELECT id
            FROM story_fact_tombstones
            WHERE project_id = ?
              AND owner_key = ?
              AND (
                (? IS NULL AND subject_entity_id IS NULL)
                OR subject_entity_id = ?
              )
              AND predicate = ?
              AND normalized_value = ?
            LIMIT 1
          `)
          .get(
            projectId,
            ownerKey,
            subject?.id || null,
            subject?.id || null,
            predicate,
            normalizedValue,
          );
        if (deletedMatch) {
          result.skipped.push(
            `previously deleted detail: ${predicate}`,
          );
          continue;
        }

        const activeCanon = listActiveStoryCanonFactsForScope({
          ownerKey,
          projectId,
          subjectEntityId: subject?.id || null,
          predicate,
        });
        if (
          activeCanon.some(
            (fact) =>
              normalizeFactComparisonValue(fact) === normalizedValue,
          )
        ) {
          result.factsReused += 1;
          continue;
        }
        if (!activeCanon.length) {
          canonStatus = "canon";
        }
      }

      const key = [
        subject?.id || "",
        predicate,
        valueText,
        "",
        canonStatus,
      ].join("\u0001");
      const existing = factByKey.get(key);

      if (existing) {
        result.factsReused += 1;
        if (existing.canonStatus === "suggestion") {
          affectedProposals.push(existing);
        }
        continue;
      }

      const fact: StoryBibleFact = {
        id: randomUUID(),
        projectId,
        ownerKey,
        subjectEntityId: subject?.id || null,
        predicate,
        valueText,
        objectEntityId: null,
        canonStatus,
        sourceRole:
          canonStatus === "canon" ? "user" : "assistant",
        sourceMessageId,
        supersedesFactId: null,
        createdAt: now,
        updatedAt: now,
      };

      insertStoryBibleFactRow(fact);
      factByKey.set(key, fact);
      result.factsCreated += 1;

      if (fact.canonStatus === "canon") {
        result.factsAutoSaved += 1;
      }

      if (fact.canonStatus === "suggestion") {
        affectedProposals.push(fact);
      }
    }

    const questionRows = db()
      .prepare(`
        SELECT *
        FROM story_open_questions
        WHERE project_id = ?
          AND owner_key = ?
        ORDER BY created_at ASC, rowid ASC
      `)
      .all(projectId, ownerKey)
      .map(rowToStoryOpenQuestion);

    const questionByKey = new Map(
      questionRows.map((question) => [
        normalizeStoryExtractionKey(question.question),
        question,
      ]),
    );

    for (const candidate of Array.isArray(
      input.openQuestions,
    )
      ? input.openQuestions.slice(0, 30)
      : []) {
      const question = cleanStoryLongText(
        candidate.question,
        2000,
      );

      if (!question) continue;

      const key = normalizeStoryExtractionKey(question);

      if (questionByKey.has(key)) {
        result.questionsReused += 1;
        continue;
      }

      const item: StoryOpenQuestion = {
        id: randomUUID(),
        projectId,
        ownerKey,
        question,
        status: "open",
        sourceRole: "assistant",
        sourceMessageId,
        createdAt: now,
        updatedAt: now,
      };

      insertStoryOpenQuestionRow(item);
      questionByKey.set(key, item);
      result.questionsCreated += 1;
    }

    if (debugFailurePoint === "afterFactCreation") {
      throw storyBibleError(
        "STORY_EXTRACT_DEBUG_FAILURE",
        "Forced Story extraction failure after fact creation.",
      );
    }

    const conflictResult =
      insertDeterministicStoryConflictsForFacts({
        ownerKey,
        projectId,
        proposals: affectedProposals,
        now,
      });

    result.conflictsCreated =
      conflictResult.conflictsCreated;
    result.conflictsExisting =
      conflictResult.conflictsExisting;

    if (
      result.entitiesCreated ||
      result.factsCreated ||
      result.questionsCreated ||
      result.conflictsCreated
    ) {
      touchStoryProject({
        ownerKey,
        projectId,
        now,
      });
    }

    return result;
  });

  return write();
}

function rowToStoryMemoryReview(row: any): StoryMemoryReview {
  let messageIds: string[] = [];
  try {
    const parsed = JSON.parse(String(row.message_ids_json || "[]"));
    if (Array.isArray(parsed)) {
      messageIds = parsed.map((value) => String(value || "").trim()).filter(Boolean);
    }
  } catch {
    messageIds = [];
  }
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerKey: String(row.owner_key),
    throughMessageId: String(row.through_message_id),
    messageIds,
    factsSaved: Number(row.facts_saved || 0),
    conflictsFound: Number(row.conflicts_found || 0),
    createdAt: Number(row.created_at || 0),
  };
}

export function listStoryMemoryReviews(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  return db()
    .prepare(`
      SELECT *
      FROM story_memory_reviews
      WHERE project_id = ? AND owner_key = ?
      ORDER BY created_at ASC, rowid ASC
    `)
    .all(projectId, ownerKey)
    .map(rowToStoryMemoryReview);
}

export function listUnreviewedStoryMessages(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const messages = listStoryCreatorMessages(input).filter(
    (message) => message.role === "user",
  );
  const reviewed = new Set(
    listStoryMemoryReviews(input).flatMap((review) => review.messageIds),
  );
  return messages.filter((message) => !reviewed.has(message.id));
}

export function recordStoryMemoryReview(input: {
  ownerKey: unknown;
  projectId: unknown;
  throughMessageId: unknown;
  messageIds: unknown;
  factsSaved?: unknown;
  conflictsFound?: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  const throughMessageId = cleanOptionalStoryBibleId(input.throughMessageId);
  if (!throughMessageId) {
    throw storyBibleError(
      "STORY_MEMORY_REVIEW_MESSAGE_REQUIRED",
      "Story review requires a final reviewed message.",
    );
  }
  assertOwnedStoryCreatorMessage({ ownerKey, projectId, messageId: throughMessageId });
  const messageIds = Array.isArray(input.messageIds)
    ? [...new Set(input.messageIds.map(cleanOptionalStoryBibleId).filter(Boolean) as string[])]
    : [];
  for (const messageId of messageIds) {
    assertOwnedStoryCreatorMessage({ ownerKey, projectId, messageId });
  }
  const review: StoryMemoryReview = {
    id: randomUUID(),
    projectId,
    ownerKey,
    throughMessageId,
    messageIds,
    factsSaved: Math.max(0, Math.floor(Number(input.factsSaved || 0) || 0)),
    conflictsFound: Math.max(0, Math.floor(Number(input.conflictsFound || 0) || 0)),
    createdAt: Date.now(),
  };
  db().prepare(`
    INSERT INTO story_memory_reviews (
      id, project_id, owner_key, through_message_id, message_ids_json,
      facts_saved, conflicts_found, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    review.id,
    projectId,
    ownerKey,
    review.throughMessageId,
    JSON.stringify(review.messageIds),
    review.factsSaved,
    review.conflictsFound,
    review.createdAt,
  );
  return review;
}


export function approveStoryBibleFact(input: {
  ownerKey: unknown;
  projectId: unknown;
  factId: unknown;
  valueText?: unknown;
  objectEntityId?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const factId = cleanOptionalStoryBibleId(
    input.factId,
  );

  if (!factId) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_ID_REQUIRED",
      "Story Bible fact id is required.",
    );
  }

  const candidate =
    assertOwnedStoryBibleFact({
      ownerKey,
      projectId,
      factId,
    });

  if (candidate.canonStatus === "canon") {
    throw storyBibleError(
      "STORY_BIBLE_FACT_ALREADY_CANON",
      "Story Bible fact is already canon.",
    );
  }

  if (candidate.canonStatus !== "suggestion") {
    throw storyBibleError(
      "STORY_BIBLE_APPROVAL_STATUS_INVALID",
      "Only Story Bible suggestions can be approved as canon.",
    );
  }

  if (
    isStoryBibleFactSuperseded({
      ownerKey,
      projectId,
      factId: candidate.id,
    })
  ) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_ALREADY_SUPERSEDED",
      "Story Bible fact already has a newer revision.",
    );
  }

  const valueText =
    input.valueText === undefined
      ? candidate.valueText
      : cleanStoryBibleFactValue(
          input.valueText,
        );

  const objectEntityId =
    input.objectEntityId === undefined
      ? candidate.objectEntityId
      : cleanOptionalStoryBibleId(
          input.objectEntityId,
        );

  if (objectEntityId) {
    assertOwnedStoryBibleEntity({
      ownerKey,
      projectId,
      entityId: objectEntityId,
    });
  }

  if (!valueText && !objectEntityId) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_VALUE_REQUIRED",
      "Approved canon requires a value or object entity.",
    );
  }

  const proposal: StoryBibleFact = {
    ...candidate,
    valueText,
    objectEntityId,
  };

  const activeCanonFacts =
    listActiveStoryCanonFactsForScope({
      ownerKey,
      projectId,
      subjectEntityId: candidate.subjectEntityId,
      predicate: candidate.predicate,
    });

  const conflictingCanon = activeCanonFacts.find(
    (canon) => factsDisagree(proposal, canon),
  );

  if (conflictingCanon) {
    throw storyBibleError(
      "STORY_CANON_CONFLICT_REQUIRES_RESOLUTION",
      "This suggestion conflicts with current canon and must be resolved in Conflict Review.",
    );
  }

  const matchingCanon = activeCanonFacts.find(
    (canon) => !factsDisagree(proposal, canon),
  );

  const now = Date.now();
  const resultFact: StoryBibleFact =
    matchingCanon || {
      id: randomUUID(),
      projectId,
      ownerKey,
      subjectEntityId: candidate.subjectEntityId,
      predicate: candidate.predicate,
      valueText,
      objectEntityId,
      canonStatus: "canon",
      sourceRole: "user",
      sourceMessageId: null,
      supersedesFactId: null,
      createdAt: now,
      updatedAt: now,
    };

  const review: StoryFactReview = {
    id: randomUUID(),
    projectId,
    ownerKey,
    proposalFactId: candidate.id,
    decision: "approved",
    resultFactId: resultFact.id,
    createdAt: now,
    updatedAt: now,
  };

  const write = db().transaction(() => {
    if (!matchingCanon) {
      insertStoryBibleFactRow(resultFact);
    }

    insertStoryFactReviewRow(review);

    touchStoryProject({
      ownerKey,
      projectId,
      now,
    });
  });

  withStoryFactReviewWrite(write);

  return resultFact;
}

export function rejectStoryBibleFact(input: {
  ownerKey: unknown;
  projectId: unknown;
  factId: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const factId = cleanOptionalStoryBibleId(
    input.factId,
  );

  if (!factId) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_ID_REQUIRED",
      "Story Bible fact id is required.",
    );
  }

  const candidate =
    assertOwnedStoryBibleFact({
      ownerKey,
      projectId,
      factId,
    });

  if (candidate.canonStatus === "canon") {
    throw storyBibleError(
      "STORY_BIBLE_FACT_ALREADY_CANON",
      "Story Bible fact is already canon.",
    );
  }

  if (candidate.canonStatus !== "suggestion") {
    throw storyBibleError(
      "STORY_BIBLE_REJECTION_STATUS_INVALID",
      "Only Story Bible suggestions can be rejected.",
    );
  }

  if (
    isStoryBibleFactSuperseded({
      ownerKey,
      projectId,
      factId: candidate.id,
    })
  ) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_ALREADY_SUPERSEDED",
      "Story Bible fact already has a newer revision.",
    );
  }

  const now = Date.now();
  const review: StoryFactReview = {
    id: randomUUID(),
    projectId,
    ownerKey,
    proposalFactId: candidate.id,
    decision: "rejected",
    resultFactId: null,
    createdAt: now,
    updatedAt: now,
  };

  const write = db().transaction(() => {
    insertStoryFactReviewRow(review);

    touchStoryProject({
      ownerKey,
      projectId,
      now,
    });
  });

  withStoryFactReviewWrite(write);

  return review;
}


function factDisplayValue(
  fact: StoryBibleFact,
  entityNames: Map<string, string>,
) {
  if (fact.objectEntityId) {
    return (
      entityNames.get(fact.objectEntityId) ||
      "Unknown entity"
    );
  }

  return fact.valueText || "(unknown)";
}

function factConflictKey(fact: StoryBibleFact) {
  return [
    fact.subjectEntityId || "",
    fact.predicate,
  ].join("\u0001");
}

function normalizeFactComparisonValue(input: {
  valueText?: unknown;
  objectEntityId?: unknown;
}) {
  const objectEntityId = String(input.objectEntityId || "").trim();
  if (objectEntityId) return `entity:${objectEntityId}`;
  return String(input.valueText || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9'\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function factsDisagree(
  left: StoryBibleFact,
  right: StoryBibleFact,
) {
  return normalizeFactComparisonValue(left) !==
    normalizeFactComparisonValue(right);
}

function conflictSummary(input: {
  candidate: StoryBibleFact;
  canon: StoryBibleFact;
  entityNames: Map<string, string>;
}) {
  const subject = input.candidate.subjectEntityId
    ? input.entityNames.get(
        input.candidate.subjectEntityId,
      ) || "Unknown entity"
    : "Story";

  return [
    subject,
    input.candidate.predicate,
    "is suggested as",
    factDisplayValue(
      input.candidate,
      input.entityNames,
    ),
    "but approved canon says",
    factDisplayValue(
      input.canon,
      input.entityNames,
    ),
  ].join(" ");
}

export function listStoryConflicts(input: {
  ownerKey: unknown;
  projectId: unknown;
  status?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const status = input.status
    ? cleanStoryConflictStatus(input.status)
    : "";

  const rows = db()
    .prepare(`
      SELECT
        rowid AS conflict_rowid,
        *
      FROM story_conflicts
      WHERE project_id = ?
        AND owner_key = ?
        AND (? = '' OR status = ?)
      ORDER BY
        created_at ASC,
        conflict_rowid ASC
    `)
    .all(
      projectId,
      ownerKey,
      status,
      status,
    );

  return rows.map(rowToStoryConflict);
}

export function resolveStoryConflict(input: {
  ownerKey: unknown;
  projectId: unknown;
  conflictId: unknown;
  action: unknown;
  valueText?: unknown;
  objectEntityId?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const conflictId =
    cleanOptionalStoryBibleId(
      input.conflictId,
    );

  if (!conflictId) {
    throw storyBibleError(
      "STORY_CONFLICT_ID_REQUIRED",
      "Story conflict id is required.",
    );
  }

  const action =
    cleanStoryConflictResolutionAction(
      input.action,
    );

  const conflict =
    assertOwnedStoryConflict({
      ownerKey,
      projectId,
      conflictId,
    });

  if (conflict.status !== "open") {
    throw storyBibleError(
      "STORY_CONFLICT_NOT_OPEN",
      "Story conflict has already been resolved or dismissed.",
    );
  }

  const now = Date.now();

  if (action === "DISMISS_CONFLICT") {
    const write = db().transaction(() => {
      db()
        .prepare(`
          UPDATE story_conflicts
          SET status = 'dismissed',
              resolved_at = ?,
              updated_at = ?
          WHERE id = ?
            AND project_id = ?
            AND owner_key = ?
        `)
        .run(
          now,
          now,
          conflict.id,
          projectId,
          ownerKey,
        );

      touchStoryProject({
        ownerKey,
        projectId,
        now,
      });
    });

    write();

    return {
      conflict: {
        ...conflict,
        status: "dismissed" as StoryConflictStatus,
        resolvedAt: now,
        updatedAt: now,
      },
      review: null,
      fact: null,
    };
  }

  const proposal =
    assertOwnedStoryBibleFact({
      ownerKey,
      projectId,
      factId: conflict.factId,
    });

  const currentCanon =
    assertOwnedStoryBibleFact({
      ownerKey,
      projectId,
      factId: conflict.conflictsWithFactId,
    });

  if (proposal.canonStatus !== "suggestion") {
    throw storyBibleError(
      "STORY_CONFLICT_PROPOSAL_INVALID",
      "Story conflict proposal is no longer a pending suggestion.",
    );
  }

  if (currentCanon.canonStatus !== "canon") {
    throw storyBibleError(
      "STORY_CONFLICT_CANON_INVALID",
      "Story conflict current fact is no longer canon.",
    );
  }

  if (
    isStoryBibleFactSuperseded({
      ownerKey,
      projectId,
      factId: proposal.id,
    })
  ) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_ALREADY_SUPERSEDED",
      "Story Bible fact already has a newer revision.",
    );
  }

  if (
    isStoryBibleFactSuperseded({
      ownerKey,
      projectId,
      factId: currentCanon.id,
    })
  ) {
    throw storyBibleError(
      "STORY_CONFLICT_STALE",
      "Story conflict current canon has already been revised.",
    );
  }

  if (action === "KEEP_CURRENT_CANON") {
    const review: StoryFactReview = {
      id: randomUUID(),
      projectId,
      ownerKey,
      proposalFactId: proposal.id,
      decision: "rejected",
      resultFactId: null,
      createdAt: now,
      updatedAt: now,
    };

    const write = db().transaction(() => {
      insertStoryFactReviewRow(review);

      db()
        .prepare(`
          UPDATE story_conflicts
          SET status = 'resolved',
              resolved_at = ?,
              updated_at = ?
          WHERE id = ?
            AND project_id = ?
            AND owner_key = ?
        `)
        .run(
          now,
          now,
          conflict.id,
          projectId,
          ownerKey,
        );

      touchStoryProject({
        ownerKey,
        projectId,
        now,
      });
    });

    withStoryFactReviewWrite(write);

    return {
      conflict: {
        ...conflict,
        status: "resolved" as StoryConflictStatus,
        resolvedAt: now,
        updatedAt: now,
      },
      review,
      fact: currentCanon,
    };
  }

  const valueText =
    action === "EDIT_PROPOSED_VERSION"
      ? cleanStoryBibleFactValue(
          input.valueText,
        )
      : proposal.valueText;

  const objectEntityId =
    action === "EDIT_PROPOSED_VERSION"
      ? cleanOptionalStoryBibleId(
          input.objectEntityId,
        )
      : proposal.objectEntityId;

  if (objectEntityId) {
    assertOwnedStoryBibleEntity({
      ownerKey,
      projectId,
      entityId: objectEntityId,
    });
  }

  if (!valueText && !objectEntityId) {
    throw storyBibleError(
      "STORY_BIBLE_FACT_VALUE_REQUIRED",
      "Conflict resolution requires a proposed value or object entity.",
    );
  }

  const resolvedProposal: StoryBibleFact = {
    ...proposal,
    valueText,
    objectEntityId,
  };

  const shouldCreateCanon =
    factsDisagree(resolvedProposal, currentCanon);

  const resultFact: StoryBibleFact =
    shouldCreateCanon
      ? {
          id: randomUUID(),
          projectId,
          ownerKey,
          subjectEntityId: proposal.subjectEntityId,
          predicate: proposal.predicate,
          valueText,
          objectEntityId,
          canonStatus: "canon",
          sourceRole: "user",
          sourceMessageId: null,
          supersedesFactId: currentCanon.id,
          createdAt: now,
          updatedAt: now,
        }
      : currentCanon;

  const review: StoryFactReview = {
    id: randomUUID(),
    projectId,
    ownerKey,
    proposalFactId: proposal.id,
    decision: "approved",
    resultFactId: resultFact.id,
    createdAt: now,
    updatedAt: now,
  };

  const write = db().transaction(() => {
    if (shouldCreateCanon) {
      insertStoryBibleFactRow(resultFact);
    }

    insertStoryFactReviewRow(review);

    db()
      .prepare(`
        UPDATE story_conflicts
        SET status = 'resolved',
            resolved_at = ?,
            updated_at = ?
        WHERE id = ?
          AND project_id = ?
          AND owner_key = ?
      `)
      .run(
        now,
        now,
        conflict.id,
        projectId,
        ownerKey,
      );

    touchStoryProject({
      ownerKey,
      projectId,
      now,
    });
  });

  withStoryFactReviewWrite(write);

  return {
    conflict: {
      ...conflict,
      status: "resolved" as StoryConflictStatus,
      resolvedAt: now,
      updatedAt: now,
    },
    review,
    fact: resultFact,
  };
}

export function findStoryBibleConflicts(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const facts =
    listStoryBibleFacts({
      ownerKey,
      projectId,
    });

  const entities =
    listStoryBibleEntities({
      ownerKey,
      projectId,
    });

  const entityNames = new Map(
    entities.map((entity) => [
      entity.id,
      entity.name,
    ]),
  );

  const canonByKey = new Map<
    string,
    StoryBibleFact[]
  >();

  for (const fact of facts) {
    if (fact.canonStatus !== "canon") continue;

    const key = factConflictKey(fact);
    const list = canonByKey.get(key) || [];
    list.push(fact);
    canonByKey.set(key, list);
  }

  const candidates: {
    candidate: StoryBibleFact;
    canon: StoryBibleFact;
    summary: string;
  }[] = [];

  for (const fact of facts) {
    if (fact.canonStatus !== "suggestion") continue;

    const canonFacts =
      canonByKey.get(factConflictKey(fact)) || [];

    for (const canon of canonFacts) {
      if (!factsDisagree(fact, canon)) continue;

      candidates.push({
        candidate: fact,
        canon,
        summary: conflictSummary({
          candidate: fact,
          canon,
          entityNames,
        }),
      });
    }
  }

  const now = Date.now();

  const write = db().transaction(() => {
    for (const item of candidates) {
      db()
        .prepare(`
          INSERT OR IGNORE INTO story_conflicts (
            id,
            project_id,
            owner_key,
            fact_id,
            conflicts_with_fact_id,
            summary,
            status,
            source_role,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'open', 'system', ?, ?)
        `)
        .run(
          randomUUID(),
          projectId,
          ownerKey,
          item.candidate.id,
          item.canon.id,
          item.summary,
          now,
          now,
        );
    }

    if (candidates.length) {
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
    }
  });

  write();

  return listStoryConflicts({
    ownerKey,
    projectId,
    status: "open",
  });
}


function storyRecord(value: unknown): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assertOwnedStoryAsset(input: {
  ownerKey: string;
  projectId: string;
  assetId: string;
}) {
  const row = db()
    .prepare(`
      SELECT *
      FROM story_assets
      WHERE id = ?
        AND project_id = ?
        AND owner_key = ?
      LIMIT 1
    `)
    .get(
      input.assetId,
      input.projectId,
      input.ownerKey,
    ) as any;

  if (!row) {
    throw storyBibleError(
      "STORY_ASSET_NOT_FOUND",
      "Story asset was not found in this Story.",
    );
  }

  return rowToStoryAsset(row);
}

function assertOwnedStoryGenerationJob(input: {
  ownerKey: string;
  projectId: string;
  jobId: string;
}) {
  const row = db()
    .prepare(`
      SELECT *
      FROM story_generation_jobs
      WHERE id = ?
        AND project_id = ?
        AND owner_key = ?
      LIMIT 1
    `)
    .get(
      input.jobId,
      input.projectId,
      input.ownerKey,
    ) as any;

  if (!row) {
    throw storyBibleError(
      "STORY_GENERATION_JOB_NOT_FOUND",
      "Story generation job was not found in this Story.",
    );
  }

  return rowToStoryGenerationJob(row);
}

function assertStoryAssetJobMatch(
  job: StoryGenerationJob,
  assetId: string,
) {
  if (job.assetId !== assetId) {
    throw storyBibleError(
      "STORY_ASSET_JOB_MISMATCH",
      "Story generation job does not belong to this Story asset.",
    );
  }
}

function mergedStoryJson(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  return cleanStoryJson({
    ...base,
    ...patch,
  });
}

function finiteNumberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getStoryAsset(input: {
  ownerKey: unknown;
  projectId: unknown;
  assetId: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const assetId = cleanOptionalStoryBibleId(input.assetId);
  if (!assetId) {
    throw storyBibleError(
      "STORY_ASSET_ID_REQUIRED",
      "Story asset id is required.",
    );
  }

  return assertOwnedStoryAsset({
    ownerKey,
    projectId,
    assetId,
  });
}

export function getStoryGenerationJob(input: {
  ownerKey: unknown;
  projectId: unknown;
  jobId: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const jobId = cleanOptionalStoryBibleId(input.jobId);
  if (!jobId) {
    throw storyBibleError(
      "STORY_GENERATION_JOB_ID_REQUIRED",
      "Story generation job id is required.",
    );
  }

  return assertOwnedStoryGenerationJob({
    ownerKey,
    projectId,
    jobId,
  });
}

export function findStoryGenerationJobForStoryAsset(input: {
  ownerKey: unknown;
  projectId: unknown;
  assetId: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const assetId = cleanOptionalStoryBibleId(input.assetId);
  if (!assetId) {
    throw storyBibleError(
      "STORY_ASSET_ID_REQUIRED",
      "Story asset id is required.",
    );
  }

  assertOwnedStoryAsset({
    ownerKey,
    projectId,
    assetId,
  });

  const row = db()
    .prepare(`
      SELECT
        rowid AS job_rowid,
        *
      FROM story_generation_jobs
      WHERE project_id = ?
        AND owner_key = ?
        AND asset_id = ?
      ORDER BY
        updated_at DESC,
        job_rowid DESC
      LIMIT 1
    `)
    .get(projectId, ownerKey, assetId) as any;

  if (!row) {
    throw storyBibleError(
      "STORY_GENERATION_JOB_NOT_FOUND",
      "Story generation job was not found for this Story asset.",
    );
  }

  return rowToStoryGenerationJob(row);
}

export function listStoryAssets(input: {
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
        rowid AS asset_rowid,
        *
      FROM story_assets
      WHERE project_id = ?
        AND owner_key = ?
      ORDER BY
        updated_at DESC,
        asset_rowid DESC
    `)
    .all(projectId, ownerKey);

  return rows.map(rowToStoryAsset);
}

export function addStoryAsset(input: {
  ownerKey: unknown;
  projectId: unknown;
  assetType: unknown;
  name: unknown;
  prompt?: unknown;
  status?: unknown;
  provider?: unknown;
  url?: unknown;
  filePath?: unknown;
  jobId?: unknown;
  metadata?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const assetType = cleanStoryAssetType(input.assetType);
  const name = cleanTitle(input.name);
  const prompt = cleanStoryLongText(input.prompt, 40_000);
  const status = input.status
    ? cleanStoryAssetStatus(input.status)
    : "planned";
  const provider = cleanShort(input.provider);
  const url = cleanOptionalStoryBibleId(input.url);
  const filePath = cleanOptionalStoryBibleId(input.filePath);
  const jobId = cleanOptionalStoryBibleId(input.jobId);
  const metadataJson = cleanStoryJson(input.metadata);
  const now = Date.now();

  const asset: StoryAsset = {
    id: randomUUID(),
    projectId,
    ownerKey,
    assetType,
    name,
    prompt,
    status,
    provider,
    url,
    filePath,
    jobId,
    metadata: parseStoryJson(metadataJson),
    createdAt: now,
    updatedAt: now,
  };

  const write = db().transaction(() => {
    db()
      .prepare(`
        INSERT INTO story_assets (
          id,
          project_id,
          owner_key,
          asset_type,
          name,
          prompt,
          status,
          provider,
          url,
          file_path,
          job_id,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        asset.id,
        projectId,
        ownerKey,
        assetType,
        name,
        prompt,
        status,
        provider,
        url,
        filePath,
        jobId,
        metadataJson,
        now,
        now,
      );

    if (assetType === "character") {
      db()
        .prepare(`
          INSERT INTO story_character_profiles (
            id,
            project_id,
            owner_key,
            asset_id,
            profile_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          projectId,
          ownerKey,
          asset.id,
          metadataJson,
          now,
          now,
        );
    } else if (assetType === "location") {
      db()
        .prepare(`
          INSERT INTO story_location_profiles (
            id,
            project_id,
            owner_key,
            asset_id,
            profile_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          projectId,
          ownerKey,
          asset.id,
          metadataJson,
          now,
          now,
        );
    } else if (assetType === "voice") {
      db()
        .prepare(`
          INSERT INTO story_voice_profiles (
            id,
            project_id,
            owner_key,
            asset_id,
            profile_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          projectId,
          ownerKey,
          asset.id,
          metadataJson,
          now,
          now,
        );
    }

    db()
      .prepare(`
        UPDATE story_projects
        SET updated_at = ?
        WHERE id = ?
          AND owner_key = ?
          AND status = 'active'
      `)
      .run(now, projectId, ownerKey);
  });

  write();

  return asset;
}

function baseAssetTypeForVisualKind(
  kind: StoryVisualAssetKind,
): StoryAssetType {
  if (
    kind === "character" ||
    kind === "villain" ||
    kind === "creature" ||
    kind === "animal"
  ) {
    return "character";
  }
  if (kind === "location" || kind === "environment") {
    return "location";
  }
  if (kind === "object" || kind === "prop" || kind === "vehicle") {
    return "object";
  }
  return "reference";
}

function assertOwnedStoryVisualVersion(input: {
  ownerKey: string;
  projectId: string;
  versionId: string;
}) {
  const row = db()
    .prepare(`
      SELECT *
      FROM story_visual_asset_versions
      WHERE id = ?
        AND project_id = ?
        AND owner_key = ?
      LIMIT 1
    `)
    .get(input.versionId, input.projectId, input.ownerKey) as any;
  if (!row) {
    throw storyBibleError(
      "STORY_VISUAL_VERSION_NOT_FOUND",
      "Story visual asset version was not found in this Story.",
    );
  }
  return rowToStoryVisualVersion(row);
}

export function getStoryVisualVersion(input: {
  ownerKey: unknown;
  projectId: unknown;
  versionId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  return assertOwnedStoryVisualVersion({
    ownerKey,
    projectId,
    versionId: cleanOptionalStoryBibleId(input.versionId) || "",
  });
}

export function findStoryVisualVersionForJob(input: {
  ownerKey: unknown;
  projectId: unknown;
  jobId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(input.ownerKey, input.projectId);
  const jobId = cleanOptionalStoryBibleId(input.jobId);
  if (!jobId) throw new Error("Story generation job id is required.");
  const row = db().prepare(`
    SELECT * FROM story_visual_asset_versions
    WHERE project_id = ? AND owner_key = ? AND job_id = ?
    LIMIT 1
  `).get(projectId, ownerKey, jobId) as any;
  if (!row) {
    throw storyBibleError(
      "STORY_VISUAL_VERSION_NOT_FOUND",
      "Story visual asset version was not found for this generation job.",
    );
  }
  return rowToStoryVisualVersion(row);
}

export function listStoryVisualAssets(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  const assets = listStoryAssets({ ownerKey, projectId });
  const versionRows = db()
    .prepare(`
      SELECT *
      FROM story_visual_asset_versions
      WHERE project_id = ? AND owner_key = ?
      ORDER BY asset_id, version DESC
    `)
    .all(projectId, ownerKey)
    .map(rowToStoryVisualVersion);
  const bindingRows = db()
    .prepare(`
      SELECT *
      FROM story_visual_asset_bindings
      WHERE project_id = ? AND owner_key = ?
      ORDER BY created_at ASC
    `)
    .all(projectId, ownerKey)
    .map(rowToStoryVisualBinding);

  const versionsByAsset = new Map<string, StoryVisualAssetVersion[]>();
  const bindingsByAsset = new Map<string, StoryVisualAssetBinding[]>();
  for (const version of versionRows) {
    versionsByAsset.set(
      version.assetId,
      [...(versionsByAsset.get(version.assetId) || []), version],
    );
  }
  for (const binding of bindingRows) {
    bindingsByAsset.set(
      binding.assetId,
      [...(bindingsByAsset.get(binding.assetId) || []), binding],
    );
  }

  return assets
    .filter((asset) => versionsByAsset.has(asset.id))
    .map((asset): StoryVisualAssetRecord => {
      const versions = versionsByAsset.get(asset.id) || [];
      return {
        ...asset,
        visualKind:
          versions[0]?.kind || cleanStoryVisualAssetKind(
            asset.metadata.visualKind || asset.assetType,
          ),
        versions,
        bindings: bindingsByAsset.get(asset.id) || [],
      };
    });
}

export function prepareStoryVisualGeneration(input: {
  ownerKey: unknown;
  projectId: unknown;
  assetId?: unknown;
  parentVersionId?: unknown;
  visualKind: unknown;
  name: unknown;
  prompt: unknown;
  artStyle?: unknown;
  aspectRatio?: unknown;
  referenceVersionIds?: unknown;
  entityId?: unknown;
  metadata?: unknown;
  editEngine?: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  const visualKind = cleanStoryVisualAssetKind(input.visualKind);
  const name = cleanTitle(input.name);
  const prompt = cleanStoryLongText(input.prompt, 40_000);
  if (!prompt) throw new Error("A visual description is required.");
  const artStyle = cleanStoryLongText(input.artStyle, 2_000);
  const aspectRatio = cleanShort(input.aspectRatio) || "landscape";
  const referenceVersionIds = Array.isArray(input.referenceVersionIds)
    ? input.referenceVersionIds
        .map(cleanOptionalStoryBibleId)
        .filter(Boolean)
        .slice(0, 8) as string[]
    : [];

  for (const versionId of referenceVersionIds) {
    const reference = assertOwnedStoryVisualVersion({
      ownerKey,
      projectId,
      versionId,
    });
    if (reference.status !== "approved" && reference.status !== "ready") {
      throw new Error("Only ready or approved Story references may be used.");
    }
  }

  let asset: StoryAsset;
  const requestedAssetId = cleanOptionalStoryBibleId(input.assetId);
  if (requestedAssetId) {
    asset = assertOwnedStoryAsset({ ownerKey, projectId, assetId: requestedAssetId });
  } else {
    asset = addStoryAsset({
      ownerKey,
      projectId,
      assetType: baseAssetTypeForVisualKind(visualKind),
      name,
      prompt,
      status: "planned",
      provider: "qwen-image-2-1",
      metadata: {
        visualKind,
        entityId: cleanOptionalStoryBibleId(input.entityId),
        ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
      },
    });
  }

  const parentVersionId = cleanOptionalStoryBibleId(input.parentVersionId);
  if (parentVersionId) {
    const parent = assertOwnedStoryVisualVersion({ ownerKey, projectId, versionId: parentVersionId });
    if (parent.assetId !== asset.id) {
      throw new Error("The source version does not belong to this visual asset.");
    }
  }
  const usesImageEdit = Boolean(parentVersionId || referenceVersionIds.length);
  const editEngine = String(input.editEngine || "qwen");
  if (!["qwen", "fibo2-edit-turbo", "fibo2-dev"].includes(editEngine)) throw new Error("Unsupported image edit model.");
  const fiboEdit = usesImageEdit && editEngine !== "qwen";
  if (fiboEdit && !privateMediaEnvironmentEnabled()) throw new Error("Fibo image editing requires the configured private-research media environment.");
  if (fiboEdit && new Set([parentVersionId, ...referenceVersionIds].filter(Boolean)).size > 1) {
    throw new Error("Fibo is currently verified with one source image. Choose Qwen or explicitly remove additional references.");
  }
  const provider = fiboEdit ? editEngine : usesImageEdit ? "qwen-image-edit-2-1" : "qwen-image-2-1";
  const workflowId = fiboEdit ? `native/${editEngine}` : usesImageEdit
    ? QWEN21_IMAGE_EDIT_WORKFLOW_ID
    : QWEN21_STORY_CREATE_WORKFLOW_FILE;

  const nextVersion = Number(
    (db().prepare(`
      SELECT COALESCE(MAX(version), 0) AS max_version
      FROM story_visual_asset_versions
      WHERE project_id = ? AND owner_key = ? AND asset_id = ?
    `).get(projectId, ownerKey, asset.id) as any)?.max_version || 0,
  ) + 1;
  const now = Date.now();
  const versionId = randomUUID();
  const metadataJson = cleanStoryJson({
    aspectRatio,
    artStyle,
    referenceVersionIds,
    entityId: cleanOptionalStoryBibleId(input.entityId),
    ...(fiboEdit ? {imageEdit: {engine: editEngine, steps: editEngine === "fibo2-dev" ? 50 : 4, cfg: editEngine === "fibo2-dev" ? 5 : 1, sampler: "euler", workflowId}} : {qwenTurbo: {
      ...QWEN21_TURBO_CONTRACT,
      operation: usesImageEdit ? "edit" : "create",
      workflowId,
    }}),
    ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
  });
  db().prepare(`
    INSERT INTO story_visual_asset_versions (
      id, project_id, owner_key, asset_id, version, visual_kind,
      status, parent_version_id, prompt, provider, model, workflow_id,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId, projectId, ownerKey, asset.id, nextVersion, visualKind,
    parentVersionId, prompt, provider, fiboEdit ? editEngine : usesImageEdit ? "qwen-image-edit-2-1-turbo" : "qwen-image-2-1-turbo",
    workflowId,
    metadataJson, now, now,
  );

  const version = assertOwnedStoryVisualVersion({ ownerKey, projectId, versionId });
  return {
    asset,
    version,
    generation: {
      endpoint: "/api/assets/create-image",
      method: "POST",
      body: {
        name,
        model: "qwen-image-2-1",
        artStyle,
        prompt,
        orientation: aspectRatio,
        visualKind,
        persistOutput: true,
      },
      requiresExplicitConfirmation: true,
    },
  };
}

export function recordStoryVisualSubmission(input: {
  ownerKey: unknown;
  projectId: unknown;
  versionId: unknown;
  promptId: unknown;
  response?: unknown;
  endpoint?: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(input.ownerKey, input.projectId);
  const versionId = cleanOptionalStoryBibleId(input.versionId);
  const promptId = cleanOptionalStoryBibleId(input.promptId);
  if (!versionId || !promptId) throw new Error("Visual version and submitted prompt id are required.");
  const version = assertOwnedStoryVisualVersion({ ownerKey, projectId, versionId });
  if (version.status !== "planned" && version.status !== "failed") {
    throw new Error("This visual version has already been submitted.");
  }
  const endpoint = cleanStoryLongText(input.endpoint, 2_000) || "/api/assets/create-image";
  const now = Date.now();
  const job = addStoryGenerationJob({
    ownerKey,
    projectId,
    assetId: version.assetId,
    jobType: version.workflowId.includes("image_edit") || version.workflowId.startsWith("native/fibo2-") ? "story-image-edit" : "story-image",
    provider: version.provider,
    status: "submitted",
    promptId,
    endpoint,
    request: { versionId, prompt: version.prompt, ...version.metadata },
    response: input.response,
  });
  db().transaction(() => {
    db().prepare(`
      UPDATE story_visual_asset_versions
      SET status = 'generating', job_id = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_key = ?
    `).run(job.id, now, version.id, projectId, ownerKey);
    db().prepare(`
      UPDATE story_assets
      SET status = 'generating', job_id = ?, provider = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_key = ?
    `).run(promptId, version.provider, now, version.assetId, projectId, ownerKey);
  })();
  return {
    asset: assertOwnedStoryAsset({ ownerKey, projectId, assetId: version.assetId }),
    version: assertOwnedStoryVisualVersion({ ownerKey, projectId, versionId }),
    job,
  };
}

export function attachStoryVisualUpload(input: {
  ownerKey: unknown;
  projectId: unknown;
  assetId?: unknown;
  visualKind: unknown;
  name: unknown;
  prompt?: unknown;
  url: unknown;
  filePath: unknown;
  metadata?: unknown;
}) {
  const prepared = prepareStoryVisualGeneration({
    ...input,
    prompt: input.prompt || `Uploaded reference for ${String(input.name || "visual asset")}`,
    artStyle: "",
    aspectRatio: "source",
  });
  const { ownerKey, projectId } = assertOwnedActiveProject(input.ownerKey, input.projectId);
  const url = cleanOptionalStoryBibleId(input.url) ||
    `/api/story-creator/visual-assets/media?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(prepared.version.id)}`;
  const filePath = cleanOptionalStoryBibleId(input.filePath);
  const now = Date.now();
  db().transaction(() => {
    db().prepare(`
      UPDATE story_visual_asset_versions
      SET status = 'ready', provider = 'uploaded', model = '', workflow_id = '',
          url = ?, file_path = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_key = ?
    `).run(url, filePath, now, prepared.version.id, projectId, ownerKey);
    db().prepare(`
      UPDATE story_assets
      SET status = 'ready', provider = 'uploaded', url = ?, file_path = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_key = ?
    `).run(url, filePath, now, prepared.asset.id, projectId, ownerKey);
  })();
  return {
    asset: assertOwnedStoryAsset({ ownerKey, projectId, assetId: prepared.asset.id }),
    version: assertOwnedStoryVisualVersion({ ownerKey, projectId, versionId: prepared.version.id }),
  };
}

export function approveStoryVisualVersion(input: {
  ownerKey: unknown;
  projectId: unknown;
  versionId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(input.ownerKey, input.projectId);
  const versionId = cleanOptionalStoryBibleId(input.versionId);
  if (!versionId) throw new Error("Visual version id is required.");
  const version = assertOwnedStoryVisualVersion({ ownerKey, projectId, versionId });
  if (version.status !== "ready" && version.status !== "approved") {
    throw new Error("Only a completed visual version can be approved.");
  }
  const now = Date.now();
  db().transaction(() => {
    db().prepare(`
      UPDATE story_visual_asset_versions
      SET status = CASE WHEN id = ? THEN 'approved' ELSE CASE WHEN status = 'approved' THEN 'ready' ELSE status END END,
          updated_at = CASE WHEN id = ? OR status = 'approved' THEN ? ELSE updated_at END
      WHERE project_id = ? AND owner_key = ? AND asset_id = ?
    `).run(version.id, version.id, now, projectId, ownerKey, version.assetId);
    db().prepare(`
      UPDATE story_assets
      SET status = 'ready', prompt = ?, provider = ?, url = ?, file_path = ?,
          metadata_json = json_set(metadata_json, '$.approvedVisualVersionId', ?), updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_key = ?
    `).run(version.prompt, version.provider, version.url, version.filePath, version.id, now, version.assetId, projectId, ownerKey);
    db().prepare(`
      UPDATE story_visual_asset_bindings
      SET approved = CASE WHEN version_id = ? THEN 1 ELSE 0 END, updated_at = ?
      WHERE project_id = ? AND owner_key = ? AND asset_id = ?
    `).run(version.id, now, projectId, ownerKey, version.assetId);
  })();
  return assertOwnedStoryVisualVersion({ ownerKey, projectId, versionId });
}

export function rejectStoryVisualVersion(input: {
  ownerKey: unknown;
  projectId: unknown;
  versionId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(input.ownerKey, input.projectId);
  const version = assertOwnedStoryVisualVersion({
    ownerKey,
    projectId,
    versionId: cleanOptionalStoryBibleId(input.versionId) || "",
  });
  if (version.status === "generating" || version.status === "planned") {
    throw new Error("Wait for this visual version to finish before rejecting it.");
  }
  db().prepare(`
    UPDATE story_visual_asset_versions
    SET status = 'rejected', updated_at = ?
    WHERE id = ? AND project_id = ? AND owner_key = ?
  `).run(Date.now(), version.id, projectId, ownerKey);
  return assertOwnedStoryVisualVersion({ ownerKey, projectId, versionId: version.id });
}

export function restoreStoryVisualVersion(input: {
  ownerKey: unknown;
  projectId: unknown;
  versionId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(input.ownerKey, input.projectId);
  const source = assertOwnedStoryVisualVersion({
    ownerKey,
    projectId,
    versionId: cleanOptionalStoryBibleId(input.versionId) || "",
  });
  if (!source.url && !source.filePath) throw new Error("The selected version has no restorable image.");
  const next = Number((db().prepare(`
    SELECT COALESCE(MAX(version), 0) AS max_version
    FROM story_visual_asset_versions
    WHERE project_id = ? AND owner_key = ? AND asset_id = ?
  `).get(projectId, ownerKey, source.assetId) as any)?.max_version || 0) + 1;
  const id = randomUUID();
  const now = Date.now();
  db().prepare(`
    INSERT INTO story_visual_asset_versions (
      id, project_id, owner_key, asset_id, version, visual_kind, status,
      parent_version_id, prompt, provider, model, workflow_id, url, file_path,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, ownerKey, source.assetId, next, source.kind, source.id,
    source.prompt, source.provider, source.model, source.workflowId, source.url,
    source.filePath, cleanStoryJson({ ...source.metadata, restoredFromVersionId: source.id }), now, now);
  return assertOwnedStoryVisualVersion({ ownerKey, projectId, versionId: id });
}

export function bindStoryVisualVersion(input: {
  ownerKey: unknown;
  projectId: unknown;
  versionId: unknown;
  bindingType: unknown;
  entityId?: unknown;
  planVersion?: unknown;
  sceneId?: unknown;
  shotId?: unknown;
  role?: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(input.ownerKey, input.projectId);
  const version = assertOwnedStoryVisualVersion({
    ownerKey,
    projectId,
    versionId: cleanOptionalStoryBibleId(input.versionId) || "",
  });
  const bindingType = String(input.bindingType || "project");
  if (!["project", "entity", "scene", "shot"].includes(bindingType)) {
    throw new Error("Visual binding type is not supported.");
  }
  const entityId = cleanOptionalStoryBibleId(input.entityId);
  if (bindingType === "entity") {
    if (!entityId) throw new Error("An entity is required for this visual binding.");
    assertOwnedStoryBibleEntity({ ownerKey, projectId, entityId });
  }
  const planVersion = Number(input.planVersion || 0) || null;
  const sceneId = cleanOptionalStoryBibleId(input.sceneId);
  const shotId = cleanOptionalStoryBibleId(input.shotId);
  if (bindingType === "scene" || bindingType === "shot") {
    if (!planVersion || !sceneId) throw new Error("Plan version and scene are required.");
    const row = db().prepare(`
      SELECT plan_json FROM story_production_plan_versions
      WHERE project_id = ? AND owner_key = ? AND version = ? LIMIT 1
    `).get(projectId, ownerKey, planVersion) as any;
    if (!row) throw new Error("The selected production plan version was not found.");
    const plan = normalizeStoryProductionPlan(JSON.parse(String(row.plan_json)), projectId);
    const scene = plan.acts.flatMap((act) => act.scenes).find((item) => item.id === sceneId);
    if (!scene) throw new Error("The selected scene is not part of this production plan version.");
    if (bindingType === "shot" && (!shotId || !scene.shots.some((shot) => shot.id === shotId))) {
      throw new Error("The selected shot is not part of this scene.");
    }
  }
  const now = Date.now();
  const binding: StoryVisualAssetBinding = {
    id: randomUUID(), projectId, ownerKey, assetId: version.assetId, versionId: version.id,
    bindingType: bindingType as StoryVisualAssetBinding["bindingType"], entityId,
    planVersion, sceneId, shotId, role: cleanShort(input.role) || "reference",
    approved: version.status === "approved", createdAt: now, updatedAt: now,
  };
  db().prepare(`
    INSERT INTO story_visual_asset_bindings (
      id, project_id, owner_key, asset_id, version_id, binding_type,
      entity_id, plan_version, scene_id, shot_id, role, approved, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(binding.id, projectId, ownerKey, binding.assetId, binding.versionId,
    binding.bindingType, binding.entityId, binding.planVersion, binding.sceneId,
    binding.shotId, binding.role, binding.approved ? 1 : 0, now, now);
  return binding;
}

export function planStoryVisualAssetsFromProduction(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(input.ownerKey, input.projectId);
  const planRecord = getStoryProductionPlan({ ownerKey, projectId });
  if (!planRecord || planRecord.status !== "approved") {
    throw new Error("Approve the production plan before planning visual assets.");
  }
  const existing = listStoryVisualAssets({ ownerKey, projectId });
  const keys = new Set(existing.flatMap((asset) => asset.versions.map((version) => {
    const sceneId = String(version.metadata.sceneId || "");
    const shotId = String(version.metadata.shotId || "");
    return `${version.kind}:${planRecord.version}:${sceneId}:${shotId}`;
  })));
  const created: Array<ReturnType<typeof prepareStoryVisualGeneration>> = [];
  let reused = 0;

  for (const scene of planRecord.plan.acts.flatMap((act) => act.scenes)) {
    const sceneKey = `storyboard:${planRecord.version}:${scene.id}:`;
    if (keys.has(sceneKey)) reused += 1;
    else {
      created.push(prepareStoryVisualGeneration({
        ownerKey, projectId, visualKind: "storyboard",
        name: `Scene ${scene.sceneNumber}: ${scene.title} storyboard`,
        prompt: [scene.purpose, scene.location, scene.timeOfDay, scene.action, scene.emotionalTone].filter(Boolean).join(". "),
        aspectRatio: "landscape",
        metadata: { planVersion: planRecord.version, sceneId: scene.id, shotId: null, automaticPlan: true },
      }));
      keys.add(sceneKey);
    }
    for (const shot of scene.shots) {
      const shotKey = `shot_reference:${planRecord.version}:${scene.id}:${shot.id}`;
      if (keys.has(shotKey)) reused += 1;
      else {
        created.push(prepareStoryVisualGeneration({
          ownerKey, projectId, visualKind: "shot_reference",
          name: `Scene ${scene.sceneNumber}, Shot ${shot.shotNumber}`,
          prompt: [shot.description, shot.cameraFraming, shot.cameraMovement, shot.characterActions, scene.continuityRequirements.join(", ")].filter(Boolean).join(". "),
          aspectRatio: "landscape",
          metadata: { planVersion: planRecord.version, sceneId: scene.id, shotId: shot.id, automaticPlan: true },
        }));
        keys.add(shotKey);
      }
    }
  }

  return { planVersion: planRecord.version, created: created.length, reused, jobsStarted: 0 };
}

export function listStoryGenerationJobs(input: {
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
        rowid AS job_rowid,
        *
      FROM story_generation_jobs
      WHERE project_id = ?
        AND owner_key = ?
      ORDER BY
        updated_at DESC,
        job_rowid DESC
    `)
    .all(projectId, ownerKey);

  return rows.map(rowToStoryGenerationJob);
}

export function addStoryGenerationJob(input: {
  ownerKey: unknown;
  projectId: unknown;
  assetId?: unknown;
  jobType: unknown;
  provider: unknown;
  status?: unknown;
  promptId?: unknown;
  externalJobId?: unknown;
  endpoint?: unknown;
  request?: unknown;
  response?: unknown;
  errorText?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const assetId = cleanOptionalStoryBibleId(input.assetId);

  if (assetId) {
    assertOwnedStoryAsset({
      ownerKey,
      projectId,
      assetId,
    });
  }

  const now = Date.now();

  const job: StoryGenerationJob = {
    id: randomUUID(),
    projectId,
    ownerKey,
    assetId,
    jobType: cleanShort(input.jobType),
    provider: cleanShort(input.provider),
    status: input.status
      ? cleanStoryGenerationJobStatus(input.status)
      : "planned",
    promptId: cleanOptionalStoryBibleId(input.promptId),
    externalJobId: cleanOptionalStoryBibleId(
      input.externalJobId,
    ),
    endpoint: cleanStoryLongText(input.endpoint, 400),
    request: parseStoryJson(cleanStoryJson(input.request)),
    response: parseStoryJson(cleanStoryJson(input.response)),
    errorText: cleanStoryLongText(input.errorText, 20_000),
    createdAt: now,
    updatedAt: now,
  };

  const write = db().transaction(() => {
    db()
      .prepare(`
        INSERT INTO story_generation_jobs (
          id,
          project_id,
          owner_key,
          asset_id,
          job_type,
          provider,
          status,
          prompt_id,
          external_job_id,
          endpoint,
          request_json,
          response_json,
          error_text,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        job.id,
        projectId,
        ownerKey,
        assetId,
        job.jobType,
        job.provider,
        job.status,
        job.promptId,
        job.externalJobId,
        job.endpoint,
        cleanStoryJson(input.request),
        cleanStoryJson(input.response),
        job.errorText,
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
      .run(now, projectId, ownerKey);
  });

  write();

  return job;
}

export function markStoryGenerationJobRunning(input: {
  ownerKey: unknown;
  projectId: unknown;
  jobId: unknown;
  assetId?: unknown;
  response?: unknown;
}): StoryAssetJobMutationResult {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const jobId = cleanOptionalStoryBibleId(input.jobId);
  if (!jobId) {
    throw storyBibleError(
      "STORY_GENERATION_JOB_ID_REQUIRED",
      "Story generation job id is required.",
    );
  }

  const job = assertOwnedStoryGenerationJob({
    ownerKey,
    projectId,
    jobId,
  });
  const assetId = cleanOptionalStoryBibleId(input.assetId);

  if (assetId) {
    assertStoryAssetJobMatch(job, assetId);
  }

  if (job.status === "complete" || job.status === "failed") {
    return {
      job,
      asset: job.assetId
        ? assertOwnedStoryAsset({
            ownerKey,
            projectId,
            assetId: job.assetId,
          })
        : null,
    };
  }

  const now = Date.now();
  const responsePatch = storyRecord(input.response);

  const write = db().transaction(() => {
    db()
      .prepare(`
        UPDATE story_generation_jobs
        SET status = 'running',
          response_json = ?,
          error_text = '',
          updated_at = ?
        WHERE id = ?
          AND project_id = ?
          AND owner_key = ?
      `)
      .run(
        mergedStoryJson(job.response, responsePatch),
        now,
        job.id,
        projectId,
        ownerKey,
      );

    if (job.assetId) {
      db()
        .prepare(`
          UPDATE story_assets
          SET status = 'generating',
            updated_at = ?
          WHERE id = ?
            AND project_id = ?
            AND owner_key = ?
            AND status IN ('planned', 'generating')
        `)
        .run(now, job.assetId, projectId, ownerKey);
    }

    touchStoryProject({
      ownerKey,
      projectId,
      now,
    });
  });

  write();

  const updatedJob =
    assertOwnedStoryGenerationJob({
      ownerKey,
      projectId,
      jobId: job.id,
    });

  return {
    job: updatedJob,
    asset: updatedJob.assetId
      ? assertOwnedStoryAsset({
          ownerKey,
          projectId,
          assetId: updatedJob.assetId,
        })
      : null,
  };
}

export function completeStoryGenerationJob(input: {
  ownerKey: unknown;
  projectId: unknown;
  jobId: unknown;
  assetId?: unknown;
  output: StoryAssetCompletionOutput;
  response?: unknown;
  debugFailurePoint?: unknown;
}): StoryAssetJobMutationResult {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const jobId = cleanOptionalStoryBibleId(input.jobId);
  if (!jobId) {
    throw storyBibleError(
      "STORY_GENERATION_JOB_ID_REQUIRED",
      "Story generation job id is required.",
    );
  }

  const job = assertOwnedStoryGenerationJob({
    ownerKey,
    projectId,
    jobId,
  });
  const assetId = cleanOptionalStoryBibleId(input.assetId);

  if (assetId) {
    assertStoryAssetJobMatch(job, assetId);
  }

  const asset = job.assetId
    ? assertOwnedStoryAsset({
        ownerKey,
        projectId,
        assetId: job.assetId,
      })
    : null;

  const output = input.output || {};
  const url = cleanStoryLongText(output.url, 2000);
  if (!url) {
    throw storyBibleError(
      "STORY_ASSET_OUTPUT_REQUIRED",
      "Completed Story asset output URL is required.",
    );
  }

  const now = Date.now();
  const filename = cleanStoryLongText(output.filename, 260);
  const subfolder = cleanStoryLongText(output.subfolder, 260);
  const type = cleanShort(output.type || "output") || "output";
  const filePath =
    cleanStoryLongText(output.filePath, 1000) ||
    [type, subfolder, filename].filter(Boolean).join("/");
  const promptId =
    cleanOptionalStoryBibleId(output.promptId) || job.promptId;
  const provider =
    cleanShort(output.provider || job.provider) || job.provider;
  const completion = {
    ...storyRecord(output.metadata),
    promptId,
    outputNodeId: cleanShort(output.outputNodeId),
    filename,
    subfolder,
    type,
    comfyBaseUrl: cleanStoryLongText(output.comfyBaseUrl, 600),
    backend: cleanShort(output.backend),
    seed: finiteNumberOrNull(output.seed),
    width: finiteNumberOrNull(output.width),
    height: finiteNumberOrNull(output.height),
    provider,
    model: cleanShort(output.model || provider),
    completedAt: now,
  };
  const responsePatch = storyRecord(input.response);
  const debugFailurePoint = String(
    input.debugFailurePoint || "",
  );

  const write = db().transaction(() => {
    db()
      .prepare(`
        UPDATE story_generation_jobs
        SET status = 'complete',
          response_json = ?,
          error_text = '',
          updated_at = ?
        WHERE id = ?
          AND project_id = ?
          AND owner_key = ?
      `)
      .run(
        mergedStoryJson(job.response, {
          ...responsePatch,
          completion,
        }),
        now,
        job.id,
        projectId,
        ownerKey,
      );

    if (debugFailurePoint === "afterJobWrite") {
      throw storyBibleError(
        "STORY_ASSET_COMPLETION_DEBUG_FAILURE",
        "Forced Story asset completion failure after job write.",
      );
    }

    if (asset) {
      db()
        .prepare(`
          UPDATE story_assets
          SET status = 'ready',
            provider = ?,
            url = ?,
            file_path = ?,
            metadata_json = ?,
            updated_at = ?
          WHERE id = ?
            AND project_id = ?
            AND owner_key = ?
        `)
        .run(
          provider,
          url,
          filePath,
          mergedStoryJson(asset.metadata, {
            completion,
            imageOutput: completion,
            readyAt: now,
          }),
          now,
          asset.id,
          projectId,
          ownerKey,
        );

      db().prepare(`
        UPDATE story_visual_asset_versions
        SET status = 'ready', provider = ?, url = ?, file_path = ?,
            metadata_json = json_set(metadata_json, '$.completion', json(?)),
            updated_at = ?
        WHERE project_id = ? AND owner_key = ? AND asset_id = ? AND job_id = ?
      `).run(
        provider,
        url,
        filePath,
        cleanStoryJson(completion),
        now,
        projectId,
        ownerKey,
        asset.id,
        job.id,
      );
    }

    touchStoryProject({
      ownerKey,
      projectId,
      now,
    });
  });

  write();

  const updatedJob =
    assertOwnedStoryGenerationJob({
      ownerKey,
      projectId,
      jobId: job.id,
    });

  return {
    job: updatedJob,
    asset: updatedJob.assetId
      ? assertOwnedStoryAsset({
          ownerKey,
          projectId,
          assetId: updatedJob.assetId,
        })
      : null,
  };
}

export function failStoryGenerationJob(input: {
  ownerKey: unknown;
  projectId: unknown;
  jobId: unknown;
  assetId?: unknown;
  errorText: unknown;
  response?: unknown;
}): StoryAssetJobMutationResult {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const jobId = cleanOptionalStoryBibleId(input.jobId);
  if (!jobId) {
    throw storyBibleError(
      "STORY_GENERATION_JOB_ID_REQUIRED",
      "Story generation job id is required.",
    );
  }

  const job = assertOwnedStoryGenerationJob({
    ownerKey,
    projectId,
    jobId,
  });
  const assetId = cleanOptionalStoryBibleId(input.assetId);

  if (assetId) {
    assertStoryAssetJobMatch(job, assetId);
  }

  if (job.status === "complete") {
    return {
      job,
      asset: job.assetId
        ? assertOwnedStoryAsset({
            ownerKey,
            projectId,
            assetId: job.assetId,
          })
        : null,
    };
  }

  const asset = job.assetId
    ? assertOwnedStoryAsset({
        ownerKey,
        projectId,
        assetId: job.assetId,
      })
    : null;
  const now = Date.now();
  const errorText = cleanStoryLongText(
    input.errorText,
    20_000,
  ) || "Story image generation failed.";
  const responsePatch = storyRecord(input.response);

  const write = db().transaction(() => {
    db()
      .prepare(`
        UPDATE story_generation_jobs
        SET status = 'failed',
          response_json = ?,
          error_text = ?,
          updated_at = ?
        WHERE id = ?
          AND project_id = ?
          AND owner_key = ?
      `)
      .run(
        mergedStoryJson(job.response, responsePatch),
        errorText,
        now,
        job.id,
        projectId,
        ownerKey,
      );

    if (asset) {
      db()
        .prepare(`
          UPDATE story_assets
          SET status = 'failed',
            metadata_json = ?,
            updated_at = ?
          WHERE id = ?
            AND project_id = ?
            AND owner_key = ?
        `)
        .run(
          mergedStoryJson(asset.metadata, {
            completionError: errorText,
            failedAt: now,
          }),
          now,
          asset.id,
          projectId,
          ownerKey,
        );


      db().prepare(`
        UPDATE story_visual_asset_versions
        SET status = 'failed',
            metadata_json = json_set(metadata_json, '$.completionError', ?),
            updated_at = ?
        WHERE project_id = ? AND owner_key = ? AND asset_id = ? AND job_id = ?
      `).run(errorText, now, projectId, ownerKey, asset.id, job.id);
    }

    touchStoryProject({
      ownerKey,
      projectId,
      now,
    });
  });

  write();

  const updatedJob =
    assertOwnedStoryGenerationJob({
      ownerKey,
      projectId,
      jobId: job.id,
    });

  return {
    job: updatedJob,
    asset: updatedJob.assetId
      ? assertOwnedStoryAsset({
          ownerKey,
          projectId,
          assetId: updatedJob.assetId,
        })
      : null,
  };
}

export function listStoryExports(input: {
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
        rowid AS export_rowid,
        *
      FROM story_exports
      WHERE project_id = ?
        AND owner_key = ?
      ORDER BY
        updated_at DESC,
        export_rowid DESC
    `)
    .all(projectId, ownerKey);

  return rows.map(rowToStoryExport);
}

export function addStoryExport(input: {
  ownerKey: unknown;
  projectId: unknown;
  exportType: unknown;
  status?: unknown;
  payload: unknown;
  filePath?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const now = Date.now();
  const payloadJson = cleanStoryJson(input.payload);

  const storyExport: StoryExport = {
    id: randomUUID(),
    projectId,
    ownerKey,
    exportType: cleanShort(input.exportType),
    status: input.status
      ? cleanStoryExportStatus(input.status)
      : "ready",
    payload: parseStoryJson(payloadJson),
    filePath: cleanOptionalStoryBibleId(input.filePath),
    createdAt: now,
    updatedAt: now,
  };

  const write = db().transaction(() => {
    db()
      .prepare(`
        INSERT INTO story_exports (
          id,
          project_id,
          owner_key,
          export_type,
          status,
          payload_json,
          file_path,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        storyExport.id,
        projectId,
        ownerKey,
        storyExport.exportType,
        storyExport.status,
        payloadJson,
        storyExport.filePath,
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
      .run(now, projectId, ownerKey);
  });

  write();

  return storyExport;
}


export function listStoryOpenQuestions(input: {
  ownerKey: unknown;
  projectId: unknown;
  status?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const status = input.status
    ? cleanStoryOpenQuestionStatus(input.status)
    : "";

  const rows = db()
    .prepare(`
      SELECT
        rowid AS question_rowid,
        *
      FROM story_open_questions
      WHERE project_id = ?
        AND owner_key = ?
        AND (? = '' OR status = ?)
      ORDER BY
        created_at ASC,
        question_rowid ASC
    `)
    .all(
      projectId,
      ownerKey,
      status,
      status,
    );

  return rows.map(rowToStoryOpenQuestion);
}

export function addStoryOpenQuestion(input: {
  ownerKey: unknown;
  projectId: unknown;
  question: unknown;
  status?: unknown;
  sourceRole: unknown;
  sourceMessageId?: unknown;
}) {
  const { ownerKey, projectId } =
    assertOwnedActiveProject(
      input.ownerKey,
      input.projectId,
    );

  const question = cleanStoryLongText(input.question, 2000);

  if (!question) {
    throw new Error("Story open question is required.");
  }

  const status = input.status
    ? cleanStoryOpenQuestionStatus(input.status)
    : "open";
  const sourceRole = cleanStoryBibleSourceRole(input.sourceRole);
  const sourceMessageId = cleanOptionalStoryBibleId(
    input.sourceMessageId,
  );

  assertStoryBibleSourceMessage({
    ownerKey,
    projectId,
    sourceRole,
    sourceMessageId,
  });

  const now = Date.now();

  const existing = db()
    .prepare(`
      SELECT *
      FROM story_open_questions
      WHERE project_id = ?
        AND owner_key = ?
        AND question = ?
        AND status = 'open'
      LIMIT 1
    `)
    .get(projectId, ownerKey, question) as any;

  if (existing) {
    return rowToStoryOpenQuestion(existing);
  }

  const item: StoryOpenQuestion = {
    id: randomUUID(),
    projectId,
    ownerKey,
    question,
    status,
    sourceRole,
    sourceMessageId,
    createdAt: now,
    updatedAt: now,
  };

  const write = db().transaction(() => {
    insertStoryOpenQuestionRow(item);

    db()
      .prepare(`
        UPDATE story_projects
        SET updated_at = ?
        WHERE id = ?
          AND owner_key = ?
          AND status = 'active'
      `)
      .run(now, projectId, ownerKey);
  });

  write();

  return item;
}

export function getStoryProductionPlan(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  const row = db()
    .prepare(`
      SELECT *
      FROM story_production_plans
      WHERE project_id = ?
        AND owner_key = ?
      LIMIT 1
    `)
    .get(projectId, ownerKey) as any;

  return row ? rowToStoryProductionPlanRecord(row) : null;
}

export function listStoryProductionPlanVersions(input: {
  ownerKey: unknown;
  projectId: unknown;
  limit?: number;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  const limit = Math.max(1, Math.min(50, Number(input.limit || 20)));
  const rows = db()
    .prepare(`
      SELECT *
      FROM story_production_plan_versions
      WHERE project_id = ?
        AND owner_key = ?
      ORDER BY version DESC
      LIMIT ?
    `)
    .all(projectId, ownerKey, limit) as any[];

  return rows.map((row) => ({
    id: String(row.id),
    projectId,
    version: Number(row.version),
    status: row.status === "approved" ? "approved" as const : "draft" as const,
    sourceRole: cleanStoryBibleSourceRole(row.source_role),
    createdAt: Number(row.created_at),
  }));
}

export function saveStoryProductionPlan(input: {
  ownerKey: unknown;
  projectId: unknown;
  plan: unknown;
  sourceRole?: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  const sourceRole = cleanStoryBibleSourceRole(
    input.sourceRole || "user",
  );
  const existing = db()
    .prepare(`
      SELECT * FROM story_production_plans
      WHERE project_id = ? AND owner_key = ?
      LIMIT 1
    `)
    .get(projectId, ownerKey) as any;
  const version = Number(existing?.version || 0) + 1;
  const now = Date.now();
  const normalized = normalizeStoryProductionPlan(input.plan, projectId);
  const plan: StoryProductionPlan = {
    ...normalized,
    status: "draft",
  };
  const planJson = JSON.stringify(plan);
  if (Buffer.byteLength(planJson, "utf8") > 2_000_000) {
    throw storyBibleError(
      "STORY_PRODUCTION_PLAN_TOO_LARGE",
      "The production plan is too large to save safely.",
    );
  }
  const createdAt = Number(existing?.created_at || now);

  const write = db().transaction(() => {
    db()
      .prepare(`
        INSERT INTO story_production_plans (
          project_id, owner_key, version, status, plan_json,
          approved_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', ?, NULL, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          owner_key = excluded.owner_key,
          version = excluded.version,
          status = 'draft',
          plan_json = excluded.plan_json,
          approved_at = NULL,
          updated_at = excluded.updated_at
      `)
      .run(
        projectId,
        ownerKey,
        version,
        planJson,
        createdAt,
        now,
      );

    db()
      .prepare(`
        INSERT INTO story_production_plan_versions (
          id, project_id, owner_key, version, status,
          plan_json, source_role, created_at
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
      `)
      .run(
        randomUUID(),
        projectId,
        ownerKey,
        version,
        planJson,
        sourceRole,
        now,
      );

    touchStoryProject({ ownerKey, projectId, now });
  });

  write();
  return getStoryProductionPlan({ ownerKey, projectId })!;
}

export function approveStoryProductionPlan(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const { ownerKey, projectId } = assertOwnedActiveProject(
    input.ownerKey,
    input.projectId,
  );
  const existing = getStoryProductionPlan({ ownerKey, projectId });
  if (!existing) {
    throw storyBibleError(
      "STORY_PRODUCTION_PLAN_REQUIRED",
      "Create a production plan before approving it.",
    );
  }

  const version = existing.version + 1;
  const now = Date.now();
  const plan: StoryProductionPlan = {
    ...existing.plan,
    status: "approved",
  };
  const planJson = JSON.stringify(plan);

  const write = db().transaction(() => {
    db()
      .prepare(`
        UPDATE story_production_plans
        SET version = ?, status = 'approved', plan_json = ?,
            approved_at = ?, updated_at = ?
        WHERE project_id = ? AND owner_key = ?
      `)
      .run(version, planJson, now, now, projectId, ownerKey);

    db()
      .prepare(`
        INSERT INTO story_production_plan_versions (
          id, project_id, owner_key, version, status,
          plan_json, source_role, created_at
        ) VALUES (?, ?, ?, ?, 'approved', ?, 'user', ?)
      `)
      .run(randomUUID(), projectId, ownerKey, version, planJson, now);

    touchStoryProject({ ownerKey, projectId, now });
  });

  write();
  return getStoryProductionPlan({ ownerKey, projectId })!;
}

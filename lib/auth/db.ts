import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "otg.db");

// ---- Singleton connection ----
const g = globalThis as any;

if (!g.__otg_db) {
  const conn: any = new (Database as any)(dbPath);
  try {
    conn.pragma("journal_mode = WAL");
    conn.pragma("busy_timeout = 5000");
    conn.pragma("synchronous = NORMAL");
  } catch {}
  g.__otg_db = conn;
}

export const db: any = g.__otg_db;

// ---- Migrations ----
type Migration = { id: string; up: (db: any) => void };

function tableHasColumn(db: any, table: string, col: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.some((r) => String(r.name) === col);
}

function indexExists(db: any, name: string) {
  const rows = db.prepare("PRAGMA index_list(users)").all() as any[];
  return rows.some((r) => String(r.name) === name);
}

const migrations: Migration[] = [
  {
    id: "001_create_users",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    id: "002_add_username",
    up: (db) => {
      if (!tableHasColumn(db, "users", "username")) {
        db.exec(`ALTER TABLE users ADD COLUMN username TEXT;`);
      }
    },
  },
  {
    id: "003_unique_email_ci",
    up: (db) => {
      if (!indexExists(db, "users_email_ci_uq")) {
        db.exec(`CREATE UNIQUE INDEX users_email_ci_uq ON users(LOWER(email));`);
      }
    },
  },
  {
    id: "004_unique_username_ci",
    up: (db) => {
      if (!indexExists(db, "users_username_ci_uq")) {
        db.exec(`CREATE UNIQUE INDEX users_username_ci_uq ON users(LOWER(username));`);
      }
    },
  },
  {
    id: "005_add_single_session",
    up: (db) => {
      if (!tableHasColumn(db, "users", "current_session_id")) {
        db.exec(`ALTER TABLE users ADD COLUMN current_session_id TEXT;`);
      }
      if (!tableHasColumn(db, "users", "current_session_issued_at")) {
        db.exec(`ALTER TABLE users ADD COLUMN current_session_issued_at TEXT;`);
      }
    },
  },
];

export function ensureMigrations() {
  if (g.__otg_migrated || g.__otg_migrating) return;
  g.__otg_migrating = true;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(
      (db.prepare("SELECT id FROM schema_migrations").all() as any[]).map((r) => String(r.id))
    );
    const insert = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");

    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      db.exec("BEGIN");
      try {
        m.up(db);
        insert.run(m.id, new Date().toISOString());
        db.exec("COMMIT");
      } catch {
        db.exec("ROLLBACK");
        throw new Error(`Migration failed: ${m.id}`);
      }
    }

    g.__otg_migrated = true;
  } finally {
    g.__otg_migrating = false;
  }
}

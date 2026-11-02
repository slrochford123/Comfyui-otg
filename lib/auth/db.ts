import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = process.env.OTG_DATA_DIR
  ? path.resolve(process.env.OTG_DATA_DIR)
  : path.join(process.cwd(), "data");

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
  {
    id: "006_add_device_sessions",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          session_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS user_sessions_user_issued
          ON user_sessions(user_id, issued_at DESC);
        INSERT OR IGNORE INTO user_sessions (session_id, user_id, issued_at)
          SELECT current_session_id, id, COALESCE(current_session_issued_at, created_at)
          FROM users
          WHERE current_session_id IS NOT NULL AND current_session_id <> '';
      `);
    },
  },
  {
    id: "007_immutable_admin_roles_and_request_limits",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_roles (
          user_id TEXT NOT NULL, role TEXT NOT NULL, granted_at TEXT NOT NULL,
          PRIMARY KEY (user_id, role), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS request_limits (
          bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
        );
      `);
      // One-time migration of EXISTING owner accounts only. Future registration
      // cannot acquire a role by claiming an email address or username.
      const identifiers = new Set(["slrochford123@protonmail.com", "slrochford123", "slrochford",
        ...(process.env.ADMIN_IDENTIFIERS || "").split(","), ...(process.env.ADMIN_EMAILS || "").split(",")]
        .map(value => value.trim().toLowerCase()).filter(Boolean));
      const explicitIds = new Set((process.env.ADMIN_USER_IDS || "").split(",").map(value => value.trim()).filter(Boolean));
      const grant = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role, granted_at) VALUES (?, 'admin', ?)");
      for (const user of db.prepare("SELECT id, email, username FROM users").all()) {
        if (explicitIds.has(user.id) || identifiers.has(String(user.email || "").toLowerCase()) || identifiers.has(String(user.username || "").toLowerCase())) {
          grant.run(user.id, new Date().toISOString());
        }
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

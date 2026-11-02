import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

const globalDb = globalThis as typeof globalThis & {__otg_db?: Database.Database; __otg_migrated?: boolean; __otg_migrating?: boolean};
let root: string;
afterEach(() => {
  globalDb.__otg_db?.close(); delete globalDb.__otg_db; delete globalDb.__otg_migrated; delete globalDb.__otg_migrating;
  vi.unstubAllEnvs(); vi.resetModules(); if (root) fs.rmSync(root, {recursive:true,force:true});
});
describe("durable administrator authority", () => {
  it("migrates the existing owner once, never grants new users authority from a matching name", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(),"audit-roles-")); vi.stubEnv("OTG_DATA_DIR",root); vi.resetModules();
    const seed = new Database(path.join(root,"otg.db"));
    seed.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,created_at TEXT,username TEXT)");
    seed.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run("existing-owner","owner@example.invalid","unused","2020-01-01","slrochford123"); seed.close();
    const {ensureMigrations,db} = await import("@/lib/auth/db"); const {isAdminUserId,isReservedAdminIdentifier} = await import("@/lib/auth/admin");
    ensureMigrations(); expect(isAdminUserId("existing-owner")).toBe(true);
    db.prepare("UPDATE users SET username='owner-renamed' WHERE id='existing-owner'").run();
    db.prepare("INSERT INTO users(id,email,password_hash,created_at,username) VALUES (?,?,?,?,?)").run("imposter","someone@example.invalid","unused","2026-01-01","slrochford123");
    delete globalDb.__otg_migrated; ensureMigrations();
    expect(isAdminUserId("existing-owner")).toBe(true); expect(isAdminUserId("imposter")).toBe(false);
    expect(isReservedAdminIdentifier("SLROCHFORD123")).toBe(true);
    expect(db.prepare("PRAGMA quick_check").get().quick_check).toBe("ok");
    const {enforceRequestLimit} = await import("@/lib/auth/requestLimits");
    enforceRequestLimit("login", "same-user", 1, 60000);
    vi.resetModules(); const again = await import("@/lib/auth/requestLimits");
    expect(() => again.enforceRequestLimit("login", "same-user", 1, 60000)).toThrow();
  });
});

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("authenticated device sessions", () => {
  it("preserves existing device sessions when another device signs in", () => {
    const db = read("lib/auth/db.ts");
    const login = read("app/api/auth/login/route.ts");
    const jwt = read("lib/auth/jwt.ts");
    const logout = read("app/api/auth/logout/route.ts");
    expect(db).toContain("CREATE TABLE IF NOT EXISTS user_sessions");
    expect(db).toContain("INSERT OR IGNORE INTO user_sessions");
    expect(login).toContain("INSERT INTO user_sessions");
    expect(login).not.toContain("DELETE FROM user_sessions WHERE user_id = ? AND session_id <> ?");
    expect(jwt).toContain("FROM user_sessions WHERE user_id = ? AND session_id = ?");
    expect(jwt).toContain('process.env.OTG_ENV === "test"');
    expect(jwt).toContain("24 * 60 * 60 * 1000");
    expect(logout).toContain("DELETE FROM user_sessions WHERE user_id = ? AND session_id = ?");
  });
});

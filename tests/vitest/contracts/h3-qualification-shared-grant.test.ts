import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertH3QualificationSharedGrant } from "@/lib/workers/mediaGpuAdmission";

let directory: string;
let ledgerPath: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "h3-shared-grant-fixture-"));
  ledgerPath = path.join(directory, "admission.sqlite");
  const setup = new Database(ledgerPath);
  try {
    setup.exec(`CREATE TABLE grants(token INTEGER, gpu TEXT, owner TEXT);
      CREATE TABLE tickets(sequence INTEGER, gpu_mask INTEGER, state TEXT, owner TEXT);
      INSERT INTO grants VALUES (100,'rtx3090','owner-a'),(101,'rtx5060ti','owner-b');
      INSERT INTO tickets VALUES (200,1,'granted','owner-a'),(201,2,'granted','owner-b');`);
  } finally { setup.close(); }
});

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe("H3 shared RTX 3090 fencing proof", () => {
  it("recognizes only the live 3090 grant with its exact waiting ticket and owner", () => {
    expect(() => assertH3QualificationSharedGrant(ledgerPath, "owner-a", 200, 100)).not.toThrow();
    expect(() => assertH3QualificationSharedGrant(ledgerPath, "owner-a", 201, 100)).toThrow(/no longer current/);
    expect(() => assertH3QualificationSharedGrant(ledgerPath, "owner-a", 200, 101)).toThrow(/no longer current/);
    expect(() => assertH3QualificationSharedGrant(ledgerPath, "owner-b", 201, 101)).toThrow(/no longer current/);
  });

  it("fails closed for a missing ledger and never creates one", () => {
    const missing = path.join(directory, "missing.sqlite");
    expect(() => assertH3QualificationSharedGrant(missing, "owner-a", 200, 100)).toThrow();
    expect(fs.existsSync(missing)).toBe(false);
  });
});

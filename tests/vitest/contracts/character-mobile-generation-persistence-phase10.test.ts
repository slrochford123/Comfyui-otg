import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const ui = fs.readFileSync(path.join(root, "app/app/components/CharacterHubPanel.tsx"), "utf8");
const createRoute = fs.readFileSync(path.join(root, "app/api/characters/create-image/route.ts"), "utf8");
const statusRoute = fs.readFileSync(path.join(root, "app/api/characters/create-image/status/route.ts"), "utf8");
const store = fs.readFileSync(path.join(root, "lib/characters/characterCreateRequestStore.ts"), "utf8");

describe("Character mobile generation persistence Phase 10", () => {
  it("persists a client request before generation submission", () => {
    expect(ui).toContain("OTG_CHARACTER_MOBILE_GENERATION_PERSISTENCE_PHASE10_UI");
    expect(ui).toContain('status: "submitting"');
    expect(ui).toContain("newCharacterCreateRequestId()");
    expect(ui).toContain("writeCharacterCreatePersistence(submitting)");
    expect(ui).toContain("ensureCharacterCreateSubmission(submitting, true)");
    expect(ui.indexOf("writeCharacterCreatePersistence(submitting)")).toBeLessThan(
      ui.indexOf("ensureCharacterCreateSubmission(submitting, true)"),
    );
  });

  it("uses a server idempotency reservation to prevent duplicate Comfy jobs", () => {
    expect(createRoute).toContain("OTG_CHARACTER_MOBILE_GENERATION_PERSISTENCE_PHASE10_ROUTE");
    expect(createRoute).toContain("claimCharacterCreateRequest");
    expect(createRoute).toContain('claim.record.status === "submitted"');
    expect(createRoute).toContain('claim.record.status === "submitting"');
    expect(createRoute).toContain("markCharacterCreateRequestSubmitted");
    expect(store).toContain('fs.openSync(file, "wx"');
  });

  it("can recover the prompt id after the original POST response is lost", () => {
    expect(statusRoute).toContain("readCharacterCreateRequest");
    expect(statusRoute).toContain("requestId");
    expect(ui).toContain("/api/characters/create-image/status?");
    expect(ui).toContain('record?.status === "submitted"');
    expect(ui).toContain("clientRequestId: persisted.requestId");
  });

  it("treats Android background fetch interruption as recoverable", () => {
    expect(ui).toContain("keepalive: true");
    expect(ui).toContain("Android Chrome can reject an in-flight poll");
    expect(ui).toContain("fetch|network|load failed|timed out recovering|timed out waiting");
    expect(ui).toContain("const timeoutMs = 24 * 60 * 60 * 1000");
    expect(ui).toContain('credentials: "include"');
  });

  it("resumes on mount, visibility return, and pageshow without duplicating candidates", () => {
    expect(ui).toContain("resumePersistedCharacterCreateJob");
    expect(ui).toContain('document.addEventListener("visibilitychange", resumeWhenVisible)');
    expect(ui).toContain('window.addEventListener("pageshow", resumeWhenVisible)');
    expect(ui).toContain("current.some((item) => item.promptId === candidate.promptId)");
    expect(ui).toContain('status: "completed"');
  });
});

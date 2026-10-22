import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Store = typeof import("../../../lib/storyCreator/store");
type Actions = typeof import("../../../lib/storyCreator/visualActions");
let store: Store;
let actions: Actions;
let root = "";

describe("Storyteller conversational redesign behavior", () => {
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "otg-story-redesign-"));
    process.env.OTG_DATA_DIR = root;
    process.env.OTG_DATA_ROOT = root;
    vi.resetModules();
    store = await import("../../../lib/storyCreator/store");
    actions = await import("../../../lib/storyCreator/visualActions");
  });
  afterAll(() => {
    delete process.env.OTG_DATA_DIR;
    delete process.env.OTG_DATA_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("auto-saves ordinary details, creates conflicts, and does not restore deleted facts", () => {
    const ownerKey = "canon-owner";
    const project = store.createStoryCreatorProject({ ownerKey, title: "Bulk Review" });
    const first = store.addStoryCreatorMessage({ ownerKey, projectId: project.id, role: "user", content: "Cannonball is 23." });
    const initial = store.applyStoryExtraction({
      ownerKey, projectId: project.id, sourceMessageId: first.id,
      entities: [{ entityType: "character", name: "Cannonball" }],
      facts: [{ subjectName: "Cannonball", predicate: "age", valueText: "23", canonStatus: "suggestion" }],
      autoCanonizeNonconflicting: true,
    });
    expect(initial.factsAutoSaved).toBe(1);
    let facts = store.listStoryBibleFacts({ ownerKey, projectId: project.id });
    expect(facts).toHaveLength(1);
    expect(facts[0].canonStatus).toBe("canon");

    const conflictMessage = store.addStoryCreatorMessage({ ownerKey, projectId: project.id, role: "user", content: "Cannonball is 27." });
    const conflict = store.applyStoryExtraction({
      ownerKey, projectId: project.id, sourceMessageId: conflictMessage.id,
      facts: [{ subjectName: "Cannonball", predicate: "age", valueText: "27", canonStatus: "suggestion" }],
      autoCanonizeNonconflicting: true,
    });
    expect(conflict.factsAutoSaved).toBe(0);
    expect(conflict.conflictsCreated).toBe(1);

    const revised = store.reviseStoryCanonFact({ ownerKey, projectId: project.id, factId: facts[0].id, valueText: "24" });
    expect(revised.valueText).toBe("24");
    store.deleteStoryCanonFact({ ownerKey, projectId: project.id, factId: revised.id });
    const repeat = store.addStoryCreatorMessage({ ownerKey, projectId: project.id, role: "user", content: "Cannonball is 23." });
    const repeated = store.applyStoryExtraction({
      ownerKey, projectId: project.id, sourceMessageId: repeat.id,
      facts: [{ subjectName: "Cannonball", predicate: "age", valueText: "23", canonStatus: "suggestion" }],
      autoCanonizeNonconflicting: true,
    });
    expect(repeated.skipped).toContain("previously deleted detail: age");
    facts = store.listStoryBibleFacts({ ownerKey, projectId: project.id });
    expect(facts.some((fact) => fact.valueText === "23")).toBe(false);
  });

  it("asks concise Cannonball questions and never invents a sword", () => {
    const entity = { id: "cannonball", projectId: "p", ownerKey: "o", entityType: "character", name: "Cannonball", sourceRole: "user" as const, sourceMessageId: null, createdAt: 1, updatedAt: 1 };
    const fact = (predicate: string, valueText: string) => ({ id: `${predicate}-${valueText}`, projectId: "p", ownerKey: "o", subjectEntityId: entity.id, predicate, valueText, objectEntityId: null, canonStatus: "canon" as const, sourceRole: "user" as const, sourceMessageId: null, supersedesFactId: null, createdAt: 1, updatedAt: 1 });
    const facts = [fact("age", "23"), fact("gender", "male"), fact("powers", "super strength and super speed"), fact("fighting_behavior", "rushes and tackles enemies"), fact("team", "small vigilante team")];
    const first = actions.resolveStoryVisualDirectorAction({ instruction: "Create the image.", conversationContext: "Let's design Cannonball.", entities: [entity], facts, assets: [], plan: null });
    expect(first.action).toBe("clarify");
    expect(first.questions[0]).toContain("photorealistic");
    expect(first.questions[0]).toContain("costume");

    const sword = actions.resolveStoryVisualDirectorAction({ instruction: "Show me Cannonball's sword.", entities: [entity], facts, assets: [], plan: null });
    expect(sword.action).toBe("clarify");
    expect(sword.questions[0]).toContain("haven't established");

    const ready = actions.resolveStoryVisualDirectorAction({
      instruction: "Create the image.",
      conversationContext: "user: He has oversized fists and a dark red armored costume in a photorealistic cinematic style.",
      entities: [entity], facts, assets: [], plan: null,
    });
    expect(ready.action).toBe("prepare-generation");
    expect(ready.prompt).toContain("oversized fists");
    expect(ready.prompt).toContain("dark red armored costume");
    expect(ready.prompt).not.toContain("small vigilante team");
    expect(ready.prompt).not.toContain("rushes and tackles");
  });

  it("uses an environmental strategy for locations", () => {
    const forest = { id: "forest", projectId: "p", ownerKey: "o", entityType: "location", name: "Mysterious Forest", sourceRole: "user" as const, sourceMessageId: null, createdAt: 1, updatedAt: 1 };
    const action = actions.resolveStoryVisualDirectorAction({ instruction: "Create an image of the mysterious forest at dusk.", entities: [forest], facts: [], assets: [], plan: null });
    expect(action.action).toBe("prepare-generation");
    expect(action.prompt).toContain("environmental image");
    expect(action.prompt).not.toMatch(/neutral studio|isolated object/i);
  });

  it("does not copy older narrative turns into a current visual design", () => {
    const entity = { id: "blair", projectId: "p", ownerKey: "o", entityType: "character", name: "Blair", sourceRole: "user" as const, sourceMessageId: null, createdAt: 1, updatedAt: 1 };
    const action = actions.resolveStoryVisualDirectorAction({
      instruction: "He has a black, orange, and white armored suit with bullseyes. Show him as an anime character.",
      conversationContext: [
        "user: Blair ate carrots because his mother said they would improve his vision.",
        "assistant: His mutant powers help him defeat villains with bombs and unconventional methods.",
      ].join("\n"),
      entities: [entity], facts: [], assets: [], plan: null,
    });
    expect(action.action).toBe("prepare-generation");
    expect(action.prompt).toContain("black, orange, and white armored suit");
    expect(action.prompt).toContain("anime character");
    expect(action.prompt).not.toMatch(/carrots|mother|mutant powers|defeat villains|bombs/i);
  });
});

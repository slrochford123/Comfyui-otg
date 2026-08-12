// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CHARACTER_CANDIDATE_EDIT_CONTRACT,
  CHARACTER_EDIT_PRESERVATION_TEXT,
  appendCharacterEditCandidate,
  characterCardPersistenceFields,
  characterEditSubmissionFields,
  composeCharacterEditInstruction,
  nextCharacterEditLineage,
} from "@/lib/characters/characterCandidateFlow";

describe("Character candidate Modify/Edit flow", () => {
  it("submits the chosen image through the verified Qwen Edit 2509 contract", () => {
    const result = characterEditSubmissionFields({
      sourceServerPath: "/data/characters/candidate-2.png",
      requestedChange: "Change the jacket to blue.",
      negativePrompt: "red jacket",
      seed: "12345",
    });

    expect(result.fields).toMatchObject({
      workflowId: "presets/Edit Image",
      imageAPath: "/data/characters/candidate-2.png",
      loadImageNodeId: "78",
      requestKind: "character-candidate-edit",
      negativePrompt: "red jacket",
      seed: "12345",
      saveToGallery: "false",
      skipGeneralGallery: "true",
      galleryExclusionPolicy: "character-candidate-edit-only",
    });
  });

  it("uses only the requested change plus the reviewed preservation wording", () => {
    expect(
      composeCharacterEditInstruction("  Add a silver   necklace. "),
    ).toBe(
      `Add a silver necklace. ${CHARACTER_EDIT_PRESERVATION_TEXT}`,
    );
  });

  it("appends edits without replacing their source and preserves chained lineage", () => {
    const original = {
      id: "candidate-a",
      label: "Original",
    };

    const first = {
      id: "candidate-b",
      label: "Edited",
      ...nextCharacterEditLineage(original, "first"),
    };

    expect(
      appendCharacterEditCandidate([original], first),
    ).toEqual([original, first]);

    expect(
      nextCharacterEditLineage(first, "second"),
    ).toEqual({
      sourceCandidateId: "candidate-b",
      rootCandidateId: "candidate-a",
      editDepth: 2,
      editInstruction: "second",
    });
  });

  it("documents the official template nodes and expanded-graph runtime output", () => {
    expect(
      CHARACTER_CANDIDATE_EDIT_CONTRACT,
    ).toMatchObject({
      verifiedTemplateName: "image_qwen_image_edit_2509.json",
      positiveNodeId: "433:111",
      negativeNodeId: "433:110",
      verifiedTemplateOutputNodeId: "469",
      runtimeOutputNodeId: "60",
    });
  });

  it("binds edit text verbatim without the Production Next Scene adapter", () => {
    const route = fs.readFileSync(
      path.join(
        process.cwd(),
        "app/api/comfy/route.ts",
      ),
      "utf8",
    );

    expect(route).toContain(
      'setNodeIfPresent(graph, "433:111", { prompt: positiveText });',
    );

    expect(route).toContain(
      'Do not apply the Production "Next Scene" prompt adapter here.',
    );

    expect(route).toContain(
      "Character candidate edit positive instruction was not bound verbatim to node 433:111.",
    );

    expect(route).toContain(
      "Character candidate edit negative prompt was not bound to node 433:110.",
    );
  });
});

describe("Character Card step and persistence", () => {
  it("keeps the processed default/profile image separate from the card sheet", () => {
    expect(
      characterCardPersistenceFields(
        "/characters/processed.png",
        "/characters/card.png",
      ),
    ).toMatchObject({
      imagePath: "/characters/processed.png",
      previewImagePath: "/characters/processed.png",
      defaultCharacterImagePath: "/characters/processed.png",
      backgroundRemovedDefaultImagePath:
        "/characters/processed.png",
      characterCardPath: "/characters/card.png",
      characterCardWorkflowImagePath:
        "/characters/card.png",
    });
  });

  it("uses the fixed eight-panel workflow and current eight-view master-sheet contract", () => {
    const workflow = JSON.parse(
      fs
        .readFileSync(
          path.join(
            process.cwd(),
            "comfy_workflows/presets/character_card_8_angles_low_angle.json",
          ),
          "utf8",
        )
        .replace(/^\uFEFF/, ""),
    );

    const prompts = [
      "428:151",
      "429:228",
      "430:253",
      "431:278",
      "432:303",
      "433:328",
      "434:353",
      "435:405",
    ].map((nodeId) =>
      String(workflow[nodeId]?.inputs?.prompt || ""),
    );

    const combined = prompts.join(" ");

    expect(combined).toContain(
      "front view eye-level shot wide shot",
    );
    expect(combined).toContain(
      "back view eye-level shot wide shot",
    );
    expect(combined).toContain(
      "left side view eye-level shot wide shot",
    );
    expect(combined).toContain(
      "right side view eye-level shot wide shot",
    );
    expect(combined).toContain(
      "front view eye-level shot close-up",
    );
    expect(combined).toContain(
      "back view eye-level shot close-up",
    );
    expect(combined).toContain(
      "front-left quarter view eye-level shot close-up",
    );
    expect(combined).toContain(
      "front-right quarter view eye-level shot close-up",
    );

    expect(workflow["436"]?.class_type).toBe(
      "ImageStitch",
    );
    expect(workflow["439"]?.class_type).toBe(
      "SaveImage",
    );
  });

  it("wires the active port-3003 hub to real guarded edit/card handlers", () => {
    const hub = fs.readFileSync(
      path.join(
        process.cwd(),
        "app/app/components/CharacterHubPanel.tsx",
      ),
      "utf8",
    );

    const controls = fs.readFileSync(
      path.join(
        process.cwd(),
        "app/app/components/CharacterCandidateRuntimeControls.tsx",
      ),
      "utf8",
    );

    expect(hub).toContain(
      "candidateEditInFlightRef.current",
    );
    expect(hub).toContain(
      "characterCardInFlightRef.current",
    );

    expect(hub + controls).toContain(
      "Continue to Character Card",
    );
    expect(hub + controls).toContain(
      "Accept Character Card",
    );
    expect(hub + controls).toContain(
      "Back to Candidates",
    );

    expect(hub).toContain(
      "The source and candidates are preserved; retry with Create Character Card.",
    );
  });
});

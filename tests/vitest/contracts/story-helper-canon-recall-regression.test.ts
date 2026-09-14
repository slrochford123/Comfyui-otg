import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/ollama-ai/chat/route.ts",
  ),
  "utf8",
);

describe("Story Helper canon recall regression contract", () => {
  it("recognizes pure canon-recall requests separately from normal brainstorming", () => {
    expect(routeSource).toContain(
      "const creativeRequestPatterns: RegExp[]",
    );

    expect(routeSource).toContain(
      "const canonRecallPatterns: RegExp[]",
    );

    expect(routeSource).toContain(
      "!creativeRequested",
    );

    expect(routeSource).toContain(
      "canonRecallPatterns.some",
    );
  });

  it("gives explicit strict wording precedence over creative wording", () => {
    const strictDecision = routeSource.indexOf(
      'if (strictPatterns.some((pattern) => pattern.test(text)))',
    );

    const creativePatterns = routeSource.indexOf(
      "const creativeRequestPatterns: RegExp[]",
    );

    expect(strictDecision).toBeGreaterThan(-1);
    expect(creativePatterns).toBeGreaterThan(strictDecision);
  });

  it("covers established-fact summary and recall language", () => {
    expect(routeSource).toContain(
      "summari[sz]e",
    );

    expect(routeSource).toContain(
      "established\\s+facts?",
    );

    expect(routeSource).toContain(
      "canon\\s+so\\s+far",
    );
  });

  it("forbids embellishment inside canon statements even in optional mode", () => {
    expect(routeSource).toContain(
      "Any sentence or section that summarizes, restates, lists, identifies, or describes established canon must contain only facts supported by the user's evidence.",
    );

    expect(routeSource).toContain(
      "Do not decorate canon statements with invented adjectives, motives, implications, causes, history, atmosphere, personality traits, or backstory.",
    );
  });

  it("keeps mixed canon recall and brainstorming separated", () => {
    expect(routeSource).toContain(
      "If a response contains both canon recall and creative proposals, keep those sections clearly separated.",
    );

    expect(routeSource).toContain(
      "that portion must contain only user-supported facts even when the overall request also includes brainstorming.",
    );
  });
  it("omits unsupported assistant-only material from canon sections instead of discussing its rejection", () => {
    expect(routeSource).toContain(
      "When writing a CANON section, omit unsupported assistant-authored details entirely.",
    );

    expect(routeSource).toContain(
      "Do not mention an unsupported assistant suggestion inside CANON even to say it was proposed, rejected, unconfirmed, removed, or non-canon.",
    );

    expect(routeSource).toContain(
      "Treat unaccepted assistant-authored names and details as forbidden content inside a CANON section; omit them completely rather than discussing their status.",
    );
  });

});

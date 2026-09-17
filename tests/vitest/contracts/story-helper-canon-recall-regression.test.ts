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


  it("preserves the user's level of specificity when stating established canon", () => {
    expect(routeSource).toContain(
      "preserve the user's meaning and level of specificity",
    );

    expect(routeSource).toContain(
      "'character' does not mean 'protagonist'",
    );

    expect(routeSource).toContain(
      "'Boston' must remain 'Boston' rather than 'Boston, MA'",
    );

    expect(routeSource).toContain(
      "A generic 'character' is not an established protagonist",
    );

    expect(routeSource).toContain(
      "A location such as 'Boston' must remain at that specificity inside canon recall.",
    );
  });

  it("keeps inferred specificity available only as reasoning or suggestions", () => {
    expect(routeSource).toContain(
      "clearly labeled reasoning or suggestions",
    );

    expect(routeSource).toContain(
      "Such interpretations may appear only as clearly labeled reasoning or suggestions unless the user adopts them.",
    );
  });


  it("does not infer pronouns or identity attributes from a character name", () => {
    expect(routeSource).toContain(
      "Do not infer a character's sex, gender, pronouns, age, nationality, ethnicity, title, family role",
    );

    expect(routeSource).toContain(
      "If the user has not established pronouns, avoid gendered pronouns",
    );

    expect(routeSource).toContain(
      "If pronouns were not established by the user, avoid gendered pronouns in strict canon output.",
    );
  });

  it("uses neutral wording when pronouns are unresolved", () => {
    expect(routeSource).toContain(
      "use the character's name or neutral wording instead",
    );

    expect(routeSource).toContain(
      "remove unsupported gendered pronouns from canon statements",
    );
  });


  it("deterministically rejects unsupported gendered pronouns in strict canon output", () => {
    expect(routeSource).toContain(
      "STORY_HELPER_GENDERED_PRONOUN_PATTERN",
    );

    expect(routeSource).toContain(
      "strictCanonHasUnsupportedGenderedPronoun",
    );

    expect(routeSource).toContain(
      'message.role === "user"',
    );

    expect(routeSource).toContain(
      'mode === "strict"',
    );
  });

  it("repairs a strict response once before failing closed", () => {
    expect(routeSource).toContain(
      "repairStrictCanonPronouns",
    );

    expect(routeSource).toContain(
      "The user evidence contains no established gendered pronouns.",
    );

    expect(routeSource).toContain(
      "Do not list unestablished categories merely to say they are unknown.",
    );

    expect(routeSource).toContain(
      "without introducing an unsupported identity detail.",
    );
  });


  it('classifies "using only what I established" as strict canon', () => {
    expect(routeSource).toContain(
      "(?:use|using|include|including|continue with)",
    );

    const strictUsingOnlyPattern =
      /\b(?:use|using|include|including|continue with)\s+only\s+(?:what|the\s+(?:established|existing|confirmed|given|user-provided))\b/i;

    expect(
      strictUsingOnlyPattern.test(
        "Using only what I established, summarize Lena Hart.",
      ),
    ).toBe(true);

    expect(
      strictUsingOnlyPattern.test(
        "Using only what I established summarize Lena Hart.",
      ),
    ).toBe(true);
  });

});

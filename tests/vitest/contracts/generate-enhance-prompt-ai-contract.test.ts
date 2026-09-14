import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function sha256(relativePath: string) {
  return crypto
    .createHash("sha256")
    .update(read(relativePath))
    .digest("hex");
}

const route = read("app/api/enhance-prompt/route.ts");
const app = read("app/app/AppPageClient.tsx");

describe("Generate Enhance Prompt AI contract", () => {
  it("uses the durable Qwen cluster path without heuristic success fallback", () => {
    expect(route).toMatch(
      /qwenDurableFetch\(\s*"\/api\/generate"/,
    );

    expect(route).not.toContain(
      "OLLAMA_PROMPT_ENHANCE_PROVIDER",
    );

    expect(route).not.toContain(
      "function heuristicEnhancePrompt",
    );

    expect(route).not.toContain(
      'provider = "heuristic"',
    );

    expect(route).not.toContain(
      "used fast enhancer fallback",
    );

    for (const cannedPhrase of [
      "polished cinematic visual style",
      "clear subject focus",
      "refined lighting",
      "smooth motion",
      "temporal consistency",
    ]) {
      expect(route).not.toContain(cannedPhrase);
    }
  });

  it("sends the real user prompt, requested depth, and Generate context to Qwen", () => {
    expect(route).toContain(
      "buildQwenEnhancePrompt",
    );

    expect(route).toContain(
      "Original user prompt:",
    );

    expect(route).toContain(
      "Requested enhancement level:",
    );

    expect(route).toContain(
      "Generate context:",
    );

    for (const field of [
      "mediaMode",
      "imageOperation",
      "videoGenerationType",
      "workflowId",
      "styleLabel",
      "stylePrompt",
    ]) {
      expect(route).toContain(field);
      expect(app).toContain(field);
    }

    expect(app).toContain(
      "mediaMode: options?.mediaMode || generateMediaMode",
    );

    expect(app).toContain(
      "imageOperation: options?.imageOperation || imageOperation",
    );

    expect(app).toContain(
      "videoGenerationType: options?.videoGenerationType || videoGenerationType",
    );

    expect(app).toContain(
      "workflowLabel: options?.workflowLabel || selectedWorkflow.label",
    );

    expect(app).toContain(
      "selectedStyleId: options?.selectedStyleId || \"\"",
    );
  });

  it("gives Short, Medium, and Long materially different AI instructions", () => {
    expect(route).toContain(
      "SHORT purpose: clean and lightly improve the user's idea.",
    );

    expect(route).toContain(
      "MEDIUM purpose: create a strong production-ready generation prompt.",
    );

    expect(route).toContain(
      "LONG purpose: create a detailed cinematic generation prompt while staying faithful to the original idea.",
    );

    expect(route).toContain(
      "Short must not be a keyword dump or a generic suffix.",
    );

    expect(route).toContain(
      "Medium must be materially richer than Short.",
    );

    expect(route).toContain(
      "Long must be substantially richer than Medium without meaningless padding.",
    );

    expect(app).toContain(
      'const [enhancePromptLevel, setEnhancePromptLevel] = useState<"short" | "medium" | "long">("medium");',
    );

    expect(app).toContain(
      '(["short", "medium", "long"] as const).map',
    );

    expect(app).not.toContain(
      '(["short", "medium", "cinematic"] as const).map',
    );
  });

  it("keeps image and video enhancement instructions context-aware", () => {
    expect(route).toContain(
      "IMAGE context:",
    );

    expect(route).toContain(
      "composition, subject appearance, environment, lighting, framing",
    );

    expect(route).toContain(
      "Do not add video-only language to image prompts unless the user explicitly asks for motion.",
    );

    expect(route).toContain(
      "VIDEO context:",
    );

    expect(route).toContain(
      "motion, camera movement, action progression, and temporal behavior",
    );

    const imageContextIndex = route.indexOf("IMAGE context:");
    const videoContextIndex = route.indexOf("VIDEO context:");
    expect(imageContextIndex).toBeGreaterThan(-1);
    expect(videoContextIndex).toBeGreaterThan(imageContextIndex);

    const imageContext = route.slice(imageContextIndex, videoContextIndex);
    expect(imageContext).not.toContain("temporal consistency");
    expect(imageContext).not.toContain("coherent character movement");
  });

  it("normalizes prompt boundaries without damaging intentional internal punctuation", () => {
    expect(route).toContain(
      "normalizePromptInput",
    );

    expect(route).toContain(
      "remove accidental duplicated trailing punctuation",
    );

    expect(route).toContain(
      "a prompt ending in a comma will not become ',,' when context is added",
    );

    expect(route).not.toContain(
      'const base = cleanText(prompt).replace(/[. ]+$/, "");',
    );
  });

  it("fails closed when Qwen fails or returns no enhancement text", () => {
    expect(route).toContain(
      "Prompt enhancer returned no text.",
    );

    expect(route).toContain(
      "The original prompt was preserved.",
    );

    expect(route).toMatch(
      /if \(!response\.ok\) \{\s*throw new Error/s,
    );

    expect(route).toMatch(
      /return Response\.json\(\s*\{\s*ok: false/s,
    );

    expect(route).not.toMatch(
      /catch\s*\([^)]*\)\s*\{[\s\S]*enhancedPrompt\s*=/,
    );

    expect(app).toContain(
      "if (!res.ok || data?.ok === false)",
    );
  });

  it("keeps the active Generate client failure path from replacing the prompt", () => {
    const start = app.indexOf(
      "async function handleEnhancePrompt()",
    );
    const end = app.indexOf(
      "function handleGenerateStyleDropdownChange",
      start,
    );

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const handler = app.slice(start, end);
    const enhanceIndex = handler.indexOf(
      "const nextPrompt = await enhancePromptText",
    );
    const undoIndex = handler.indexOf(
      "pushPromptUndoSnapshot(prompt)",
    );
    const replaceIndex = handler.indexOf(
      "setPrompt(nextPrompt)",
    );
    const catchIndex = handler.indexOf(
      "catch (error)",
    );

    expect(enhanceIndex).toBeGreaterThan(-1);
    expect(undoIndex).toBeGreaterThan(enhanceIndex);
    expect(replaceIndex).toBeGreaterThan(undoIndex);
    expect(catchIndex).toBeGreaterThan(replaceIndex);

    const catchBlock = handler.slice(catchIndex);
    expect(catchBlock).not.toContain("setPrompt(");
    expect(catchBlock).not.toContain("pushPromptUndoSnapshot");
  });

  it("leaves the accepted LTX 2.5 workflow files byte-stable", () => {
    expect(
      sha256("comfy_workflows/presets/LTX 2.5 Text To Video.json"),
    ).toBe(
      "681d35b8743e589f2f5c5acda049dbb4fa4378497cf9a4f17fd1a7d6e8a1148c",
    );

    expect(
      sha256("comfy_workflows/presets/LTX 2.5 Image To Video.json"),
    ).toBe(
      "d97012afbc805ad8fab681fbfc9e26c2e98ad062d9c9b8d612ac08c181e1b56a",
    );

    expect(
      sha256("comfy_workflows/presets/LTX 2.5 First Last Frame Video.json"),
    ).toBe(
      "ae9af1357c5187cb9fb7970bc1e91b2dcdeeca880cd3e56966f051e2fbfd5888",
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";

import { POST } from "@/app/api/openai-ai/h3-director/route";
import { compileH3SceneDirection, h3SceneDirectionInstructions, validateH3DirectedDialogue, validateH3DirectedPrompt, type H3SceneDirectionContext } from "@/lib/openai/h3SceneDirection";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), resolve: vi.fn(), persist: vi.fn(), smart: vi.fn() }));
vi.mock("@/lib/sessionUser", () => ({ requireSessionUser: async () => ({ ownerKey: "owner", accountId: "account", admin: true }) }));
vi.mock("@/lib/openai/provider", () => ({ openAIModels: () => ({ h3: "gpt-6-luna" }) }));
vi.mock("@/lib/workers/assistantProvider", () => ({
  createAssistantText: mocks.provider,
  resolveReviewedAssistantProvider: mocks.resolve,
  withAssistantProvider: (_provider: string, run: () => unknown) => run(),
}));
vi.mock("@/lib/openai/h3DirectorStore", () => ({
  getH3DirectorConversation: () => ({ id: "older-chat", promptVersions: [{ prompt: "An unrelated prior scene with invented lore." }] }),
  upsertH3DirectorConversation: mocks.persist,
}));
vi.mock("@/lib/h3LoraCatalogServer", () => ({ validateH3LoraSelections: () => ({ resolved: [] }) }));
vi.mock("@/lib/h3SmartReferencesServer", () => ({ characterRefSelectionBackend: async () => "rtx3090", makeH3SmartReferenceInput: mocks.smart }));

const text: H3SceneDirectionContext = { mode: "h3-text-to-video", durationSeconds: 5, firstImage: false, lastImage: false, pictures: 0, videos: 0, audios: 0 };
const image: H3SceneDirectionContext = { ...text, mode: "h3-image-to-video", firstImage: true, lastImage: true };
const reference: H3SceneDirectionContext = { ...text, mode: "h3-reference-to-video", pictures: 1 };
const shots = [
  { startSeconds: 0, transition: "cut", direction: "A paper boat trembles at the edge of the puddle." },
  { startSeconds: 2.25, transition: "cut", direction: "A close view follows the boat as it drifts away." },
];
const base = { shots, soundscape: "Rain taps the pavement.", music: "N/A" };
const full = { ...base, subjectDefinitions: "<Subject 1> is the paper boat in <Picture 1>.", summary: "[reference generation] The boat drifts away.", retentionAnalysis: "<Subject 1>: fully_preserved; keep the shape." };

function request(body: Record<string, unknown>) {
  return new NextRequest("http://example.test/api/openai-ai/h3-director", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockImplementation(value => value === "local3060" ? "local3060" : "openai");
  mocks.provider.mockResolvedValue({ text: JSON.stringify(base), provider: "openai", model: "gpt-6-luna" });
  mocks.persist.mockReturnValue({ id: "chat", promptVersions: [] });
});

describe("MiniMax H3 scene direction", () => {
  it("compiles distinct mode sections and validates the actual frame configuration", () => {
    const textResult = compileH3SceneDirection(JSON.stringify(base), text, { styleLabel: "1980s Anime" });
    expect(textResult.prompt).toContain("integrated_multimodal_description: [Shot 1] 1980s Anime visual style.");
    expect(textResult.prompt).toContain("[Shot 2] At 00:02.250, the camera cuts to");
    const imageResult = compileH3SceneDirection(JSON.stringify(base), image);
    expect(imageResult.prompt.split("\n")[0]).toContain("Picture 2 (from Shot 2) aligns with the 5.00-second mark");
    expect(() => validateH3DirectedPrompt(imageResult.prompt, { ...image, lastImage: false })).toThrow(/align/);
    const referenceResult = compileH3SceneDirection(JSON.stringify(full), reference);
    expect(referenceResult.prompt).toMatch(/^subject_definitions:/);
    expect(referenceResult.prompt).toContain("\n\nretention_analysis:\n");
    expect(() => validateH3DirectedPrompt(referenceResult.prompt.replaceAll("<Picture 1>", "<Picture 2>"), reference)).toThrow(/without a matching/);
  });

  it.each(["fully_preserved", "partially_preserved", "[fully_preserved]", "weak_reference"])("compiles reference task metadata when the model confuses %s with a summary", summary => {
    const result = compileH3SceneDirection(JSON.stringify({ ...full, summary }), reference);
    expect(result.prompt).toContain("summary:\n[reference generation]\n\nretention_analysis:");
    expect(result.prompt).toContain(full.retentionAnalysis);
    expect(result.prompt).toContain(full.subjectDefinitions);
    expect(result.prompt).toContain(shots[0].direction);
    expect(() => validateH3DirectedPrompt(result.prompt, reference)).not.toThrow();
  });

  it("adds only the task marker to unlabelled model prose without rewriting it", () => {
    const result = compileH3SceneDirection(JSON.stringify({ ...full, summary: "The boat drifts away." }), reference);
    expect(result.prompt).toContain("summary:\n[reference generation] The boat drifts away.");
    expect(result.prompt).not.toContain("<Audio");
    expect(() => validateH3DirectedPrompt(result.prompt.replaceAll("<Picture 1>", "<Picture 2>"), reference)).toThrow(/without a matching/);
  });

  it("uses keyframe completion for an opening-only reference and preserves valid existing labels", () => {
    const opening = { ...reference, firstImage: true, pictures: 0 };
    const result = compileH3SceneDirection(JSON.stringify({ ...full, summary: "fully_preserved", subjectDefinitions: "<Subject 1> is the paper boat in the opening guide." }), opening);
    expect(result.prompt).toContain("summary:\n[keyframe completion]");
    expect(compileH3SceneDirection(JSON.stringify({ ...full, summary: "[reference generation] Use the opening guide.", subjectDefinitions: "<Subject 1> is the boat in the opening guide." }), opening).prompt).toContain("summary:\n[keyframe completion] Use the opening guide.");
    expect(compileH3SceneDirection(JSON.stringify({ ...full, summary: "[keyframe completion] Preserve the selected picture." }), reference).prompt).toContain("summary:\n[reference generation] Preserve the selected picture.");
    const existing = "[reference generation + audio reference] Preserve the requested scene.";
    expect(compileH3SceneDirection(JSON.stringify({ ...full, summary: existing }), reference).prompt).toContain(existing);
    expect(() => compileH3SceneDirection(JSON.stringify({ ...full, summary: "" }), reference)).toThrow(/summary empty/);
  });

  it("declares physically selected inputs when the model omits a binding, without inventing identity", () => {
    const result = compileH3SceneDirection(JSON.stringify({ ...full, subjectDefinitions: "A paper boat.", retentionAnalysis: "Keep the paper boat unchanged." }), reference);
    expect(result.prompt).toContain("A paper boat.\n<Picture 1> is a selected image reference for this scene.");
    expect(result.prompt).not.toContain("<Audio");
    expect(result.prompt).not.toContain("<Subject");
    expect(h3SceneDirectionInstructions(reference)).toContain("belong only in retentionAnalysis");
    expect(() => compileH3SceneDirection(JSON.stringify({ ...full, subjectDefinitions: "The boat uses <Picture 2>." }), reference)).toThrow(/without a matching/);
  });

  it("does not add phantom media to an opening-only reference", () => {
    const context = { ...reference, pictures: 0, firstImage: true };
    const result = compileH3SceneDirection(JSON.stringify({ ...full, subjectDefinitions: "The boat is in the opening guide.", retentionAnalysis: "Keep the boat unchanged." }), context);
    expect(result.prompt).not.toContain("<Picture");
    expect(result.prompt).not.toContain("selected image reference");
  });

  it("rejects commentary, invalid cuts and incorrect continuous-shot output", () => {
    expect(() => compileH3SceneDirection("Here is a summary of your prompt", text)).toThrow(/invalid scene/);
    expect(() => compileH3SceneDirection(JSON.stringify({ ...base, shots: [shots[0], { ...shots[1], startSeconds: 5 }] }), text)).toThrow(/outside/);
    expect(() => compileH3SceneDirection(JSON.stringify(base), text, { shotFlow: "One continuous shot" })).toThrow(/multiple shots/);
  });

  it("preserves exact spoken words across a cut and catches repetition", () => {
    const draft = 'Jules says, "Look at the rain."';
    const directed = "Jules (S1) says: <d>[English] Look at <scenetrans></d>\nJules (S1) continues: <d>[English] <scenetrans>the rain.</d>";
    expect(() => validateH3DirectedDialogue(draft, directed)).not.toThrow();
    expect(() => validateH3DirectedDialogue(draft, directed.replace("rain.", "clouds."))).toThrow(/spoken words/);
    expect(() => validateH3DirectedDialogue(draft, directed + "\n<d>[English] Look at the rain.</d>")).toThrow(/spoken words/);
  });

  it("passes only the selected style and draft into a new request", async () => {
    const response = await POST(request({ mode: text.mode, durationSeconds: 5, message: "A paper boat drifts away.", stylePresetId: "1980s-anime", conversationId: "older-chat" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.prompt).toContain("1980s Anime visual style");
    expect(result.promptFormat).toBe("minimax-official-v1");
    const sent = mocks.provider.mock.calls[0][0];
    expect(sent.responseSchema.schema.additionalProperties).toBe(false);
    expect(sent.input[0].content).toContain("Hand-inked cels");
    expect(sent.input[0].content).not.toContain("unrelated prior scene");
  });

  it("keeps first-image evidence out of cloud input unless expressly enabled", async () => {
    const jpeg = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#113399" } }).jpeg().toBuffer();
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    const body = { mode: image.mode, durationSeconds: 5, message: "A paper boat drifts away.", firstImageName: "boat.jpg", visualInputs: [{ label: "First Image", dataUrl }] };
    const textOnly = await POST(request(body));
    expect(textOnly.status).toBe(200);
    expect((await textOnly.json()).visualInputsUsed).toBe(0);
    expect(JSON.stringify(mocks.provider.mock.calls[0][0].input)).not.toContain(dataUrl);
    expect(JSON.stringify(mocks.provider.mock.calls[0][0].localVariant.input)).toContain(dataUrl);
    const consented = await POST(request({ ...body, externalMediaConsent: true }));
    expect((await consented.json()).visualInputsUsed).toBe(1);
    expect(mocks.provider.mock.calls[1][0].input[0].content).toContainEqual({ type: "input_image", image_url: dataUrl, detail: "low" });
    expect(mocks.provider.mock.calls[1][0].store).toBe(false);
  });

  it("binds owner-selected Smart reference labels and rejects a changed opening guide", async () => {
    mocks.smart.mockResolvedValue({ firstFrame: { name: "start.jpg", description: "Opening frame" }, referenceMap: [{ tag: "<Picture 1>", name: "Boat character", description: "A paper boat", kind: "image", source: "refmod" }] });
    mocks.provider.mockResolvedValue({ text: JSON.stringify(full), provider: "openai", model: "gpt-6-luna" });
    const response = await POST(request({ mode: reference.mode, durationSeconds: 5, message: "A paper boat drifts away.", firstImageName: "start.jpg", smartReferences: { useFirstFrame: true, refMods: [] } }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.prompt).toContain("Use the supplied opening guide");
    expect(mocks.provider.mock.calls[0][0].input[0].content).toContain("Boat character");
    expect(() => validateH3DirectedPrompt(result.prompt, reference)).toThrow(/opening guide/);
  });

  it("carries saved identity and voice IDs into Direct and rejects a swapped audio binding", async () => {
    mocks.smart.mockResolvedValue({ firstFrame: null, referenceMap: [
      { tag: "<Picture 1>", name: "Rae", description: "Cast visual", kind: "image", source: "refmod", characterKey: "rae-id", characterName: "Rae" },
      { tag: "<Picture 2>", name: "Jo", description: "Cast visual", kind: "image", source: "refmod", characterKey: "jo-id", characterName: "Jo" },
      { tag: "<Audio 1>", name: "Rae", description: "Saved voice", kind: "audio", source: "refmod", characterKey: "rae-id", characterName: "Rae", voiceId: "rae-voice" },
      { tag: "<Audio 2>", name: "Jo", description: "Saved voice", kind: "audio", source: "refmod", characterKey: "jo-id", characterName: "Jo", voiceId: "jo-voice" },
    ] });
    const directed = {
      ...full,
      subjectDefinitions: "<Subject 1> is Rae from <Picture 1>.\n<Subject 2> is Jo from <Picture 2>.\n<Audio 1> is the voice for <Subject 1> (S2).\n<Audio 2> is the voice for <Subject 2> (S1).",
      shots: [{ startSeconds: 0, transition: "cut", direction: "<Subject 2> (S1) says using <Audio 2>: <d>[English] Go.</d> <Subject 1> (S2) says using <Audio 1>: <d>[English] Wait.</d>" }],
    };
    const body = { mode: reference.mode, durationSeconds: 5, message: 'Jo says, "Go." Rae says, "Wait."', smartReferences: { useFirstFrame: false, refMods: [] } };
    mocks.provider.mockResolvedValue({ text: JSON.stringify(directed), provider: "openai", model: "gpt-6-luna" });
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.provider.mock.calls[0][0].input[0].content).toContain('"voiceId":"rae-voice"');
    expect(mocks.provider.mock.calls[0][0].input[0].content).toContain('"characterKey":"jo-id"');
    const broken = { ...directed, shots: directed.shots.map(shot => ({ ...shot, direction: shot.direction.replace("S1) says using <Audio 2>", "S1) says using <Audio 1>") })) };
    mocks.provider.mockResolvedValue({ text: JSON.stringify(broken), provider: "openai", model: "gpt-6-luna" });
    const rejected = await POST(request(body));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toMatch(/different voice to Jo/);
  });
});

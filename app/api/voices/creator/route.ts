import { NextRequest, NextResponse } from "next/server";
import path from "node:path";

import { resolveVoiceComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { SessionInvalidError, getOwnerContext } from "@/lib/ownerKey";
import { loadCharacter, updateCharacterVoiceProfile } from "@/lib/characters/store";
import { fetchComfyViewBytes, readWorkflowJson, submitWorkflow, waitForAudio } from "@/lib/comfyVoices";
import { prepareWorkflowForTarget } from "@/lib/comfyWorkflowCompatibility";
import {
  buildVoiceCreatorPrompt,
  getVoiceCreatorPreset,
  isVoiceCreatorLibrary,
  isVoiceCreatorProvider,
  listVoiceCreatorPresets,
  VOICE_CREATOR_PROVIDERS,
  type VoiceCreatorAge,
} from "@/lib/voiceCreatorCatalog";
import {
  getVoiceById,
  newVoiceId,
  resolveVoicesFile,
  upsertVoice,
  voicesOutputsDir,
  writeBinaryFile,
} from "@/lib/voicesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NATURAL_AGES = new Set<VoiceCreatorAge>(["adult", "elderly", "teenager", "child"]);
const NATURAL_PRESENTATIONS = new Set(["male", "female"]);
const NEGATIVE_PROMPT =
  "music, background music, singing, choir, crowd, multiple speakers, overlapping speech, ambient noise, unrelated sound effects, clipping, distortion, unintelligible speech, captions, subtitles";

type GenerateBody = {
  action?: "generate";
  characterId?: string;
  provider?: string;
  library?: string;
  presetId?: string;
  age?: string;
  presentation?: string;
  text?: string;
  durationSeconds?: number;
  seed?: number;
};

type ApproveBody = {
  action: "approve";
  characterId?: string;
  voiceId?: string;
  provider?: string;
  library?: string;
  presetId?: string;
  age?: string;
  presentation?: string;
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

function boundedDuration(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 10;
  return Math.max(5, Math.min(12, n));
}

function safeSeed(value: unknown): number {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return Math.floor(Math.random() * 900_000_000_000_000);
}

function patchProviderWorkflow(input: {
  workflow: Record<string, any>;
  provider: "minimax_h3" | "ltx25";
  prompt: string;
  durationSeconds: number;
  seed: number;
  outputPrefix: string;
}) {
  const workflow = input.workflow;
  if (input.provider === "minimax_h3") {
    if (!workflow?.["131"]?.inputs || !workflow?.["133"]?.inputs || !workflow?.["129"]?.inputs || !workflow?.["139"]?.inputs) {
      throw new Error("MiniMax H3 workflow contract is missing required nodes 131/133/129/139.");
    }
    workflow["131"].inputs.prompt = input.prompt;
    workflow["133"].inputs.value = input.durationSeconds;
    workflow["129"].inputs.noise_seed = input.seed;
    workflow["139"].inputs.filename_prefix = input.outputPrefix;
    return workflow;
  }

  if (!workflow?.["432"]?.inputs || !workflow?.["433"]?.inputs || !workflow?.["450"]?.inputs || !workflow?.["429"]?.inputs || !workflow?.["421"]?.inputs || !workflow?.["455"]?.inputs) {
    throw new Error("LTX 2.5 workflow contract is missing required nodes 432/433/450/429/421/455.");
  }
  workflow["432"].inputs.text = input.prompt;
  workflow["433"].inputs.text = NEGATIVE_PROMPT;
  workflow["450"].inputs.value = input.durationSeconds;
  workflow["429"].inputs.noise_seed = input.seed;
  workflow["421"].inputs.noise_seed = (input.seed + 104_729) % 900_000_000_000_000;
  workflow["455"].inputs.filename_prefix = input.outputPrefix;
  return workflow;
}

export async function GET(req: NextRequest) {
  try {
    await getOwnerContext(req);
    return NextResponse.json(
      {
        ok: true,
        providers: VOICE_CREATOR_PROVIDERS,
        catalogs: {
          minimax_h3: {
            natural: listVoiceCreatorPresets("minimax_h3", "natural"),
            fictional: listVoiceCreatorPresets("minimax_h3", "fictional"),
          },
          ltx25: {
            natural: listVoiceCreatorPresets("ltx25", "natural"),
            fictional: listVoiceCreatorPresets("ltx25", "fictional"),
          },
        },
        defaults: { durationSeconds: 10, age: "adult", presentation: "male" },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Voice catalog failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as GenerateBody | ApproveBody;
    const { ownerKey } = await getOwnerContext(req);
    const action = clean(body.action || "generate").toLowerCase();

    if (action === "approve") {
      const approval = body as ApproveBody;
      const characterId = clean(approval.characterId);
      const voiceId = clean(approval.voiceId);
      if (!characterId || !voiceId) {
        return NextResponse.json({ ok: false, error: "characterId and voiceId are required" }, { status: 400 });
      }
      if (!isVoiceCreatorProvider(approval.provider) || !isVoiceCreatorLibrary(approval.library)) {
        return NextResponse.json({ ok: false, error: "Invalid provider or voice library" }, { status: 400 });
      }
      const preset = getVoiceCreatorPreset(approval.provider, approval.library, clean(approval.presetId));
      if (!preset) return NextResponse.json({ ok: false, error: "Voice preset not found" }, { status: 404 });

      const character = loadCharacter(ownerKey, characterId);
      if (!character) return NextResponse.json({ ok: false, error: "Character not found" }, { status: 404 });
      const voice = getVoiceById(ownerKey, voiceId);
      if (!voice?.refAudioRel) return NextResponse.json({ ok: false, error: "Generated voice sample not found" }, { status: 404 });

      const audioPath = resolveVoicesFile(voice.refAudioRel);
      const audioUrl = `/api/file?path=${encodeURIComponent(audioPath)}`;
      const updated = updateCharacterVoiceProfile(ownerKey, characterId, {
        characterId,
        provider: approval.provider === "ltx25" ? "ltx" : "uploaded",
        baseSamplePath: audioPath,
        baseSampleUrl: audioUrl,
        approvedSamplePath: audioPath,
        approvedSampleUrl: audioUrl,
        status: "ready",
        mockResult: {
          voiceCreator: true,
          sourceProvider: approval.provider,
          library: approval.library,
          presetId: preset.id,
          presetLabel: preset.label,
          presetCategory: preset.category,
          presetDescription: preset.description,
          age: clean(approval.age) || undefined,
          presentation: clean(approval.presentation) || undefined,
          auditionVoiceId: voiceId,
          auditionLine: voice.refText,
          approvedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      });
      if (!updated) return NextResponse.json({ ok: false, error: "Character not found" }, { status: 404 });
      return NextResponse.json({ ok: true, character: updated, voice });
    }

    const generation = body as GenerateBody;
    if (!isVoiceCreatorProvider(generation.provider) || !isVoiceCreatorLibrary(generation.library)) {
      return NextResponse.json({ ok: false, error: "Invalid provider or voice library" }, { status: 400 });
    }

    const characterId = clean(generation.characterId);
    if (!characterId) return NextResponse.json({ ok: false, error: "characterId is required" }, { status: 400 });
    const character = loadCharacter(ownerKey, characterId);
    if (!character) return NextResponse.json({ ok: false, error: "Character not found" }, { status: 404 });

    const preset = getVoiceCreatorPreset(generation.provider, generation.library, clean(generation.presetId));
    if (!preset) return NextResponse.json({ ok: false, error: "Voice preset not found" }, { status: 404 });

    const age = NATURAL_AGES.has(clean(generation.age) as VoiceCreatorAge) ? (clean(generation.age) as VoiceCreatorAge) : "adult";
    const presentation = NATURAL_PRESENTATIONS.has(clean(generation.presentation)) ? (clean(generation.presentation) as "male" | "female") : "male";
    const sampleText = clean(generation.text) || clean(character.introLine) || preset.auditionLine;
    if (!sampleText) return NextResponse.json({ ok: false, error: "Audition text is required" }, { status: 400 });
    if (sampleText.length > 600) return NextResponse.json({ ok: false, error: "Audition text is too long (max 600 chars)" }, { status: 400 });

    const durationSeconds = boundedDuration(generation.durationSeconds);
    const seed = safeSeed(generation.seed);
    const prompt = buildVoiceCreatorPrompt({
      provider: generation.provider,
      library: generation.library,
      preset,
      sampleText,
      characterDescription: character.description,
      age,
      presentation,
    });

    const workflowPath = generation.provider === "minimax_h3"
      ? "internal/voices/minimax_h3_audio.json"
      : "internal/voices/ltx25_audio.json";
    const template = (await readWorkflowJson(workflowPath)) as Record<string, any>;
    const workflow = JSON.parse(JSON.stringify(template)) as Record<string, any>;
    const voiceId = newVoiceId(ownerKey);
    const outputPrefix = `audio/otg_voice_creator/${generation.provider}_${generation.library}_${preset.id}_${Date.now()}`;
    patchProviderWorkflow({ workflow, provider: generation.provider, prompt, durationSeconds, seed, outputPrefix });

    const { baseUrl, targetId } = await resolveVoiceComfyBaseUrl();
    const prepared = prepareWorkflowForTarget(workflow, targetId);
    const clientId = req.headers.get("x-otg-device-id") || `otg_voice_creator_${generation.provider}`;
    const promptId = await submitWorkflow(prepared.workflow, clientId, baseUrl);
    const output = await waitForAudio(promptId, 360_000, baseUrl);
    const bytes = await fetchComfyViewBytes(output, baseUrl);

    const ext = path.extname(output.filename || "") || ".mp3";
    const outputName = `voice_creator_${generation.provider}_${preset.id}_${Date.now()}${ext}`;
    const absOutput = path.join(voicesOutputsDir(voiceId), outputName);
    writeBinaryFile(absOutput, bytes);
    const refAudioRel = path.posix.join("outputs", voiceId, outputName);

    const voice = upsertVoice(ownerKey, {
      voiceId,
      name: `${character.name} — ${preset.label}`,
      tags: ["voice-creator", generation.provider, generation.library, preset.id],
      type: "created",
      refText: sampleText,
      refAudioRel,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        ok: true,
        promptId,
        voice,
        audioUrl: `/api/file?path=${encodeURIComponent(absOutput)}`,
        provider: generation.provider,
        library: generation.library,
        preset,
        durationSeconds,
        target: {
          id: targetId,
          baseUrl,
          sageAttentionEnabled: prepared.sageAttentionEnabled,
          removedSageNodeIds: prepared.removedSageNodeIds,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Voice Creator request failed" },
      { status: 500 },
    );
  }
}

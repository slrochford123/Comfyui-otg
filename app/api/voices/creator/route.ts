import { NextRequest, NextResponse } from "next/server";
import path from "node:path";

import { comfyTargets } from "@/app/api/_lib/comfyTarget";
import { SessionInvalidError, getOwnerContext } from "@/lib/ownerKey";
import { createCharacterVoicePipelineJob } from "@/lib/jobs/voicePipelineJobs";
import { hasValidWorkerToken } from "@/lib/jobs/workerAuth";
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
  type VoiceCreatorPresentation,
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

const NATURAL_AGES = new Set<VoiceCreatorAge>([
  "child",
  "teenager",
  "adult",
  "elderly",
  "unspecified",
]);
const NATURAL_PRESENTATIONS = new Set<VoiceCreatorPresentation>([
  "male",
  "female",
  "neutral",
  "unspecified",
]);
const NEGATIVE_PROMPT =
  "music, background music, singing, crowd, multiple speakers, overlapping speech, ambient noise, unrelated sound effects, clipping, distortion, unintelligible speech, captions, subtitles";

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
  if (n === 5) return 5;
  if (n === 10) return 10;
  return 10;
}

function safeSeed(value: unknown): number {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return Math.floor(Math.random() * 900_000_000_000_000);
}

type VoiceComfyCandidate = {
  targetId: string;
  baseUrl: string;
  label: string;
};

function normalizeBaseUrl(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function voiceComfyCandidates(): VoiceComfyCandidate[] {
  const targets = comfyTargets();

  const primaryTarget =
    targets.find((target) =>
      /3090/i.test(`${target.id} ${target.label}`)
    );

  const primary: VoiceComfyCandidate = {
    targetId: primaryTarget?.id || "3090-local",
    baseUrl:
      normalizeBaseUrl(primaryTarget?.baseUrl) ||
      "http://100.75.162.64:8188",
    label: "RTX 3090 shawn",
  };

  const fallback: VoiceComfyCandidate = {
    targetId: "5060ti",
    baseUrl:
      normalizeBaseUrl(process.env.COMFYUI_IMAGE_URL) ||
      normalizeBaseUrl(process.env.COMFYUI_URL) ||
      "http://192.168.1.113:8188",
    label: "RTX 5060 Ti slr",
  };

  const seen = new Set<string>();

  return [primary, fallback].filter((candidate) => {
    if (!candidate.baseUrl || seen.has(candidate.baseUrl)) {
      return false;
    }

    seen.add(candidate.baseUrl);
    return true;
  });
}

async function voiceComfyHealthy(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(
      `${baseUrl}/system_stats`,
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      },
    );

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function patchProviderWorkflow(input: {
  workflow: Record<string, any>;
  provider: "ltx25";
  prompt: string;
  durationSeconds: number;
  seed: number;
  outputPrefix: string;
}) {
  const workflow = input.workflow;

  if (
    !workflow?.["432"]?.inputs ||
    !workflow?.["433"]?.inputs ||
    !workflow?.["450"]?.inputs ||
    !workflow?.["429"]?.inputs ||
    !workflow?.["421"]?.inputs ||
    !workflow?.["455"]?.inputs
  ) {
    throw new Error(
      "LTX 2.5 workflow contract is missing required nodes 432/433/450/429/421/455.",
    );
  }

  workflow["432"].inputs.text = input.prompt;
  workflow["433"].inputs.text = NEGATIVE_PROMPT;
  workflow["450"].inputs.value = input.durationSeconds;
  workflow["429"].inputs.noise_seed = input.seed;
  workflow["421"].inputs.noise_seed =
    (input.seed + 104_729) % 900_000_000_000_000;
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

    const workerDirect =
      req.headers.get("x-otg-worker-direct") === "1";

    const workerOwnerKey = clean(
      req.headers.get("x-otg-owner-key"),
    );

    if (
      workerDirect &&
      (!hasValidWorkerToken(req) || !workerOwnerKey)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Authenticated Linux worker context is required.",
        },
        { status: 401 },
      );
    }

    const ownerKey = workerDirect
      ? workerOwnerKey
      : (await getOwnerContext(req)).ownerKey;

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
        provider: "ltx",
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
      return NextResponse.json({
        ok: true,
        character: updated,
        voice,
        audioPath,
        audioUrl,
      });
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

    const age = NATURAL_AGES.has(
      clean(generation.age) as VoiceCreatorAge,
    )
      ? (clean(generation.age) as VoiceCreatorAge)
      : "unspecified";
    const presentation = NATURAL_PRESENTATIONS.has(
      clean(generation.presentation) as VoiceCreatorPresentation,
    )
      ? (clean(generation.presentation) as VoiceCreatorPresentation)
      : "unspecified";
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
      age,
      presentation,
    });

    const workflowPath = "internal/voices/ltx25_audio.json";
    const template = (await readWorkflowJson(workflowPath)) as Record<string, any>;
    const workflow = JSON.parse(JSON.stringify(template)) as Record<string, any>;
    const voiceId = newVoiceId(ownerKey);
    const outputPrefix = `audio/otg_voice_creator/${generation.provider}_${generation.library}_${preset.id}_${Date.now()}`;
    patchProviderWorkflow({ workflow, provider: generation.provider, prompt, durationSeconds, seed, outputPrefix });

    const clientId =
      req.headers.get("x-otg-device-id") ||
      `otg_voice_creator_${generation.provider}`;

    let selected:
      | {
          targetId: string;
          baseUrl: string;
          label: string;
          promptId: string;
          prepared: ReturnType<typeof prepareWorkflowForTarget>;
        }
      | null = null;

    const failures: string[] = [];

    for (const candidate of voiceComfyCandidates()) {
      const healthy = await voiceComfyHealthy(candidate.baseUrl);

      if (!healthy) {
        failures.push(
          `${candidate.label} unavailable at ${candidate.baseUrl}`,
        );
        continue;
      }

      try {
        const candidateWorkflow = JSON.parse(
          JSON.stringify(workflow),
        ) as Record<string, any>;

        const prepared = prepareWorkflowForTarget(
          candidateWorkflow,
          candidate.targetId,
        );

        const promptId = await submitWorkflow(
          prepared.workflow,
          clientId,
          candidate.baseUrl,
        );

        selected = {
          ...candidate,
          promptId,
          prepared,
        };

        break;
      } catch (error) {
        failures.push(
          `${candidate.label} submit failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (!selected) {
      const failureSummary = failures
        .map((failure) => failure.slice(0, 500))
        .join("; ");

      const queueableFailure = failures.some((failure) =>
        /busy|occupied|locked|resource|temporarily unavailable|unavailable|timeout|timed out|aborted|ECONN|fetch failed|429|503|504/i.test(
          failure,
        ),
      );

      if (queueableFailure) {
        const queueMessage =
          "All compatible Character Voice GPUs are busy or temporarily unavailable. This audition has been added to the durable GPU queue.";

        /*
         * A worker retry must never recursively create another job.
         * Return a confirmed PRE-SUBMIT retry signal instead.
         */
        if (workerDirect) {
          return NextResponse.json(
            {
              ok: false,
              retryable: true,
              submitted: false,
              error: queueMessage,
              failures: failureSummary,
            },
            {
              status: 409,
              headers: { "Cache-Control": "no-store" },
            },
          );
        }

        const queued = createCharacterVoicePipelineJob(
          ownerKey,
          {
            action: "create_voice_sample",
            characterId,
            provider: "ltx",

            queueKind: "ltx25_voice_creator",
            source: "voice_creator",

            creatorRequest: {
              action: "generate",
              characterId,
              provider: generation.provider,
              library: generation.library,
              presetId: preset.id,
              age,
              presentation,
              text: sampleText,
              durationSeconds,
              seed,
            },

            voiceCreatorProvider: generation.provider,
            voiceCreatorLibrary: generation.library,
            voiceCreatorPresetId: preset.id,

            durationSeconds,
            seed,
            requestSeed: seed,

            initialGpuFailure: failureSummary,
          },
        );

        if (!queued.ok) {
          throw new Error(
            queued.error ||
              "Could not add Character Voice audition to the durable queue.",
          );
        }

        return NextResponse.json(
          {
            ok: true,
            queued: true,
            jobId: queued.job.jobId,
            job: queued.job,
            message: queueMessage,
          },
          {
            status: 202,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }

      throw new Error(
        `No compatible Character Voice GPU can run this audition. ${failureSummary}`,
      );
    }

    /*
     * Important:
     * once a GPU accepts the prompt, stay on that GPU.
     * Do not submit a duplicate job to the fallback because a later
     * wait/view operation failed.
     */
    const output = await waitForAudio(
      selected.promptId,
      360_000,
      selected.baseUrl,
    );

    const bytes = await fetchComfyViewBytes(
      output,
      selected.baseUrl,
    );

    const promptId = selected.promptId;
    const baseUrl = selected.baseUrl;
    const targetId = selected.targetId;
    const prepared = selected.prepared;

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

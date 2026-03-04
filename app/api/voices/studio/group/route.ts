import { NextRequest, NextResponse } from "next/server";
import path from "node:path";

import { resolveComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { fetchComfyViewBytes, readWorkflowJson, submitWorkflow, uploadFileToComfy, waitForAudio } from "@/lib/comfyVoices";
import { getVoiceById, resolveVoicesFile, voicesOutputsDir, writeBinaryFile } from "@/lib/voicesStudio";
import { getPresetById } from "@/lib/voicesEmotions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type GroupRole = {
  roleIndex: number; // 1..8
  voiceId: string;
  presetId?: string;
  roleName?: string;
  refText?: string;
};

type Body = {
  roles?: GroupRole[];
  script?: string;
  useRoleNumbers?: boolean;
};

function maxScriptLen(): number {
  const n = Number(process.env.VOICES_MAX_TEXT_LEN || 2000);
  if (!Number.isFinite(n) || n <= 0) return 2000;
  return Math.min(20000, n);
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const body = (await req.json().catch(() => ({}))) as Body;

    const roles = Array.isArray(body.roles) ? body.roles : [];
    const script = String(body.script || "").trim();

    if (roles.length < 2) return NextResponse.json({ ok: false, error: "Select at least 2 voices" }, { status: 400 });
    if (!script) return NextResponse.json({ ok: false, error: "Missing dialogue" }, { status: 400 });
    if (script.length > maxScriptLen()) return NextResponse.json({ ok: false, error: `Dialogue too long (max ${maxScriptLen()} chars)` }, { status: 400 });

    const { baseUrl } = await resolveComfyBaseUrl();

    const tmpl = await readWorkflowJson("internal/voices/group_voice_max8.json");
    const workflow = JSON.parse(JSON.stringify(tmpl));

    // Patch script
    if (workflow?.["95"]?.inputs) workflow["95"].inputs.value = script;

    // Patch role names + per-role clone prompts
    for (const r of roles) {
      const idx = Number(r.roleIndex);
      if (!Number.isFinite(idx) || idx < 1 || idx > 8) continue;

      const voice = getVoiceById(user.ownerKey, String(r.voiceId || "").trim());
      if (!voice) continue;

      const presetId = String(r.presetId || "").trim();
      const preset = presetId ? getPresetById(user.ownerKey, voice.voiceId, presetId) : null;

      const refAudioRel = preset?.refAudioRel || voice.refAudioRel;
      if (!refAudioRel) continue;

      const roleName = String(r.roleName || voice.name || `Role${idx}`).trim() || `Role${idx}`;
      const refText = String(r.refText || preset?.refText || voice.refText || "");

      // RoleBank names live on node 96: role_name_1..8
      if (workflow?.["96"]?.inputs) {
        workflow["96"].inputs[`role_name_${idx}`] = roleName;
      }

      // Upload the reference audio file to Comfy
      const refAbs = resolveVoicesFile(refAudioRel);
      const comfyRefName = await uploadFileToComfy(refAbs, "image", baseUrl);

      // In template, LoadAudio nodes are 107..114 (Role1..Role8)
      const loadNodeId = String(106 + idx); // 107..114
      if (workflow?.[loadNodeId]?.inputs) {
        workflow[loadNodeId].inputs.audio = comfyRefName;
        workflow[loadNodeId].inputs.audioUI = "";
      }

      // VoiceClonePrompt nodes are 125..132 (Role1..Role8)
      const cloneNodeId = String(124 + idx);
      if (workflow?.[cloneNodeId]?.inputs) {
        workflow[cloneNodeId].inputs.ref_text = refText;
      }

      // RoleBank prompt inputs are prompt_1..8 on node 96
      // Those are wired to the voice_clone_prompt outputs in the JSON, so no direct patch needed here.
    }

    const clientId = req.headers.get("x-otg-device-id") || "otg_voices";
    const promptId = await submitWorkflow(workflow, String(clientId), baseUrl);

    const out = await waitForAudio(promptId, 300_000, baseUrl);
    const bytes = await fetchComfyViewBytes(out, baseUrl);

    const ext = path.extname(out.filename || "") || ".flac";
    const outName = `group_${Date.now()}${ext}`;
    const absOut = path.join(voicesOutputsDir("group"), outName);
    writeBinaryFile(absOut, bytes);

    return NextResponse.json(
      {
        ok: true,
        promptId,
        audioUrl: `/api/file?path=${encodeURIComponent(absOut)}`,
        comfyBaseUrl: baseUrl,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}

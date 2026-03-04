import { NextResponse } from "next/server";

import { requireSessionUser } from "@/lib/sessionUser";
import { readWorkflowJson, submitWorkflow, waitForAudio } from "@/lib/comfyVoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  speaker?: unknown;
  style?: unknown;
  text?: unknown;
};

const SUPPORTED_SPEAKERS = new Set([
  "aiden",
  "dylan",
  "eric",
  "ono_anna",
  "ryan",
  "serena",
  "sohee",
  "uncle_fu",
  "vivian",
]);

function normalizeSpeaker(s: unknown): string {
  if (typeof s !== "string") return "ryan";
  const v = s.trim().toLowerCase();
  if (!v) return "ryan";
  if (!SUPPORTED_SPEAKERS.has(v)) return "ryan";
  return v;
}

export async function POST(req: Request) {
  try {
    // OTG Law: /api/whoami is source of truth, but server routes use requireSessionUser
    await requireSessionUser(req);

    const body = (await req.json().catch(() => ({}))) as Body;

    const speaker = normalizeSpeaker(body.speaker);
    const style = typeof body.style === "string" ? body.style : String(body.style ?? "");
    const text = typeof body.text === "string" ? body.text : String(body.text ?? "");

    if (!text.trim()) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    // This is a ComfyUI API prompt dict (node-id keyed)
    const wf = await readWorkflowJson("internal/voices/voice_control.json");

    // Patch workflow nodes
    // 116: FB_Qwen3TTSCustomVoice (speaker + links to text/instructions)
    if (wf?.["116"]?.inputs) {
      wf["116"].inputs.speaker = speaker;
      // Ensure we never pass junk types into these fields.
      if ("custom_model_path" in wf["116"].inputs) wf["116"].inputs.custom_model_path = "";
      if ("custom_speaker_name" in wf["116"].inputs) wf["116"].inputs.custom_speaker_name = "";
    }

    // 81: Text input
    if (wf?.["81"]?.inputs) wf["81"].inputs.value = text;
    // 82: Style/emotion instruction
    if (wf?.["82"]?.inputs) wf["82"].inputs.value = style;

    // submitWorkflow returns the prompt id (string) in this codebase
    const prompt_id = await submitWorkflow(req, wf);
    const audioUrl = await waitForAudio(prompt_id);

    return NextResponse.json({ ok: true, audioUrl });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "Voice control failed",
        raw: String(e?.stack || ""),
      },
      { status: 500 }
    );
  }
}

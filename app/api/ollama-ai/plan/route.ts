import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CameraAggressiveness = "minimal" | "medium" | "dynamic";
type LocationStability = "locked" | "allowed";

function tryParseJsonLoose(text: string): any | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let t = (fenced?.[1] ?? text).trim();
  t = t.replace(/^\uFEFF/, "").replace(/^json\s*/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    // continue
  }
  const oStart = t.indexOf("{");
  const oEnd = t.lastIndexOf("}");
  if (oStart !== -1 && oEnd !== -1 && oEnd > oStart) {
    try {
      return JSON.parse(t.slice(oStart, oEnd + 1));
    } catch {
      return null;
    }
  }
  return null;
}

async function detectTextModel(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { cache: "no-store" as any });
    if (!res.ok) return null;
    const data = await res.json();
    const models: string[] = data?.models?.map((m: any) => m?.name).filter(Boolean) ?? [];
    if (!models.length) return null;
    const preferred = models.find((m) => !/vision|vl|llava/i.test(m) && /qwen|llama|mistral|phi|gemma/i.test(m));
    return preferred ?? models.find((m) => !/vision|vl|llava/i.test(m)) ?? models[0];
  } catch {
    return null;
  }
}

function buildPlanPrompt(args: {
  transcript: string;
  sceneCount: number;
  secondsPerScene: number;
  style: string;
  cameraAggressiveness: CameraAggressiveness;
  locationStability: LocationStability;
}) {
  const t = args.transcript.trim();
  const sc = Math.max(1, Math.min(12, Number(args.sceneCount) || 5));
  const sec = Math.max(1, Math.min(60, Number(args.secondsPerScene) || 10));
  const style = String(args.style || "realistic cinematic").trim();

  return (
    "You are a film scene planner. Convert the user's story description into a strict JSON scene plan. " +
    "Do not add new characters or locations unless required by the user's text. " +
    "Return ONLY valid JSON (no markdown, no commentary).\n\n" +
    "Constraints:\n" +
    `- target_scenes: ${sc}\n` +
    `- seconds_per_scene: ${sec}\n` +
    `- style: ${style}\n` +
    `- camera_aggressiveness: ${args.cameraAggressiveness}\n` +
    `- location_stability: ${args.locationStability}\n\n` +
    "JSON schema (exact keys):\n" +
    "{\n" +
    "  \"characters\": [{\"name\":\"\",\"role\":\"\",\"notes\":\"\"}],\n" +
    "  \"location\": \"\",\n" +
    "  \"tone\": \"\",\n" +
    "  \"must_keep\": [\"\"],\n" +
    "  \"avoid\": [\"\"],\n" +
    "  \"beats\": [\n" +
    "    {\"i\":1,\"beat\":\"\",\"emotion\":\"\",\"dialogue_hint\":\"\"}\n" +
    "  ]\n" +
    "}\n\n" +
    "Rules:\n" +
    "- beats must be ordered, one action beat per entry, concise.\n" +
    `- beats length should be ~${sc} to ~${sc * 2}.\n` +
    "- must_keep should capture concrete details from user text (objects, actions, relationships).\n" +
    "- avoid should include common video failures (face drift, flicker, text, watermark) PLUS any user-specific avoid items if implied.\n\n" +
    `User story:\n${t}`
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Request must be JSON" }, { status: 415 });

    const transcript = String((body as any).transcript || "").trim();
    if (!transcript) return NextResponse.json({ error: "Missing transcript" }, { status: 400 });

    const sceneCount = Number((body as any).sceneCount || 5);
    const secondsPerScene = Number((body as any).secondsPerScene || 10);
    const style = String((body as any).style || "realistic cinematic");
    const cameraAggressiveness = String((body as any).cameraAggressiveness || "medium") as CameraAggressiveness;
    const locationStability = String((body as any).locationStability || "locked") as LocationStability;

    const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    const model =
      process.env.OLLAMA_TEXT_MODEL ||
      process.env.OLLAMA_MODEL ||
      (await detectTextModel(baseUrl)) ||
      "llama3.2";

    const prompt = buildPlanPrompt({ transcript, sceneCount, secondsPerScene, style, cameraAggressiveness, locationStability });

    const payload = {
      model,
      stream: false,
      prompt,
      options: {
        temperature: 0.2,
        top_p: 0.9,
        repeat_penalty: 1.12,
        num_predict: 900,
      },
    };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: `Ollama returned non-JSON: ${raw.slice(0, 200)}` }, { status: 502 });
    }

    if (!r.ok) return NextResponse.json({ error: data?.error || raw }, { status: 502 });

    const out = String(data?.response ?? "");
    const plan = tryParseJsonLoose(out);
    if (!plan || typeof plan !== "object") {
      return NextResponse.json({ error: `Could not parse plan JSON. Raw: ${out.slice(0, 300)}` }, { status: 502 });
    }

    return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

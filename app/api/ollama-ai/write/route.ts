import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CameraAggressiveness = "minimal" | "medium" | "dynamic";
type LocationStability = "locked" | "allowed";
type PromptFormat = "next_scenes" | "scene_card";

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

function cleanOutput(s: string) {
  return (s || "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/\r/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*["'`]+|["'`]+\s*$/g, "")
    .trim()
    .slice(0, 6000);
}

function buildWritePrompt(args: {
  plan: any;
  format: PromptFormat;
  style: string;
  sceneCount: number;
  secondsPerScene: number;
  cameraAggressiveness: CameraAggressiveness;
  locationStability: LocationStability;
}) {
  const sc = Math.max(1, Math.min(12, Number(args.sceneCount) || 5));
  const sec = Math.max(1, Math.min(60, Number(args.secondsPerScene) || 10));
  const style = String(args.style || "realistic cinematic").trim();

  const baseInstr =
    "You are a prompt-writer for cinematic AI video generation. " +
    "Use the provided scene plan JSON as the only source of truth. " +
    "Do not invent new characters or locations. Preserve identity and continuity. ";

  const camInstr =
    args.cameraAggressiveness === "minimal"
      ? "Keep camera moves minimal and stable."
      : args.cameraAggressiveness === "dynamic"
        ? "Use dynamic camera language (push-ins, pans, tilts) but keep continuity."
        : "Use moderate camera language, not excessive.";

  const locInstr =
    args.locationStability === "locked"
      ? "Keep location/layout locked across scenes unless the plan explicitly changes it."
      : "Location changes are allowed only if implied by the plan.";

  const formatInstr =
    args.format === "scene_card"
      ?
        "Output format: repeat a strict Scene Card template per scene:\n" +
        "SCENE N:\n" +
        "SHOT/LENS/CAMERA: ...\n" +
        "LOCATION LOCK: ...\n" +
        "CHARACTER ID: ...\n" +
        "ACTION: ...\n" +
        "LIGHTING: ...\n" +
        "STYLE: ...\n" +
        "NEGATIVE: ...\n" +
        "SEED: (leave blank)\n" +
        "---\n"
      : "Output format: Next Scene 1:, Next Scene 2:, ... Each line is one scene with camera + action + continuity locks.";

  return (
    baseInstr +
    `\nConstraints: target_scenes=${sc}, seconds_per_scene=${sec}, style=${style}.\n` +
    `${camInstr} ${locInstr}\n` +
    "Always include a clear camera/shot description. Keep each scene self-contained.\n" +
    "For NEGATIVE: include a compact anti-drift set (blurry, low quality, artifacts, text, watermark, face drift, flicker) plus any plan.avoid items.\n\n" +
    formatInstr +
    "\nReturn ONLY the formatted prompt text. No markdown.\n\n" +
    `Scene plan JSON:\n${JSON.stringify(args.plan)}`
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Request must be JSON" }, { status: 415 });

    const plan = (body as any).plan;
    if (!plan || typeof plan !== "object") return NextResponse.json({ error: "Missing plan" }, { status: 400 });

    const format = String((body as any).format || "next_scenes") as PromptFormat;
    const style = String((body as any).style || "realistic cinematic");
    const sceneCount = Number((body as any).sceneCount || 5);
    const secondsPerScene = Number((body as any).secondsPerScene || 10);
    const cameraAggressiveness = String((body as any).cameraAggressiveness || "medium") as CameraAggressiveness;
    const locationStability = String((body as any).locationStability || "locked") as LocationStability;

    const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    const model =
      process.env.OLLAMA_TEXT_MODEL ||
      process.env.OLLAMA_MODEL ||
      (await detectTextModel(baseUrl)) ||
      "llama3.2";

    const prompt = buildWritePrompt({ plan, format, style, sceneCount, secondsPerScene, cameraAggressiveness, locationStability });

    const payload = {
      model,
      stream: false,
      prompt,
      options: {
        temperature: 0.35,
        top_p: 0.9,
        repeat_penalty: 1.12,
        num_predict: 1400,
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

    const out = cleanOutput(String(data?.response ?? ""));
    if (!out) return NextResponse.json({ error: "Empty prompt output" }, { status: 500 });

    return NextResponse.json({ promptText: out }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

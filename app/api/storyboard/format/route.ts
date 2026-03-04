import { NextRequest, NextResponse } from "next/server";

type InheritFlags = {
  lens?: boolean;
  identity?: boolean;
  style?: boolean;
  negative?: boolean;
};

type SceneInput = {
  id?: string;
  ideaText: string;
  // Optional user-provided overrides for this scene (used when inherit flags are false)
  lensText?: string;
  identityLockText?: string;
  styleLockText?: string;
  inherit?: InheritFlags;
};

type FormatRequestBody = {
  characterDescriptors?: string[]; // e.g. ["Man A: ...", "Man B: ..."]
  backgroundPrompt?: string; // optional location/background lock prompt
  globalNegativePrompt?: string;
  scenes: SceneInput[];
  defaults?: {
    lensText?: string;
    identityLockText?: string;
    styleLockText?: string;
  };
};

type FormattedScene = {
  sceneNumber: number;
  promptText: string;           // final positive prompt (what we inject to node 30)
  negativePrompt?: string;      // what we inject to node 36 (optional)
  effective: {
    lensText?: string;
    identityLockText?: string;
    styleLockText?: string;
  };
};

function env(name: string, fallback?: string) {
  const v = process.env[name];
  return (v && v.length > 0) ? v : fallback;
}

async function ollamaGenerate(prompt: string, signal: AbortSignal) {
  const baseUrl = env("OLLAMA_BASE_URL", "http://127.0.0.1:11434")!;
  const model = env("OLLAMA_MODEL_STORYBOARD", env("OLLAMA_MODEL", "llama2"))!;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, prompt }),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false as const, status: res.status, body: text };
  }
  try {
    const json = JSON.parse(text);
    const out = (json?.response ?? "").toString();
    return { ok: true as const, output: out };
  } catch {
    return { ok: false as const, status: 500, body: text };
  }
}

function buildEffectiveScenes(body: FormatRequestBody): Array<{
  sceneNumber: number;
  ideaText: string;
  lensText?: string;
  identityLockText?: string;
  styleLockText?: string;
  negativePrompt?: string;
}> {
  const scenes = body.scenes ?? [];
  const out: any[] = [];

  let prevLens = body.defaults?.lensText;
  let prevIdentity = body.defaults?.identityLockText;
  let prevStyle = body.defaults?.styleLockText;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const inherit = s.inherit ?? {};

    const lensText = inherit.lens ? prevLens : (s.lensText ?? prevLens);
    const identityLockText = inherit.identity ? prevIdentity : (s.identityLockText ?? prevIdentity);
    const styleLockText = inherit.style ? prevStyle : (s.styleLockText ?? prevStyle);

    const negativePrompt = (inherit.negative && body.globalNegativePrompt)
      ? body.globalNegativePrompt
      : undefined;

    out.push({
      sceneNumber: i + 1,
      ideaText: (s.ideaText ?? "").toString(),
      lensText,
      identityLockText,
      styleLockText,
      negativePrompt,
    });

    // update previous for next scene
    prevLens = lensText ?? prevLens;
    prevIdentity = identityLockText ?? prevIdentity;
    prevStyle = styleLockText ?? prevStyle;
  }

  return out;
}

function renderFinalPrompt(params: {
  sceneNumber: number;
  camera: string;
  location: string;
  environment: string;
  action: string;
  lensText?: string;
  identityLockText?: string;
  styleLockText?: string;
}) {
  const parts: string[] = [];
  parts.push(`Next Scene ${params.sceneNumber}:`);

  // Camera sentence
  const cameraBits: string[] = [];
  if (params.camera?.trim()) cameraBits.push(params.camera.trim());
  if (params.lensText?.trim()) cameraBits.push(params.lensText.trim());
  const cameraLine = cameraBits.join(" ");
  if (cameraLine) parts.push(cameraLine.replace(/\s+/g, " ").trim());

  // Location / environment / action as one cinematic paragraph
  const paraBits = [params.location, params.environment, params.action]
    .map(s => (s ?? "").trim())
    .filter(Boolean);
  if (paraBits.length) {
    parts.push(paraBits.join("; ").replace(/\s+/g, " ").trim() + ".");
  }

  // Identity lock (verbatim)
  if (params.identityLockText?.trim()) {
    parts.push(`Identity/Face lock: ${params.identityLockText.trim()}.`);
  }

  // Style lock (verbatim)
  if (params.styleLockText?.trim()) {
    parts.push(params.styleLockText.trim().endsWith(".") ? params.styleLockText.trim() : `${params.styleLockText.trim()}.`);
  }

  return parts.join(" ");
}

export async function POST(req: NextRequest) {
  const timeoutMs = Number(env("STORYBOARD_OLLAMA_TIMEOUT_MS", "60000"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = (await req.json()) as FormatRequestBody;
    if (!body?.scenes?.length) {
      return NextResponse.json({ ok: false, error: "No scenes provided." }, { status: 400 });
    }

    const effectiveScenes = buildEffectiveScenes(body);
    const characterBlock = (body.characterDescriptors ?? [])
      .map((s) => `- ${s}`)
      .join("\n");

    const backgroundPrompt = (body.backgroundPrompt ?? "").trim();

    const formattedScenes: FormattedScene[] = [];

    for (const s of effectiveScenes) {
      const prompt = [
        "You are a cinematic scene formatter.",
        "Return ONLY valid JSON. No markdown. No extra text.",
        "Schema:",
        `{ "camera": string, "location": string, "environment": string, "action": string }`,
        "",
        "Rules:",
        "- Keep continuity with previous scene unless user indicates a change.",
        "- Do not invent new characters beyond what is listed.",
        "- Be concise but cinematic; avoid adding dialogue unless provided.",
        "",
        "Characters:",
        characterBlock || "- (none provided)",
        "",
        backgroundPrompt ? `Global background/location lock: ${backgroundPrompt}` : "Global background/location lock: (none)",
        "",
        `Scene idea: ${s.ideaText}`,
        "",
        "Output JSON now."
      ].join("\n");

      let gen = await ollamaGenerate(prompt, controller.signal);

      // Retry once with a repair prompt if JSON parsing fails downstream
      if (!gen.ok) {
        return NextResponse.json({ ok: false, error: `Ollama error (${gen.status})`, details: gen.body }, { status: 502 });
      }

      let camera = "", location = "", environment = "", action = "";
      try {
        const parsed = JSON.parse(gen.output);
        camera = (parsed.camera ?? "").toString();
        location = (parsed.location ?? "").toString();
        environment = (parsed.environment ?? "").toString();
        action = (parsed.action ?? "").toString();
      } catch {
        // repair
        const repairPrompt = [
          "Fix the following into valid JSON ONLY using schema:",
          `{ "camera": string, "location": string, "environment": string, "action": string }`,
          "No markdown. No commentary.",
          "",
          "TEXT:",
          gen.output
        ].join("\n");
        const gen2 = await ollamaGenerate(repairPrompt, controller.signal);
        if (!gen2.ok) {
          return NextResponse.json({ ok: false, error: `Ollama repair error (${gen2.status})`, details: gen2.body }, { status: 502 });
        }
        const parsed2 = JSON.parse(gen2.output);
        camera = (parsed2.camera ?? "").toString();
        location = (parsed2.location ?? "").toString();
        environment = (parsed2.environment ?? "").toString();
        action = (parsed2.action ?? "").toString();
      }

      const promptText = renderFinalPrompt({
        sceneNumber: s.sceneNumber,
        camera,
        location,
        environment,
        action,
        lensText: s.lensText,
        identityLockText: s.identityLockText,
        styleLockText: s.styleLockText ?? "realistic cinematic style",
      });

      formattedScenes.push({
        sceneNumber: s.sceneNumber,
        promptText,
        negativePrompt: s.negativePrompt,
        effective: {
          lensText: s.lensText,
          identityLockText: s.identityLockText,
          styleLockText: s.styleLockText ?? "realistic cinematic style",
        }
      });
    }

    return NextResponse.json({ ok: true, formattedScenes });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Ollama request timed out." : (e?.message ?? "Unknown error");
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}
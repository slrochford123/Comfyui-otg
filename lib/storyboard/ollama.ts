/* eslint-disable @typescript-eslint/no-explicit-any */

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function ollamaFormatScene(args: {
  sceneNumber: number;
  idea: string;
  lens?: string;
  identityLock?: string;
  styleLock?: string;
  characters: string[];
  negative?: string | null;
}): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "llama2-uncensored:7b";

  const charBlock = args.characters
    .map((d, i) => `Character ${i + 1}: ${String(d || "").trim()}`)
    .filter(Boolean)
    .join("\n");

  // Deterministic formatting instructions. Keep it strict and short.
  const sys =
`You format storyboard prompts for cinematic image generation.
Return ONLY the final formatted prompt for this single scene.
No JSON. No markdown. No commentary.

Rules:
- Keep the user's idea, but rewrite into cinematic, visual language.
- Do NOT invent new characters.
- If identity/style/lens are provided, include them exactly (do not rewrite their wording).
- Output order MUST be:
  1) Next Scene {n}: <scene sentence>
  2) Lens: <lens> (only if provided)
  3) Identity/Face lock: <identityLock> (only if provided; keep exact)
  4) <styleLock> (only if provided; keep exact)
`;

  const user =
`Scene number: ${args.sceneNumber}
User idea: ${args.idea}

${charBlock ? `Characters:\n${charBlock}\n` : ""}
Lens: ${args.lens || ""}
Identity/Face lock (exact text): ${args.identityLock || ""}
Style lock (exact text): ${args.styleLock || ""}
Negative (do NOT include in output): ${args.negative || ""}
`;

  const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: `${sys}\n\n${user}`,
      stream: false,
      options: { temperature: 0.2 },
    }),
  });

  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.error || data?.message || data?.raw || `Ollama HTTP ${r.status}`;
    throw new Error(typeof msg === "string" ? msg : `Ollama HTTP ${r.status}`);
  }

  const out = String(data?.response || "").trim();
  if (!out) throw new Error("Ollama returned empty response");
  return out;
}

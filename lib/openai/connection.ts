import { createHash } from "node:crypto";
import { openAIEnabled, openAIModels } from "./provider";
import { openAIAdminConfigured } from "./adminCredential";

type Probe = { checkedAt: string; authentication: "verified" | "failed"; modelAccess: Record<string, boolean>; message: string };
let cached: { identity: string; expiresAt: number; probe: Probe } | undefined;
let pending: { identity: string; promise: Promise<Probe> } | undefined;
function identity() {
  return createHash("sha256").update(JSON.stringify([
    process.env.OPENAI_API_KEY, process.env.OPENAI_ORG_ID, process.env.OPENAI_PROJECT_ID,
    openAIModels(), process.env.OPENAI_KILL_SWITCH,
  ])).digest("hex");
}

export function openAIConnectionSnapshot() {
  const models = openAIModels();
  return {
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()), enabled: openAIEnabled(), models,
    organizationConfigured: Boolean(process.env.OPENAI_ORG_ID?.trim()),
    projectConfigured: Boolean(process.env.OPENAI_PROJECT_ID?.trim()),
    officialBillingConfigured: openAIAdminConfigured(),
    probe: cached?.identity === identity() ? cached.probe : null,
    creditBalanceUsd: null,
    creditsNotice: "Credit balance and subscription linking must be checked in the official OpenAI billing portal. Successful authentication does not verify credits or billable generation.",
    routes: [
      { feature: "Storyteller / Story Creator", provider: "OpenAI", model: models.story },
      { feature: "Enhance Prompt (Generate, assets and H3)", provider: openAIEnabled() ? "OpenAI" : "Local Qwen fallback", model: openAIEnabled() ? models.h3 : "local configuration" },
      { feature: "H3 AI Scene Director", provider: "OpenAI", model: models.h3 },
      { feature: "Legacy H3 Prompt Builder / visual analysis", provider: "Local Qwen", model: "local configuration" },
      { feature: "Image / video rendering", provider: "Local ComfyUI", model: "selected media workflow" },
    ],
  };
}

/** Only GET /models: no generation, credit purchase, account linking or retries. */
export async function checkOpenAIConnection() {
  if (!openAIEnabled()) return openAIConnectionSnapshot();
  const id = identity();
  if (cached?.identity === id && cached.expiresAt > Date.now()) return openAIConnectionSnapshot();
  if (!pending || pending.identity !== id) {
    const promise = (async (): Promise<Probe> => {
      const headers: Record<string, string> = { Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}` };
      if (process.env.OPENAI_ORG_ID?.trim()) headers["OpenAI-Organization"] = process.env.OPENAI_ORG_ID.trim();
      if (process.env.OPENAI_PROJECT_ID?.trim()) headers["OpenAI-Project"] = process.env.OPENAI_PROJECT_ID.trim();
      const checkedAt = new Date().toISOString();
      try {
        const response = await fetch("https://api.openai.com/v1/models", {
          headers, cache: "no-store", signal: AbortSignal.timeout(15_000),
        });
        const body = await response.json().catch(() => ({}));
        const modelAccess = Object.fromEntries(Object.values(openAIModels()).map(model => [model,
          response.ok && Array.isArray(body.data) && body.data.some((item: { id?: string }) => item.id === model)]));
        return { checkedAt, authentication: response.ok ? "verified" : "failed", modelAccess,
          message: response.ok ? "API authentication verified. Model access listed below; generation and credit balance are separate checks."
            : response.status === 401 ? "API key was rejected. Replace the server-side key securely."
            : response.status === 403 ? "API key lacks access to this organization, project or model list."
            : response.status === 429 ? "OpenAI limited this check. Check the official usage and billing portal; try later."
            : "OpenAI connection check failed. Try again later." };
      } catch {
        return { checkedAt, authentication: "failed", modelAccess: {}, message: "OpenAI could not be reached. Check the server connection and retry." };
      }
    })();
    pending = { identity: id, promise };
  }
  const work = pending;
  try {
    const probe = await work.promise;
    if (id === identity()) cached = { identity: id, expiresAt: Date.now() + 60_000, probe };
  } finally {
    if (pending === work) pending = undefined;
  }
  return openAIConnectionSnapshot();
}

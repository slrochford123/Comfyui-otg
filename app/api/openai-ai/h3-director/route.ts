import { after, NextRequest, NextResponse } from "next/server";

import {claimH3DirectorRequest,readH3DirectorRequest,finishH3DirectorRequest} from "@/lib/openai/h3DirectorRequests";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import {openAIModels} from "@/lib/openai/provider";
import {createAssistantText,resolveAssistantProvider,withAssistantProvider} from "@/lib/workers/assistantProvider";
import {
  getH3DirectorConversation,
  upsertH3DirectorConversation,
} from "@/lib/openai/h3DirectorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const MODE_LABELS: Record<string, string> = {
  "h3-text-to-video": "Text to Video",
  "h3-image-to-video": "Image to Video",
  "h3-reference-to-video": "Reference to Video",
};

function jsonError(error: unknown) {
  const status =
    error instanceof SessionInvalidError
      ? 401
      : typeof error === "object" && error && "status" in error
        ? Number((error as any).status || 400)
        : 400;
  return NextResponse.json(
    {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "H3 AI Director request failed.",
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function cleanText(value: unknown, limit = 8000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, limit);
}

function referenceSummary(references: unknown) {
  if (!Array.isArray(references)) return "";
  return references
    .slice(0, 8)
    .map((item: any, index) => {
      const kind = cleanText(item?.kind, 24) || "reference";
      const name = cleanText(item?.name, 120);
      const description = cleanText(item?.description, 240);
      return `${index + 1}. ${kind}: ${description || name || "unnamed reference"}`;
    })
    .join("\n");
}

function loraSummary(loras: unknown) {
  if (!Array.isArray(loras)) return "";
  return loras
    .slice(0, 8)
    .map((item: any, index) => {
      const label = cleanText(item?.label || item?.id, 120) || "LoRA";
      const strength = cleanText(item?.strength, 24) || "default";
      const triggers = Array.isArray(item?.triggerWords)
        ? item.triggerWords.map((word: unknown) => cleanText(word, 40)).filter(Boolean)
        : [];
      return `${index + 1}. ${label}, strength ${strength}${triggers.length ? `, triggers: ${triggers.join(", ")}` : ""}`;
    })
    .join("\n");
}

function extractJsonObject(text: string) {
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/g, "")
    .trim();
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  const candidate =
    first >= 0 && last > first ? clean.slice(first, last + 1) : clean;
  return JSON.parse(candidate);
}

function normalizePrompt(value: unknown) {
  return cleanText(value, 1400)
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

export async function GET(request: NextRequest) {
  try {
    const user=await requireSessionUser(request);
    if(!user.accountId)throw new SessionInvalidError("Sign in with an account.");
    const result=readH3DirectorRequest(user.accountId,request.nextUrl.searchParams.get("requestId")||"");
    return NextResponse.json(result.body,{status:result.status,headers:{"Cache-Control":"no-store","X-OTG-H3-Request":result.status===202?"pending":"complete"}});
  }catch(error){return jsonError(error);}
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json().catch(() => ({}));
    const requestKey=request.headers.get("idempotency-key")||undefined;
    if(request.headers.get("prefer")==="respond-async"){
      const accountId=user.accountId;
      if(!accountId)throw new SessionInvalidError("Sign in with an account.");
      const instruction=cleanText(body?.message||body?.text,4000);
      if(!requestKey||!instruction)throw new Error("A request ID and H3 Director instruction are required.");
      const {accepted,result}=claimH3DirectorRequest(accountId,requestKey,body,instruction);
      if(accepted)after(async()=>{
        const response=await directShot(user,body,requestKey);
        finishH3DirectorRequest(accountId,requestKey,{status:response.status,body:await response.json()});
      });
      return NextResponse.json(result.body,{status:result.status,headers:{"Cache-Control":"no-store","X-OTG-H3-Request":result.status===202?"pending":"complete"}});
    }
    return await directShot(user,body,requestKey);
  }catch(error){return jsonError(error);}
}

async function directShot(user:Awaited<ReturnType<typeof requireSessionUser>>,body:any,requestKey?:string){
  try {

    const userText = cleanText(body?.message || body?.text || "", 4000);
    if (!userText) {
      throw new Error("Tell the H3 AI Director what to create or refine.");
    }

    const currentPrompt = cleanText(body?.currentPrompt || "", 4000);
    const mode = cleanText(body?.mode || "h3-text-to-video", 80);
    const conversationId = cleanText(body?.conversationId || "", 120);
    const previous = conversationId
      ? getH3DirectorConversation(user.ownerKey, conversationId)
      : null;

    const sceneMemory = previous?.turns
      .slice(-10)
      .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
      .join("\n");
    const latestPrompt =
      previous?.promptVersions[previous.promptVersions.length - 1]?.prompt ||
      currentPrompt;

    const lockedSettings = [
      `Mode: ${MODE_LABELS[mode] || mode}.`,
      `Duration: ${cleanText(body?.durationSeconds, 20) || "unchanged"} seconds.`,
      `Quality: ${cleanText(body?.quality, 20) || "unchanged"}.`,
      `Orientation: ${cleanText(body?.orientation, 20) || "unchanged"}.`,
      `Visual style: ${cleanText(body?.visualStyle, 120) || "unchanged"}.`,
      `Camera feel: ${cleanText(body?.cameraFeel, 120) || "unchanged"}.`,
      `Shot flow: ${cleanText(body?.shotFlow, 120) || "unchanged"}.`,
      `References:\n${referenceSummary(body?.references) || "No attached references."}`,
      `LoRAs:\n${loraSummary(body?.loras) || "No selected LoRAs."}`,
    ].join("\n");

    const instructions = [
      "You are the H3 AI Scene Director inside SLR Studios.",
      "Turn natural language into one concise MiniMax H3-compatible video prompt.",
      "Understand follow-up edits by preserving earlier scene instructions unless the user changes them.",
      "Do not alter locked generation settings, references, seeds, styles, LoRAs, or advanced controls.",
      "Use concrete cinematic language but avoid long generic padding.",
      "Return JSON only with keys prompt, reply, changes.",
      "prompt must be the final editable H3 scene prompt, one compact paragraph.",
      "reply must briefly explain what changed for the user.",
      "changes must be a short array of strings.",
    ].join(" ");

    const input = [
      {
        role: "user",
        content: [
          "LOCKED SETTINGS AND REFERENCES:",
          lockedSettings,
          "",
          "PREVIOUS DIRECTOR MEMORY:",
          sceneMemory || "(new conversation)",
          "",
          "CURRENT H3 PROMPT:",
          latestPrompt || "(empty)",
          "",
          "USER DIRECTION:",
          userText,
        ].join("\n"),
      },
    ];

    const result = await withAssistantProvider(resolveAssistantProvider(body.aiProvider),()=>createAssistantText({
      ownerKey: user.ownerKey,
      accountId:user.accountId,
      feature:"h3-director",
      requestKey,
      useCase: "h3-director",
      model: openAIModels().h3,
      instructions,
      input,
      maxOutputTokens: 650,
      timeoutMs: 90_000,
    }));

    let parsed: any;
    try {
      parsed = extractJsonObject(result.text);
    } catch {
      parsed = {
        prompt: result.text,
        reply: "I updated the H3 scene prompt.",
        changes: [],
      };
    }

    const prompt = normalizePrompt(parsed?.prompt);
    if (!prompt) {
      throw new Error("OpenAI returned an empty H3 prompt.");
    }

    const reply =
      cleanText(parsed?.reply, 1000) || "I updated the H3 scene prompt.";
    const changes = Array.isArray(parsed?.changes)
      ? parsed.changes
          .map((item: unknown) => cleanText(item, 160))
          .filter(Boolean)
          .slice(0, 6)
      : [];

    const conversation = upsertH3DirectorConversation({
      ownerKey: user.ownerKey,
      conversationId: previous?.id,
      userText,
      assistantText: reply,
      provider:result.provider,
      model:result.model,
      prompt,
    });

    return NextResponse.json(
      {
        ok: true,
        prompt,
        reply,
        changes,
        conversationId: conversation.id,
        promptVersions: conversation.promptVersions,
        usage: result.usage,
        model: result.model,
        provider:result.provider,
        fallbackReason:result.fallbackReason,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}


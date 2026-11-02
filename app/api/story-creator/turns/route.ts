import { after, NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";
import { openAIEnabled } from "@/lib/openai/provider";
import {
  cancelStoryConversationTurn, createStoryConversationTurn, getStoryConversationTurn,
  getStoryCreatorMessage,
  undoStoryConversationMemory,
  listStoryWritingTurns,
} from "@/lib/storyCreator/store";
import { abortStoryConversationExecution, executeStoryConversationTurn } from "@/lib/storyCreator/conversationExecutor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const status = error instanceof SessionInvalidError ? 401
    : code.includes("NOT_FOUND") ? 404 : code === "STORY_TURN_BUSY" ? 409 : 400;
  return NextResponse.json({ ok: false, error: status === 401 ? "Unauthorized"
    : error instanceof Error ? error.message : "Story reply request failed.", code }, { status, headers });
}

export async function GET(request: NextRequest) {
  try {
    const { ownerKey } = await requireSessionUser(request);
    const projectId = request.nextUrl.searchParams.get("projectId") || "";
    if (request.nextUrl.searchParams.get("view") === "writing") return NextResponse.json({ ok: true,
      versions: listStoryWritingTurns({ ownerKey, projectId }) }, { headers });
    const turn = getStoryConversationTurn({ ownerKey, projectId,
      turnId: request.nextUrl.searchParams.get("turnId") || undefined,
      sourceMessageId: request.nextUrl.searchParams.get("sourceMessageId") || undefined });
    const message = turn?.assistantMessageId ? getStoryCreatorMessage({ ownerKey, projectId,
      messageId: turn.assistantMessageId }) : null;
    return NextResponse.json({ ok: true, turn, message }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { ownerKey } = await requireSessionUser(request);
    const body = await request.json();
    const projectId = String(body.projectId || "");
    if (body.action === "undo-memory") {
      const turnId = String(body.turnId || "");
      if (!turnId) return NextResponse.json({ ok: false, error: "Missing turn." }, { status: 400, headers });
      return NextResponse.json({ ok: true, turn: undoStoryConversationMemory({ ownerKey, projectId, turnId }) }, { headers });
    }
    if (body.action === "cancel") {
      const identity = { ownerKey, projectId, turnId: String(body.turnId || "") };
      if (!identity.turnId) return NextResponse.json({ ok: false, error: "Missing turn." }, { status: 400, headers });
      const turn = cancelStoryConversationTurn(identity);
      abortStoryConversationExecution(identity);
      return NextResponse.json({ ok: true, turn }, { headers });
    }
    if (!openAIEnabled()) return NextResponse.json({ ok: false, error: "Story conversation is unavailable. Your saved messages are unchanged." }, { status: 503, headers });
    const purpose = body.purpose === "writing" ? "writing" : "conversation";
    const writingMode = purpose === "writing" && ["outline", "chapter", "episode", "scene", "dialogue"].includes(body.writingMode) ? body.writingMode : "";
    if (purpose === "writing" && !writingMode) return NextResponse.json({ ok: false, error: "Choose a writing mode." }, { status: 400, headers });
    const result = createStoryConversationTurn({ ownerKey, projectId, purpose, writingMode,
      sourceMessageId: String(body.sourceMessageId || "") });
    if (result.created) after(() => executeStoryConversationTurn({ ownerKey, projectId, turnId: result.turn.id }));
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 202 : 200, headers });
  } catch (error) { return failure(error); }
}

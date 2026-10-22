import { NextRequest, NextResponse } from "next/server";

import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";
import {
  getStoryProductionPlan,
  listStoryCreatorMessages,
  listStoryBibleEntities,
  listStoryBibleFacts,
  listStoryVisualAssets,
} from "@/lib/storyCreator/store";
import { resolveStoryVisualDirectorAction } from "@/lib/storyCreator/visualActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json().catch(() => ({}));
    const projectId = String(body.projectId || "").trim();
    const messages = listStoryCreatorMessages({ ownerKey: user.ownerKey, projectId });
    const instruction = String(body.instruction || "").trim();
    const conversationContext = messages
      .filter((message) => message.content.trim() !== instruction)
      .slice(-4)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n")
      .slice(-5000);
    const action = resolveStoryVisualDirectorAction({
      instruction,
      conversationContext,
      entities: listStoryBibleEntities({ ownerKey: user.ownerKey, projectId }),
      facts: listStoryBibleFacts({ ownerKey: user.ownerKey, projectId }),
      assets: listStoryVisualAssets({ ownerKey: user.ownerKey, projectId }),
      plan: getStoryProductionPlan({ ownerKey: user.ownerKey, projectId }),
    });
    return NextResponse.json({ ok: true, action }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Story Director could not prepare that visual action.",
    }, {
      status: error instanceof SessionInvalidError ? 401 : 400,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

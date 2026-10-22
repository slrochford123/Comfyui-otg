import { NextRequest, NextResponse } from "next/server";

import { estimateOpenAIUsageCost, readOpenAIUsageRecords } from "@/lib/openai/provider";
import { requireSessionUser } from "@/lib/sessionUser";
import { listStoryCreatorProjects } from "@/lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    const owned = listStoryCreatorProjects(user.ownerKey).some((project) => project.id === projectId);
    if (!owned) {
      return NextResponse.json({ ok: false, error: "Story project not found." }, { status: 404 });
    }
    const all = readOpenAIUsageRecords();
    const records = all.filter((record) =>
      record.ownerKey === user.ownerKey && record.projectId === projectId,
    );
    const unattributedLegacyCount = all.filter((record) =>
      record.ownerKey === user.ownerKey && !record.projectId &&
      ["story-helper", "story-write", "transcribe"].includes(record.useCase),
    ).length;
    const costUsd = records.reduce((sum, record) => sum + estimateOpenAIUsageCost(record), 0);
    return NextResponse.json({
      ok: true,
      projectId,
      costUsd,
      requestCount: records.length,
      status: unattributedLegacyCount ? "partial" : "actual",
      unattributedLegacyCount,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Usage is unavailable." }, {
      status: 401,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

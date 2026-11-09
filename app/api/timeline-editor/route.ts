import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { RequestError } from "@/lib/requestError";
import { limitedJson } from "@/lib/limitedRequestBody";
import {
  createEditorProject,
  editorProject,
  listEditorProjects,
  requireTimelineEditor,
  saveEditorProject,
  TIMELINE_EDITOR_VERSION,
} from "@/lib/timelineEditor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import {
  editorHeaders as headers,
  editorFailure,
  requireEditorOrigin,
} from "@/lib/timelineEditor/http";
export async function GET(request: NextRequest) {
  try {
    requireTimelineEditor();
    const { ownerKey } = await requireSessionUser(request);
    const id = request.nextUrl.searchParams.get("id");
    return NextResponse.json(
      id
        ? { ok: true, project: editorProject(ownerKey, id) }
        : {
            ok: true,
            projects: listEditorProjects(ownerKey),
            editorVersion: TIMELINE_EDITOR_VERSION,
          },
      { headers },
    );
  } catch (error) {
    return editorFailure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    requireTimelineEditor();
    const { ownerKey } = await requireSessionUser(request);
    requireEditorOrigin(request);
    const body = await limitedJson(request, 4 * 1024 * 1024 + 16384);
    const project =
      body.action === "create"
        ? createEditorProject(
            ownerKey,
            body.name,
            typeof body.requestId === "string" ? body.requestId : undefined,
          )
        : body.action === "save"
          ? saveEditorProject(
              ownerKey,
              String(body.id),
              body.revision,
              body.state,
            )
          : null;
    if (!project)
      throw new RequestError("Choose a supported editor action.", 400);
    return NextResponse.json({ ok: true, project }, { headers });
  } catch (error) {
    return editorFailure(error);
  }
}

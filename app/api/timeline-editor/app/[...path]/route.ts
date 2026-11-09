import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { RequestError } from "@/lib/requestError";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { requireTimelineEditor } from "@/lib/timelineEditor/store";
import { editorFailure } from "@/lib/timelineEditor/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    requireTimelineEditor();
    await requireSessionUser(request);
    const root = path.resolve(process.cwd(), "timeline-editor"),
      parts = (await context.params).path;
    if (parts.some((part) => part === ".." || part.includes("\\")))
      throw new RequestError("Not found.", 404);
    const file = path.resolve(root, ...parts);
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile() ||
      fs.lstatSync(file).isSymbolicLink()
    )
      throw new RequestError("Not found.", 404);
    const type = file.endsWith(".js")
      ? "application/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".gz")
            ? "application/gzip"
            : undefined;
    return mediaFileResponse(request, file, {
      contentType: type,
      cacheControl: "private, no-store",
      download: file.endsWith(".tar.gz"),
    });
  } catch (error) {
    return editorFailure(error);
  }
}

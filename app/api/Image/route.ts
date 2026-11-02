import path from "node:path";
import { NextRequest } from "next/server";
import { GET as ownedFile } from "@/app/api/file/route";
import { userGalleryDir } from "@/lib/paths";
import { withOwner, RequestError } from "@/lib/routeSecurity";

export const runtime = "nodejs";
/** Legacy alias: device labels never select a filesystem root or another owner. */
export const GET = withOwner(async (request, owner) => {
  const relative = request.nextUrl.searchParams.get("rel") || "";
  if (!relative || path.isAbsolute(relative) || relative.includes("\\") || relative.split("/").some(part => part === "..")) {
    throw new RequestError("Invalid media reference.", 400);
  }
  if (!/\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|mkv|wav|mp3|m4a|ogg|flac)$/i.test(relative)) {
    throw new RequestError("Unsupported media type.", 400);
  }
  const target = new URL("/api/file", request.url);
  target.searchParams.set("path", path.join(userGalleryDir(owner.ownerKey), relative));
  return ownedFile(new NextRequest(target, { headers: request.headers }));
});

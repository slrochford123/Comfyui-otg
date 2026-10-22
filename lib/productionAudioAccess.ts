import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";
import { GET as ownerMediaFile } from "@/app/api/file/route";

export class ProductionAudioAccessError extends Error {
  constructor(message = "Source media is unavailable for this account.") { super(message); }
}

export async function productionAudioOwner(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    if (!user.username || !user.ownerKey) throw new SessionInvalidError();
    return user.ownerKey;
  } catch { throw new SessionInvalidError(); }
}

// Reuse the realpath-contained, owner-scoped download policy before FFmpeg
// opens any client-supplied source or background stem. Never fetch arbitrary
// source URLs or forward the user's cookie to another origin.
export async function productionAudioMediaReadable(request: NextRequest, file: string) {
  const url = new URL("/api/file", request.url);
  url.searchParams.set("path", file);
  const headers = new Headers(request.headers);
  headers.set("range", "bytes=0-0");
  const response = await ownerMediaFile(new NextRequest(url, { headers }));
  await response.body?.cancel();
  return response.ok;
}

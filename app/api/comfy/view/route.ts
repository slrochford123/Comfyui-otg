import { withOwner } from "@/lib/routeSecurity";
import { serveOwnedComfyMedia } from "@/lib/comfyMediaAccess";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withOwner(serveOwnedComfyMedia);
export const HEAD = withOwner(serveOwnedComfyMedia);

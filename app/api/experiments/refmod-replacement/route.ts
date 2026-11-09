import { labRoute } from "@/lib/experiments/http";
import { replacementGet, replacementPost } from "@/lib/refmodLab/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = labRoute(replacementGet);
export const POST = labRoute(replacementPost);

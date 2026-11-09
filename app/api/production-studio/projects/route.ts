import { NextRequest } from "next/server";
import {
  authorize,
  body,
  studio,
  json,
  failure,
} from "@/lib/productionStudio/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const u = await authorize(req);
    return json({ projects: studio().list(u.ownerKey) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const u = await authorize(req, true),
      b = await body(req);
    return json(
      {
        project: studio().create(
          u.ownerKey,
          String(b.name || "Untitled production"),
        ),
      },
      201,
    );
  } catch (e) {
    return failure(e);
  }
}

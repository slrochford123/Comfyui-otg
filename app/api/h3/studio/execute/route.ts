import { NextRequest } from "next/server";
import { executeH3Studio } from "@/lib/h3StudioExecution";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { return executeH3Studio(request); }

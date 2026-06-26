/* OTG_ELEVENLABS_PREVIEW_BACKEND_P1 */
import { NextResponse } from "next/server";
import { getElevenLabsStatus } from "@/lib/elevenlabsVoiceDesign";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getElevenLabsStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ElevenLabs status error.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
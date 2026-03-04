import { NextResponse } from "next/server";

// Lowercase, stable health endpoint for deploy gates.
// Keep /api/Health for backward compatibility.
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}

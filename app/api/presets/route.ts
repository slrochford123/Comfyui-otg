import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const PRESETS_DIR = path.join(process.cwd(), "presets");

export async function GET() {
  try {
    if (!fs.existsSync(PRESETS_DIR)) {
      return NextResponse.json({ presets: [] });
    }

    const presets = fs
      .readdirSync(PRESETS_DIR)
      .filter((f) => f.toLowerCase().endsWith(".json"));

    return NextResponse.json({ presets });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

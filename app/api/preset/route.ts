import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const PRESETS_DIR = path.join(process.cwd(), "presets");

export async function POST(req: Request) {
  try {
    const { name } = await req.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing preset name" }, { status: 400 });
    }

    const filePath = path.join(PRESETS_DIR, name);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: `Preset not found: ${name}` },
        { status: 404 }
      );
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw);

    return NextResponse.json(json, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

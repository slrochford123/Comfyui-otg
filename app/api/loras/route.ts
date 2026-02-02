import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const loraDir =
      process.env.COMFY_LORA_DIR
        ? path.resolve(process.env.COMFY_LORA_DIR)
        : null;

    if (!loraDir) {
      throw new Error("COMFY_LORA_DIR not set");
    }

    if (!fs.existsSync(loraDir)) {
      throw new Error(`LoRA directory not found: ${loraDir}`);
    }

    const loras = fs
      .readdirSync(loraDir)
      .filter((f) =>
        f.toLowerCase().endsWith(".safetensors") ||
        f.toLowerCase().endsWith(".pt")
      )
      .sort((a, b) => a.localeCompare(b));

    return NextResponse.json(
      { loras },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { loras: [], error: String(err?.message ?? err) },
      { status: 200 }
    );
  }
}

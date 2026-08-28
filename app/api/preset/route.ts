import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const PRESETS_DIR = path.join(process.cwd(), "comfy_workflows", "presets");

function candidatePresetPaths(name: string) {
  const raw = String(name || "").trim();
  if (!raw) return [] as string[];

  const trimmed = raw.replace(/^presets\//i, "").replace(/\\/g, "/").trim();
  const base = path.basename(trimmed);
  const withJson = base.toLowerCase().endsWith(".json") ? base : `${base}.json`;

  return Array.from(new Set([
    path.join(PRESETS_DIR, base),
    path.join(PRESETS_DIR, withJson),
  ]));
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing preset name" }, { status: 400 });
    }

    const filePath = candidatePresetPaths(name).find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
      return NextResponse.json({ error: `Preset not found: ${name}` }, { status: 404 });
    }

    const raw = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
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

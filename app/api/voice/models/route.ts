import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext } from "@/lib/ownerKey";
import { listCharacters } from "@/lib/characters/store";
import { OTG_DATA_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VOICES_ROOT = process.env.OTG_VOICES_ROOT || "C:\\AI\\Voices";
const AUDIO_RE = /\.(wav|mp3|flac|m4a|aac|ogg|webm)$/i;
const MODEL_RE = /\.(pth|pt|ckpt|safetensors|onnx)$/i;
const IGNORE_SEGMENTS = new Set([
  "venv",
  ".venv",
  "env",
  "node_modules",
  "site-packages",
  "test_data",
  "tests",
  "__pycache__",
  ".git",
  "scipy",
  "dist-info",
  "egg-info",
]);

const ALLOWED_TOP = ["Parler", "qwen 3", "Seed-Vc", "Seed-VC", "SeedVC", "XTTS"];

type VoiceEngine = "seed-vc" | "xtts" | "reference" | "character";

type VoiceItem = {
  id: string;
  name: string;
  engine: VoiceEngine;
  path: string;
  displayPath: string;
  modelPath?: string;
  indexPath?: string;
  samplePath?: string;
  characterId?: string;
  usable: boolean;
  notes?: string;
  mtimeMs: number;
};

function shouldIgnore(full: string) {
  const parts = path.resolve(full).split(/[\\/]+/).map((part) => part.toLowerCase());
  return parts.some((part) => IGNORE_SEGMENTS.has(part));
}

function safeId(value: string) {
  return Buffer.from(value).toString("base64url");
}

function listFiles(dir: string, maxDepth = 4) {
  const files: string[] = [];
  function walk(current: string, depth: number) {
    if (depth > maxDepth || shouldIgnore(current)) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (shouldIgnore(full)) continue;
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) files.push(full);
    }
  }
  walk(dir, 0);
  return files;
}

function newest(files: string[], re: RegExp) {
  return files
    .filter((file) => re.test(file))
    .map((file) => ({ file, stat: fs.statSync(file) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
}

function displayPath(value: string) {
  const resolved = path.resolve(value);
  const voicesRoot = path.resolve(VOICES_ROOT);
  const dataRoot = path.resolve(OTG_DATA_ROOT);
  if (resolved.toLowerCase().startsWith(voicesRoot.toLowerCase())) return resolved.replace(voicesRoot, "C:\\AI\\Voices");
  if (resolved.toLowerCase().startsWith(dataRoot.toLowerCase())) return resolved.replace(dataRoot, "OTG_DATA_ROOT");
  return resolved;
}

function makeItem(args: Omit<VoiceItem, "id" | "displayPath">): VoiceItem {
  return {
    ...args,
    id: safeId(`${args.engine}:${args.path}:${args.characterId || ""}`),
    displayPath: displayPath(args.path),
  };
}

function hasSeedVcRuntime() {
  const root = path.resolve(process.env.SEED_VC_ROOT || path.join(VOICES_ROOT, "Seed-Vc"));
  const script = process.env.SEED_VC_SCRIPT || path.join(root, "inference.py");
  return Boolean(process.env.SEEDVC_DUB_COMMAND?.trim() || fs.existsSync(script) || fs.existsSync(path.join(root, "inference_v2.py")));
}

function scanTopFolder(topPath: string): VoiceItem[] {
  const base = path.basename(topPath);
  const files = listFiles(topPath, 4);
  const items: VoiceItem[] = [];
  const latestAudio = newest(files, AUDIO_RE);

  if (/seed[-_ ]?vc/i.test(base)) {
    const model = newest(files, MODEL_RE)?.file;
    const installed = hasSeedVcRuntime();
    items.push(makeItem({
      name: installed ? "Seed-VC zero-shot converter" : "Seed-VC folder detected",
      engine: "seed-vc",
      path: topPath,
      modelPath: model,
      samplePath: latestAudio?.file,
      usable: installed || Boolean(model || latestAudio),
      notes: installed
        ? "Seed-VC runtime detected. Uses selected character/reference audio as the target voice."
        : "Seed-VC folder exists but inference.py was not found yet. Install Seed-VC or set SEEDVC_DUB_COMMAND.",
      mtimeMs: newest(files, /\.(py|pth|pt|ckpt|safetensors|onnx|wav|mp3|flac|m4a)$/i)?.stat.mtimeMs || 0,
    }));
    return items;
  }

  if (/xtts/i.test(base)) {
    items.push(makeItem({
      name: "XTTS fallback",
      engine: "xtts",
      path: topPath,
      samplePath: latestAudio?.file,
      usable: Boolean(latestAudio),
      notes: latestAudio ? "Reference audio found. This is transcript-based fallback, not true voice-to-voice conversion." : "XTTS folder found, but no reference audio was found outside ignored folders.",
      mtimeMs: latestAudio?.stat.mtimeMs || 0,
    }));
    return items;
  }

  if (latestAudio) {
    const outputsDir = files.some((file) => /[\\/]outputs[\\/]/i.test(file)) ? path.join(topPath, "outputs") : path.dirname(latestAudio.file);
    items.push(makeItem({
      name: `${base} latest reference audio`,
      engine: "reference",
      path: outputsDir,
      samplePath: latestAudio.file,
      usable: false,
      notes: "Reference audio only. Use a Characters tab voice or Seed-VC for performance conversion.",
      mtimeMs: latestAudio.stat.mtimeMs,
    }));
  }
  return items;
}

async function scanCharacterVoices(req: NextRequest): Promise<VoiceItem[]> {
  try {
    const { ownerKey } = await getOwnerContext(req);
    return listCharacters(ownerKey)
      .filter((character) => {
        const audioPath = String(character.referenceAudioPath || "").trim();
        return Boolean(audioPath && AUDIO_RE.test(audioPath) && fs.existsSync(audioPath) && !shouldIgnore(audioPath));
      })
      .map((character) => {
        const audioPath = path.resolve(String(character.referenceAudioPath || ""));
        const stat = fs.statSync(audioPath);
        return makeItem({
          name: `${character.name} [Character Voice]`,
          engine: "character",
          path: audioPath,
          samplePath: audioPath,
          characterId: character.id,
          usable: true,
          notes: "Saved Characters tab reference voice. Seed-VC can use this as the target voice for your recorded performance.",
          mtimeMs: stat.mtimeMs || Date.parse(character.updatedAt || character.createdAt || "") || 0,
        });
      });
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const characterItems = await scanCharacterVoices(req);
    const folderItems = fs.existsSync(VOICES_ROOT)
      ? fs.readdirSync(VOICES_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && ALLOWED_TOP.some((allowed) => allowed.toLowerCase() === entry.name.toLowerCase()))
        .flatMap((entry) => scanTopFolder(path.join(VOICES_ROOT, entry.name)))
      : [];

    const items = [...characterItems, ...folderItems]
      .sort((a, b) => Number(b.engine === "character") - Number(a.engine === "character") || Number(b.usable) - Number(a.usable) || b.mtimeMs - a.mtimeMs)
      .map(({ mtimeMs, ...item }) => item);

    return NextResponse.json({ ok: true, root: VOICES_ROOT, seedVcRuntimeDetected: hasSeedVcRuntime(), characterVoiceCount: characterItems.length, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Voice scan failed" }, { status: 500 });
  }
}

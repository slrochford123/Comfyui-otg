import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { getVoiceById, ownerPrefix, resolveVoicesFile, voicesRoot } from "@/lib/voicesStudio";
import { ensureDir, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type DubbingResult = {
  ok: boolean;
  output_path?: string;
  error?: string;
  raw?: any;
};

function boolFromForm(v: FormDataEntryValue | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function numFromForm(v: FormDataEntryValue | null, fallback: number, lo: number, hi: number): number {
  const n = Number(v == null ? fallback : v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function extForUpload(nameRaw: string): string {
  const ext = path.extname(nameRaw || "").toLowerCase();
  if ([".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"].includes(ext)) return ext;
  return ".wav";
}

function dubbingOwnerRoot(ownerKey: string): string {
  const root = safeJoin(voicesRoot(), "dubbing", ownerPrefix(ownerKey));
  ensureDir(root);
  ensureDir(safeJoin(root, "inputs"));
  ensureDir(safeJoin(root, "outputs"));
  return root;
}

function runSeedVc(py: string, script: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(py, [script, ...args], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err && (err as any).killed) {
        return reject(new Error(`Seed-VC dubbing timed out after ${timeoutMs}ms`));
      }
      const code = (err as any)?.code ?? 0;
      resolve({ code: typeof code === "number" ? code : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
    child.on("error", reject);
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const form = await req.formData();

    const voiceId = String(form.get("voiceId") || "").trim();
    if (!voiceId) return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });

    const voice = getVoiceById(user.ownerKey, voiceId);
    if (!voice) return NextResponse.json({ ok: false, error: "Voice not found" }, { status: 404 });
    if (!voice.refAudioRel) return NextResponse.json({ ok: false, error: "Voice has no reference audio" }, { status: 400 });

    const source = form.get("source");
    if (!(source instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing source audio file" }, { status: 400 });
    }

    const ownerRoot = dubbingOwnerRoot(user.ownerKey);
    const inputDir = safeJoin(ownerRoot, "inputs");
    const outputDir = safeJoin(ownerRoot, "outputs");

    const jobId = `dub_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const sourceExt = extForUpload(source.name);
    const sourcePath = safeJoin(inputDir, `${jobId}${sourceExt}`);
    const sourceBuf = Buffer.from(await source.arrayBuffer());
    fs.writeFileSync(sourcePath, sourceBuf);

    const referencePath = resolveVoicesFile(voice.refAudioRel);
    if (!fs.existsSync(referencePath)) {
      return NextResponse.json({ ok: false, error: "Reference audio file is missing on disk" }, { status: 404 });
    }

    const outputPath = safeJoin(outputDir, `${jobId}.wav`);
    const metaPath = safeJoin(outputDir, `${jobId}.json`);

    const py = (process.env.SEED_VC_PYTHON || "D:\\AI\\seed-vc\\.venv\\Scripts\\python.exe").trim();
    const seedVcUrl = (process.env.SEED_VC_URL || "http://127.0.0.1:7860").trim().replace(/\/+$/, "");
    const timeoutMs = Math.max(60_000, Number(process.env.SEED_VC_TIMEOUT_MS || 600_000));
    const script = path.join(process.cwd(), "scripts", "seedvc", "dub.py");

    const args = [
      "--server-url", seedVcUrl,
      "--source", sourcePath,
      "--reference", referencePath,
      "--out", outputPath,
      "--steps", String(numFromForm(form.get("steps"), 30, 1, 200)),
      "--length-adjust", String(numFromForm(form.get("lengthAdjust"), 1, 0.5, 2.0)),
      "--intelligibility", String(numFromForm(form.get("intelligibilityCfgRate"), 0, 0, 1)),
      "--similarity", String(numFromForm(form.get("similarityCfgRate"), 0.7, 0, 1)),
      "--top-p", String(numFromForm(form.get("topP"), 0.9, 0.1, 1)),
      "--temperature", String(numFromForm(form.get("temperature"), 1.0, 0.1, 2.0)),
      "--repetition-penalty", String(numFromForm(form.get("repetitionPenalty"), 1.0, 1.0, 3.0)),
    ];
    if (boolFromForm(form.get("convertStyle"), true)) args.push("--convert-style");
    if (boolFromForm(form.get("anonymizationOnly"), false)) args.push("--anonymization-only");

    const r = await runSeedVc(py, script, args, timeoutMs);
    const raw = (r.stdout || "").trim();

    let parsed: DubbingResult | null = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!parsed?.ok || !parsed.output_path || !fs.existsSync(parsed.output_path)) {
      const msg = parsed?.error || r.stderr || raw || "Seed-VC dubbing failed";
      return NextResponse.json({ ok: false, error: msg.slice(0, 2000) }, { status: 500 });
    }

    const rel = path.posix.join("dubbing", ownerPrefix(user.ownerKey), "outputs", path.basename(outputPath));
    const meta = {
      jobId,
      voiceId,
      voiceName: voice.name,
      sourceOriginalName: source.name,
      sourceSavedAs: path.basename(sourcePath),
      outputRel: rel,
      engine: "seed-vc-v2",
      seedVcUrl,
      settings: {
        steps: numFromForm(form.get("steps"), 30, 1, 200),
        lengthAdjust: numFromForm(form.get("lengthAdjust"), 1, 0.5, 2.0),
        intelligibilityCfgRate: numFromForm(form.get("intelligibilityCfgRate"), 0, 0, 1),
        similarityCfgRate: numFromForm(form.get("similarityCfgRate"), 0.7, 0, 1),
        topP: numFromForm(form.get("topP"), 0.9, 0.1, 1),
        temperature: numFromForm(form.get("temperature"), 1.0, 0.1, 2.0),
        repetitionPenalty: numFromForm(form.get("repetitionPenalty"), 1.0, 1.0, 3.0),
        convertStyle: boolFromForm(form.get("convertStyle"), true),
        anonymizationOnly: boolFromForm(form.get("anonymizationOnly"), false),
      },
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    return NextResponse.json(
      {
        ok: true,
        message: "Voice dubbing complete.",
        audioUrl: `/api/voices/dubbing/file?rel=${encodeURIComponent(rel)}`,
        rel,
        meta,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}

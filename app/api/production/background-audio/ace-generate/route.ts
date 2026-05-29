import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i;

function fileUrlFor(absPath: string) {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

function aceApiBase() {
  return String(process.env.ACE_STEP_API_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
}

function collectStrings(value: unknown, out: string[] = []) {
  if (typeof value === "string") {
    const raw = value.trim();

    if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
      try {
        collectStrings(JSON.parse(raw), out);
        return out;
      } catch {
        // Keep raw string fallback below.
      }
    }

    out.push(raw);
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
    return out;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    ["file", "audio", "audio_url", "audioUrl", "url", "path", "output", "result"].forEach((key) => {
      if (record[key] !== undefined) collectStrings(record[key], out);
    });

    Object.values(record).forEach((item) => collectStrings(item, out));
  }

  return out;
}

function firstAudioCandidate(result: unknown) {
  const strings = collectStrings(result)
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  /*
    OTG_ACE15_EXTRACT_FILE_FIELD_DOWNLOAD_FIX_V1:
    ACE-Step 1.5 query_result may return a JSON-stringified array where each
    item has { file: "/v1/audio?path=..." }. Do not wrap that whole JSON
    string as the path. Extract the nested file URL first.
  */
  return (
    strings.find((item) => /\/v1\/audio\?path=/i.test(item)) ||
    strings.find((item) => /^https?:\/\/.+\/v1\/audio\?path=/i.test(item)) ||
    strings.find((item) => /^https?:\/\/.+\.(mp3|wav|m4a|aac|ogg|flac|webm)(\?|#|$)/i.test(item)) ||
    strings.find((item) => /(^|[\\/])[^\\/]+\.(mp3|wav|m4a|aac|ogg|flac|webm)(\?|#|$)/i.test(item)) ||
    ""
  );
}

function absoluteAceAudioUrl(candidate: string) {
  const base = aceApiBase();
  const raw = String(candidate || "").trim();

  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) return raw;

  if (raw.startsWith("/v1/audio?path=")) {
    return `${base}${raw}`;
  }

  if (raw.startsWith("/")) {
    return `${base}${raw}`;
  }

  return `${base}/v1/audio?path=${encodeURIComponent(raw)}`;
}

function basenameOnly(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://otg.local");

    const queryName =
      parsed.searchParams.get("name") ||
      parsed.searchParams.get("filename") ||
      parsed.searchParams.get("fileName") ||
      parsed.searchParams.get("path") ||
      "";

    return path.basename(decodeURIComponent(queryName || parsed.pathname || raw));
  } catch {
    return path.basename(raw.replace(/\\/g, "/"));
  }
}

function localPathFromFileUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://otg.local");

    if (parsed.pathname !== "/api/file") return "";
    return String(parsed.searchParams.get("path") || "").trim();
  } catch {
    return "";
  }
}

async function fetchToTempFile(req: NextRequest, value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const absoluteUrl = raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : new URL(raw, req.nextUrl.origin).toString();

  const response = await fetch(absoluteUrl, {
    method: "GET",
    cache: "no-store",
    headers: {
      cookie: req.headers.get("cookie") || "",
    },
  });

  if (!response.ok) return "";

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) return "";

  const ext = AUDIO_EXT_RE.test(raw) ? path.extname(basenameOnly(raw)) || ".mp3" : ".mp3";
  const out = path.join(os.tmpdir(), `otg_ace_reference_${Date.now()}${ext}`);
  await fs.writeFile(out, bytes);
  return out;
}

async function resolveReferenceAudioPath(req: NextRequest, source: {
  referenceAudioPath?: string;
  referenceAudioUrl?: string;
  referenceAudioFileName?: string;
}) {
  const direct = String(source.referenceAudioPath || "").trim();
  if (direct && path.isAbsolute(direct) && fssync.existsSync(direct)) return path.normalize(direct);

  const fromFileUrl = localPathFromFileUrl(source.referenceAudioUrl);
  if (fromFileUrl && path.isAbsolute(fromFileUrl) && fssync.existsSync(fromFileUrl)) return path.normalize(fromFileUrl);

  if (source.referenceAudioUrl) {
    const downloaded = await fetchToTempFile(req, source.referenceAudioUrl);
    if (downloaded) return downloaded;
  }

  if (source.referenceAudioFileName) {
    const downloaded = await fetchToTempFile(req, `/api/gallery/file?name=${encodeURIComponent(source.referenceAudioFileName)}`);
    if (downloaded) return downloaded;
  }

  return "";
}

async function pollAceTask(taskId: string, timeoutMs: number) {
  const base = aceApiBase();
  const deadline = Date.now() + timeoutMs;
  const body = JSON.stringify({ task_id_list: [taskId] });

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await fetch(`${base}/query_result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(String(data?.error || `ACE query failed (${response.status}).`));

    const item = Array.isArray(data?.data) ? data.data[0] : data?.data;
    const status = Number(item?.status ?? data?.status ?? 0);

    if (status === 1) return data;
    if (status < 0 || status === 2 || status === 3) {
      throw new Error(String(item?.error || data?.error || "ACE generation failed."));
    }
  }

  throw new Error("ACE generation timed out before completion.");
}

async function readAceRequest(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const referenceAudio =
      (form.get("reference_audio") as any) ||
      (form.get("ref_audio") as any) ||
      (form.get("sampleAudio") as any) ||
      (form.get("sample_audio") as any);

    return {
      multipart: true,
      prompt: String(form.get("prompt") || "").trim(),
      lyrics: String(form.get("lyrics") || ""),
      productionId: String(form.get("productionId") || "production"),
      durationSeconds: Number(form.get("durationSeconds") || form.get("audio_duration") || 30) || 30,
      referenceAudio,
      referenceAudioPath: String(form.get("referenceAudioPath") || form.get("reference_audio_path") || ""),
      referenceAudioUrl: String(form.get("referenceAudioUrl") || form.get("reference_audio_url") || ""),
      referenceAudioFileName: String(form.get("referenceAudioFileName") || form.get("reference_audio_file_name") || ""),
      timeoutMs: Number(form.get("timeoutMs") || 240000) || 240000,
      mode: String(form.get("mode") || "reference").trim(),
      bpm: String(form.get("bpm") || ""),
      keyScale: String(form.get("keyScale") || form.get("key_scale") || ""),
    };
  }

  const body = await req.json().catch(() => ({}));

  return {
    multipart: false,
    prompt: String(body?.prompt || "").trim(),
    lyrics: String(body?.lyrics || ""),
    productionId: String(body?.productionId || "production"),
    durationSeconds: Number(body?.durationSeconds || body?.audio_duration || 30) || 30,
    referenceAudio: null,
    referenceAudioPath: String(body?.referenceAudioPath || body?.reference_audio_path || ""),
    referenceAudioUrl: String(body?.referenceAudioUrl || body?.reference_audio_url || ""),
    referenceAudioFileName: String(body?.referenceAudioFileName || body?.reference_audio_file_name || ""),
    timeoutMs: Number(body?.timeoutMs || 240000) || 240000,
    mode: String(body?.mode || "reference").trim(),
    bpm: String(body?.bpm || ""),
    keyScale: String(body?.keyScale || body?.key_scale || ""),
  };
}

async function submitAceReleaseTask(req: NextRequest, input: Awaited<ReturnType<typeof readAceRequest>>) {
  const base = aceApiBase();

  const durationSeconds = Math.max(10, Math.min(600, Number(input.durationSeconds || 30) || 30));
  const hasReferenceUpload = input.referenceAudio && typeof input.referenceAudio.arrayBuffer === "function";
  let referenceAudioPath = "";

  if (!hasReferenceUpload) {
    referenceAudioPath = await resolveReferenceAudioPath(req, input);
  }

  /*
    OTG_ACE_STEP_15_REFERENCE_AUDIO_V1:
    ACE-Step 1.5 supports reference_audio/ref_audio multipart uploads and
    reference_audio_path JSON fields for style transfer. We use that path to
    sample a short song/audio clip and generate a new music bed from it.
  */
  if (hasReferenceUpload) {
    const form = new FormData();
    form.append("prompt", input.prompt);
    form.append("lyrics", input.lyrics || "");
    form.append("audio_duration", String(durationSeconds));
    form.append("audio_format", "mp3");
    form.append("thinking", "false");
    form.append("batch_size", "1");
    form.append("model", "acestep-v15-turbo");
    form.append("reference_audio", input.referenceAudio, input.referenceAudio.name || "reference_audio.mp3");

    if (input.bpm) form.append("bpm", input.bpm);
    if (input.keyScale) form.append("key_scale", input.keyScale);

    return fetch(`${base}/release_task`, {
      method: "POST",
      body: form,
      cache: "no-store",
    });
  }

  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    lyrics: input.lyrics || "",
    audio_duration: durationSeconds,
    audio_format: "mp3",
    thinking: false,
    batch_size: 1,
    model: "acestep-v15-turbo",
  };

  if (referenceAudioPath) {
    payload.reference_audio_path = referenceAudioPath;
  }

  if (input.bpm) payload.bpm = Number(input.bpm) || input.bpm;
  if (input.keyScale) payload.key_scale = input.keyScale;

  return fetch(`${base}/release_task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.ACE_STEP_ENABLED === "0") {
      return NextResponse.json({ ok: false, error: "ACE-Step is disabled." }, { status: 400 });
    }

    /*
    OTG_ACE15_READ_BODY_BEFORE_OWNER_CONTEXT_V1:
    Read ACE music request data from a clone before owner/session handling.
    This prevents auth helpers from consuming the body before prompt parsing.
*/
    const inputReq = req.clone() as NextRequest;
    const input = await readAceRequest(inputReq);
    const owner = await getOwnerContext(req);

    const prompt = input.prompt;
    const productionId = safeSegment(String(input.productionId || "production").trim() || "production");
    const durationSeconds = Math.max(10, Math.min(600, Number(input.durationSeconds || 30) || 30));

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Prompt is required." }, { status: 400 });
    }

    const base = aceApiBase();

    const health = await fetch(`${base}/health`, { cache: "no-store" }).catch(() => null);
    if (!health?.ok) {
      return NextResponse.json({ ok: false, error: `ACE-Step 1.5 API is not reachable at ${base}.` }, { status: 503 });
    }

    const releaseResponse = await submitAceReleaseTask(req, input);
    const releaseData = await releaseResponse.json().catch(() => null);

    if (!releaseResponse.ok) {
      return NextResponse.json({ ok: false, error: String(releaseData?.error || "ACE-Step 1.5 release_task failed.") }, { status: 502 });
    }

    const taskId = String(releaseData?.data?.task_id || releaseData?.task_id || "").trim();
    if (!taskId) {
      return NextResponse.json({ ok: false, error: "ACE-Step 1.5 did not return a task_id.", releaseData }, { status: 502 });
    }

    const result = await pollAceTask(taskId, Math.max(30000, Math.min(600000, Number(input.timeoutMs || 240000) || 240000)));
    const candidate = firstAudioCandidate(result);
    const audioUrl = absoluteAceAudioUrl(candidate);

    if (!audioUrl) {
      return NextResponse.json({ ok: false, error: "ACE-Step 1.5 completed but no downloadable audio URL was found.", taskId, result }, { status: 502 });
    }

    const audioResponse = await fetch(audioUrl, { cache: "no-store" });
    if (!audioResponse.ok) {
      return NextResponse.json({ ok: false, error: `Could not download ACE-Step 1.5 audio (${audioResponse.status}).`, audioUrl }, { status: 502 });
    }

    const dir = path.join(
      OTG_DATA_ROOT,
      "productions",
      safeSegment(owner.ownerKey || "local"),
      productionId,
      "background-audio"
    );

    await ensureDir(dir);

    const audioPath = path.join(dir, `ace15_bg_${Date.now()}.mp3`);
    const bytes = Buffer.from(await audioResponse.arrayBuffer());

    if (!bytes.length) {
      return NextResponse.json({ ok: false, error: "ACE-Step 1.5 audio download was empty." }, { status: 502 });
    }

    await fs.writeFile(audioPath, bytes);

    return NextResponse.json({
      ok: true,
      provider: "ace-step-1.5",
      taskId,
      audioPath,
      audioUrl: fileUrlFor(audioPath),
      fileName: path.basename(audioPath),
      durationSeconds,
      prompt,
      referenceAudioUsed: Boolean(input.referenceAudio || input.referenceAudioPath || input.referenceAudioUrl || input.referenceAudioFileName),
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ ok: false, error: error?.message || "ACE-Step 1.5 generation failed." }, { status: 500 });
  }
}


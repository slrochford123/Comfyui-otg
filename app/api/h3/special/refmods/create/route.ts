import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { probeDurationSeconds } from "@/lib/ffmpeg";
import { isAcceptedH3MediaFile, supportedH3MediaExtensions, type H3InputMediaKind } from "@/lib/h3MediaTypes";
import {
  createH3RefModCreateJob,
  ensureH3RefModCreateJobRunner,
  getH3RefModCreateJob,
  getLatestH3RefModCreateJob,
  h3RefModCreatePublicStatus,
  startH3RefModCreateJob,
  validateH3RefModCreateJobInput,
} from "@/lib/h3SpecialModes/refModCreationJobs";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeJoin, safeSegment } from "@/lib/paths";
import {
  normalizeH3RefModCreateConfig,
  type H3RefModCreateConfigInput,
  type H3RefModCreateSource,
} from "@/lib/h3SpecialModes/refModCreation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExistingSourceInput = {
  path?: unknown;
  name?: unknown;
  kind?: unknown;
};

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

function parseConfig(form: FormData) {
  const raw = String(form.get("config") || "");
  return JSON.parse(raw || "{}") as H3RefModCreateConfigInput;
}

function errorResponse(error: unknown) {
  if (error instanceof SessionInvalidError) {
    return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return noStore({
    ok: false,
    error: error instanceof Error ? error.message : "H3 RefMod creation request failed.",
  }, { status: 400 });
}

function safeExt(kind: H3InputMediaKind, file: Pick<File, "name" | "type">) {
  const byName = path.extname(file.name || "").toLowerCase();
  if (supportedH3MediaExtensions(kind).includes(byName)) return byName;
  if (kind === "image") return ".png";
  if (kind === "video") return ".mp4";
  return ".wav";
}

function createUploadRoot(ownerKey: string, requestId: string) {
  const root = safeJoin(
    OTG_DATA_ROOT,
    "h3-special",
    "refmods",
    safeSegment(ownerKey),
    "uploads",
    safeSegment(requestId),
  );
  ensureDir(root);
  return root;
}

async function saveUploadedSource(
  ownerKey: string,
  requestId: string,
  file: File,
  kind: H3InputMediaKind,
  index: number,
): Promise<H3RefModCreateSource> {
  if (!isAcceptedH3MediaFile(kind, file)) {
    throw new Error(`Choose a supported RefMod ${kind} file (${supportedH3MediaExtensions(kind).join(", ")}).`);
  }
  const root = createUploadRoot(ownerKey, requestId);
  const ordinal = String(index + 1).padStart(2, "0");
  const ext = safeExt(kind, file);
  const bytes = Buffer.from(await file.arrayBuffer());

  if (kind === "image") {
    const originals = safeJoin(root, "originals");
    const normalized = safeJoin(root, "normalized");
    ensureDir(originals);
    ensureDir(normalized);
    await fsp.writeFile(safeJoin(originals, `${ordinal}${ext}`), bytes);
    const target = safeJoin(normalized, `${ordinal}.png`);
    const image = sharp(bytes, { animated: false, failOn: "error", limitInputPixels: false }).rotate();
    const metadata = await image.metadata();
    await image.png().toFile(target);
    return {
      path: target,
      name: path.basename(file.name || `${ordinal}.png`),
      kind: "image",
      width: metadata.width || null,
      height: metadata.height || null,
    };
  }

  const media = safeJoin(root, kind);
  ensureDir(media);
  const target = safeJoin(media, `${ordinal}${ext}`);
  await fsp.writeFile(target, bytes);
  const durationSeconds = await probeDurationSeconds(target);
  if (!Number.isFinite(durationSeconds)) {
    throw new Error(`Could not read the ${kind} duration for ${file.name || "upload"}.`);
  }
  return {
    path: target,
    name: path.basename(file.name || `${ordinal}${ext}`),
    kind,
    durationSeconds,
  };
}

async function sourceFromExisting(value: ExistingSourceInput): Promise<H3RefModCreateSource> {
  const sourcePath = String(value.path || "").trim();
  const kind = String(value.kind || "").trim() as H3InputMediaKind;
  if (!sourcePath || !path.isAbsolute(sourcePath)) throw new Error("Existing RefMod source path must be absolute.");
  if (!["image", "video", "audio"].includes(kind)) throw new Error("Existing RefMod source kind is invalid.");
  const stat = await fsp.stat(sourcePath).catch(() => null);
  if (!stat?.isFile()) throw new Error("Existing RefMod source file is not readable.");
  return {
    path: sourcePath,
    name: String(value.name || path.basename(sourcePath)),
    kind,
    durationSeconds: kind === "image" ? null : await probeDurationSeconds(sourcePath),
  };
}

async function multipartSources(
  form: FormData,
  ownerKey: string,
  requestId: string,
  config: H3RefModCreateConfigInput,
) {
  const normalized = normalizeH3RefModCreateConfig(config);
  if (normalized.kind === "character") {
    const files = form.getAll("images").filter((item): item is File => item instanceof File && item.size > 0);
    return Promise.all(files.map((file, index) => saveUploadedSource(ownerKey, requestId, file, "image", index)));
  }
  if (normalized.kind === "motion") {
    const file = form.get("video");
    return file instanceof File && file.size > 0
      ? [await saveUploadedSource(ownerKey, requestId, file, "video", 0)]
      : [];
  }
  const file = form.get("audio");
  return file instanceof File && file.size > 0
    ? [await saveUploadedSource(ownerKey, requestId, file, "audio", 0)]
    : [];
}

async function startCreateJob(
  ownerKey: string,
  owner: Awaited<ReturnType<typeof getOwnerContext>>,
  config: H3RefModCreateConfigInput,
  sources: H3RefModCreateSource[],
) {
  const input = validateH3RefModCreateJobInput({ config, sources });
  const job = await createH3RefModCreateJob(ownerKey, input, owner);
  startH3RefModCreateJob(job);
  return noStore({ ok: true, job: h3RefModCreatePublicStatus(job) }, { status: 202 });
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const id = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = id
      ? await getH3RefModCreateJob(owner.ownerKey, id)
      : await getLatestH3RefModCreateJob(owner.ownerKey);
    if (!job) {
      return id
        ? noStore({ ok: false, error: "H3 RefMod creation job not found." }, { status: 404 })
        : noStore({ ok: true, job: null });
    }
    ensureH3RefModCreateJobRunner(job);
    return noStore({ ok: true, job: h3RefModCreatePublicStatus(job) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const requestId = crypto.randomUUID();
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json().catch(() => null) as {
        config?: H3RefModCreateConfigInput;
        sources?: ExistingSourceInput[];
      } | null;
      const sources = await Promise.all((body?.sources || []).map(sourceFromExisting));
      return await startCreateJob(owner.ownerKey, owner, body?.config || {}, sources);
    }

    const form = await req.formData();
    const config = parseConfig(form);
    const sources = await multipartSources(form, owner.ownerKey, requestId, config);
    return await startCreateJob(owner.ownerKey, owner, config, sources);
  } catch (error) {
    return errorResponse(error);
  }
}

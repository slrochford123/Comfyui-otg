$ErrorActionPreference = "Stop"

$Repo = "C:\AI\OTG-Test2"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Repo ".patch-backups\elevenlabs-preview-backend-p1-$Stamp"

$Files = @(
  "lib\elevenlabsVoiceDesign.ts",
  "app\api\voice-lab\elevenlabs\status\route.ts",
  "app\api\voice-lab\elevenlabs\design-preview\route.ts",
  "app\api\voice-lab\elevenlabs\file\route.ts",
  "docs\OTG_REWORK_CHECKLIST.md"
)

Write-Host "Creating backup: $BackupRoot"
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

foreach ($rel in $Files) {
  $src = Join-Path $Repo $rel
  if (Test-Path -LiteralPath $src) {
    $dst = Join-Path $BackupRoot $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
    Write-Host "Backed up: $rel"
  }
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

$LibPath = Join-Path $Repo "lib\elevenlabsVoiceDesign.ts"
$StatusPath = Join-Path $Repo "app\api\voice-lab\elevenlabs\status\route.ts"
$DesignPath = Join-Path $Repo "app\api\voice-lab\elevenlabs\design-preview\route.ts"
$FilePath = Join-Path $Repo "app\api\voice-lab\elevenlabs\file\route.ts"
$ChecklistPath = Join-Path $Repo "docs\OTG_REWORK_CHECKLIST.md"

$LibContent = @'
/* OTG_ELEVENLABS_PREVIEW_BACKEND_P1 */
import path from "node:path";
import { promises as fs } from "node:fs";

export type ElevenLabsPreviewRecord = {
  generatedVoiceId: string;
  mediaType: string;
  durationSecs: number | null;
  language: string | null;
  audioPath: string;
  audioUrl: string;
};

export type ElevenLabsDesignPreviewInput = {
  voiceDescription: string;
  sampleText: string;
  seed?: number | null;
  loudness?: number | null;
  guidanceScale?: number | null;
  quality?: number | null;
  shouldEnhance?: boolean | null;
};

export type ElevenLabsStatus = {
  enabled: boolean;
  configured: boolean;
  characterCount: number | null;
  remoteCharacterLimit: number | null;
  localMonthlyLimit: number;
  effectiveLimit: number | null;
  minRemainingChars: number;
  remaining: number | null;
  canGenerate: boolean;
  model: string;
  outputFormat: string;
  message: string;
};

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_multilingual_ttv_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_LOCAL_MONTHLY_LIMIT = 10000;
const DEFAULT_MIN_REMAINING = 1000;

function readBoolEnv(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readFloatBounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readSeed(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(2147483647, Math.max(0, Math.trunc(parsed)));
}

function getApiKey(): string {
  return process.env.ELEVENLABS_API_KEY?.trim() ?? "";
}

export function getElevenLabsModel(): string {
  return process.env.ELEVENLABS_VOICE_DESIGN_MODEL?.trim() || DEFAULT_MODEL;
}

export function getElevenLabsOutputFormat(): string {
  return process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || DEFAULT_OUTPUT_FORMAT;
}

export function isElevenLabsEnabled(): boolean {
  return readBoolEnv("ELEVENLABS_ENABLED", false);
}

export function getElevenLabsLocalMonthlyLimit(): number {
  return readIntEnv("ELEVENLABS_MONTHLY_USAGE_LIMIT", DEFAULT_LOCAL_MONTHLY_LIMIT);
}

export function getElevenLabsMinRemainingChars(): number {
  return readIntEnv("ELEVENLABS_MIN_REMAINING_CHARS", DEFAULT_MIN_REMAINING);
}

export function getElevenLabsPreviewRoot(): string {
  return path.join(process.cwd(), "data", "voice-lab", "elevenlabs", "previews");
}

export function assertInsideElevenLabsPreviewRoot(filePath: string): string {
  const root = path.resolve(getElevenLabsPreviewRoot());
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Preview path is outside ElevenLabs preview root.");
  }
  return resolved;
}

async function elevenLabsFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured.");
  }

  return fetch(`${ELEVENLABS_API_BASE}${pathname}`, {
    ...init,
    headers: {
      "xi-api-key": apiKey,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export async function getElevenLabsStatus(): Promise<ElevenLabsStatus> {
  const enabled = isElevenLabsEnabled();
  const configured = Boolean(getApiKey());
  const localMonthlyLimit = getElevenLabsLocalMonthlyLimit();
  const minRemainingChars = getElevenLabsMinRemainingChars();
  const model = getElevenLabsModel();
  const outputFormat = getElevenLabsOutputFormat();

  if (!enabled) {
    return {
      enabled,
      configured,
      characterCount: null,
      remoteCharacterLimit: null,
      localMonthlyLimit,
      effectiveLimit: null,
      minRemainingChars,
      remaining: null,
      canGenerate: false,
      model,
      outputFormat,
      message: "ElevenLabs is disabled. Set ELEVENLABS_ENABLED=true.",
    };
  }

  if (!configured) {
    return {
      enabled,
      configured,
      characterCount: null,
      remoteCharacterLimit: null,
      localMonthlyLimit,
      effectiveLimit: null,
      minRemainingChars,
      remaining: null,
      canGenerate: false,
      model,
      outputFormat,
      message: "ELEVENLABS_API_KEY is not configured.",
    };
  }

  const response = await elevenLabsFetch("/user/subscription", { method: "GET" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      enabled,
      configured,
      characterCount: null,
      remoteCharacterLimit: null,
      localMonthlyLimit,
      effectiveLimit: localMonthlyLimit,
      minRemainingChars,
      remaining: null,
      canGenerate: false,
      model,
      outputFormat,
      message: `ElevenLabs subscription check failed: HTTP ${response.status}${text ? ` ${text.slice(0, 300)}` : ""}`,
    };
  }

  const json = await response.json() as { character_count?: unknown; character_limit?: unknown };
  const characterCount = Number(json.character_count ?? 0);
  const remoteCharacterLimit = Number(json.character_limit ?? localMonthlyLimit);
  const safeCharacterCount = Number.isFinite(characterCount) ? characterCount : 0;
  const safeRemoteLimit = Number.isFinite(remoteCharacterLimit) ? remoteCharacterLimit : localMonthlyLimit;
  const effectiveLimit = Math.min(localMonthlyLimit, safeRemoteLimit);
  const remaining = Math.max(0, effectiveLimit - safeCharacterCount);

  return {
    enabled,
    configured,
    characterCount: safeCharacterCount,
    remoteCharacterLimit: safeRemoteLimit,
    localMonthlyLimit,
    effectiveLimit,
    minRemainingChars,
    remaining,
    canGenerate: remaining > minRemainingChars,
    model,
    outputFormat,
    message: remaining > minRemainingChars
      ? "ElevenLabs preview generation is available."
      : "ElevenLabs usage reserve reached.",
  };
}

function estimateDesignCost(input: ElevenLabsDesignPreviewInput): number {
  return input.voiceDescription.length + input.sampleText.length;
}

function sanitizeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "preview";
}

function validateInput(input: ElevenLabsDesignPreviewInput): void {
  const desc = input.voiceDescription?.trim() ?? "";
  const text = input.sampleText?.trim() ?? "";

  if (desc.length < 20 || desc.length > 1000) {
    throw new Error("voiceDescription must be between 20 and 1000 characters.");
  }

  if (text.length < 100 || text.length > 1000) {
    throw new Error("sampleText must be between 100 and 1000 characters.");
  }
}

export async function createElevenLabsDesignPreview(input: ElevenLabsDesignPreviewInput): Promise<{
  text: string;
  characterCostEstimate: number;
  previews: ElevenLabsPreviewRecord[];
}> {
  if (!isElevenLabsEnabled()) {
    throw new Error("ElevenLabs is disabled. Set ELEVENLABS_ENABLED=true.");
  }

  validateInput(input);

  const status = await getElevenLabsStatus();
  const estimatedCost = estimateDesignCost(input);

  if (!status.configured) {
    throw new Error("ELEVENLABS_API_KEY is not configured.");
  }

  if (status.remaining !== null && status.remaining - estimatedCost < status.minRemainingChars) {
    throw new Error(
      `ElevenLabs usage reserve reached. Remaining=${status.remaining}, estimatedCost=${estimatedCost}, reserve=${status.minRemainingChars}.`
    );
  }

  const body = {
    voice_description: input.voiceDescription.trim(),
    model_id: getElevenLabsModel(),
    text: input.sampleText.trim(),
    seed: readSeed(input.seed),
    loudness: readFloatBounded(input.loudness, 0.5, -1, 1),
    guidance_scale: readFloatBounded(input.guidanceScale, 5, 0, 100),
    quality: input.quality === undefined || input.quality === null ? undefined : readFloatBounded(input.quality, 0.5, -1, 1),
    should_enhance: Boolean(input.shouldEnhance),
    stream_previews: false,
  };

  const query = new URLSearchParams({ output_format: getElevenLabsOutputFormat() });
  const response = await elevenLabsFetch(`/text-to-voice/design?${query.toString()}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`ElevenLabs design preview failed: HTTP ${response.status}${text ? ` ${text.slice(0, 500)}` : ""}`);
  }

  const json = await response.json() as {
    previews?: Array<{
      audio_base_64?: string;
      generated_voice_id?: string;
      media_type?: string;
      duration_secs?: number;
      language?: string;
    }>;
    text?: string;
  };

  const previews = Array.isArray(json.previews) ? json.previews : [];
  if (previews.length === 0) {
    throw new Error("ElevenLabs returned no voice previews.");
  }

  const root = getElevenLabsPreviewRoot();
  await fs.mkdir(root, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const saved: ElevenLabsPreviewRecord[] = [];

  for (let index = 0; index < previews.length; index += 1) {
    const preview = previews[index];
    const generatedVoiceId = preview.generated_voice_id?.trim() || `preview-${index + 1}`;
    const b64 = preview.audio_base_64;

    if (!b64) {
      continue;
    }

    const safeId = sanitizeSegment(generatedVoiceId);
    const audioName = `${timestamp}-${index + 1}-${safeId}.mp3`;
    const metaName = `${timestamp}-${index + 1}-${safeId}.json`;
    const audioPath = path.join(root, audioName);
    const metaPath = path.join(root, metaName);

    const audioBytes = Buffer.from(b64, "base64");
    if (audioBytes.length === 0) {
      continue;
    }

    await fs.writeFile(audioPath, audioBytes);

    const record: ElevenLabsPreviewRecord = {
      generatedVoiceId,
      mediaType: preview.media_type || "audio/mpeg",
      durationSecs: typeof preview.duration_secs === "number" ? preview.duration_secs : null,
      language: preview.language || null,
      audioPath,
      audioUrl: `/api/voice-lab/elevenlabs/file?path=${encodeURIComponent(audioPath)}`,
    };

    const metadata = {
      provider: "elevenlabs_experimental",
      source: "voice_design_preview",
      savedToElevenLabs: false,
      eligibleForIndexTTS2Training: true,
      createdAt: new Date().toISOString(),
      voiceDescription: input.voiceDescription.trim(),
      sampleText: input.sampleText.trim(),
      model: getElevenLabsModel(),
      outputFormat: getElevenLabsOutputFormat(),
      seed: readSeed(input.seed),
      characterCostEstimate: estimatedCost,
      ...record,
    };

    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf8");
    saved.push(record);
  }

  if (saved.length === 0) {
    throw new Error("ElevenLabs returned previews, but no audio could be saved.");
  }

  return {
    text: json.text || input.sampleText.trim(),
    characterCostEstimate: estimatedCost,
    previews: saved,
  };
}
'@

$StatusContent = @'
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
'@

$DesignContent = @'
/* OTG_ELEVENLABS_PREVIEW_BACKEND_P1 */
import { NextRequest, NextResponse } from "next/server";
import { createElevenLabsDesignPreview } from "@/lib/elevenlabsVoiceDesign";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Missing JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "JSON body must be an object." }, { status: 400 });
    }

    const input = body as {
      voiceDescription?: unknown;
      sampleText?: unknown;
      seed?: unknown;
      loudness?: unknown;
      guidanceScale?: unknown;
      quality?: unknown;
      shouldEnhance?: unknown;
    };

    const voiceDescription = typeof input.voiceDescription === "string" ? input.voiceDescription : "";
    const sampleText = typeof input.sampleText === "string" ? input.sampleText : "";

    if (!voiceDescription.trim()) {
      return NextResponse.json({ ok: false, error: "Missing required field: voiceDescription" }, { status: 400 });
    }

    if (!sampleText.trim()) {
      return NextResponse.json({ ok: false, error: "Missing required field: sampleText" }, { status: 400 });
    }

    const result = await createElevenLabsDesignPreview({
      voiceDescription,
      sampleText,
      seed: typeof input.seed === "number" || typeof input.seed === "string" ? Number(input.seed) : null,
      loudness: typeof input.loudness === "number" || typeof input.loudness === "string" ? Number(input.loudness) : null,
      guidanceScale: typeof input.guidanceScale === "number" || typeof input.guidanceScale === "string" ? Number(input.guidanceScale) : null,
      quality: typeof input.quality === "number" || typeof input.quality === "string" ? Number(input.quality) : null,
      shouldEnhance: Boolean(input.shouldEnhance),
    });

    return NextResponse.json({
      ok: true,
      provider: "elevenlabs_experimental",
      savedToElevenLabs: false,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ElevenLabs design-preview error.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
'@

$FileContent = @'
/* OTG_ELEVENLABS_PREVIEW_BACKEND_P1 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertInsideElevenLabsPreviewRoot } from "@/lib/elevenlabsVoiceDesign";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const rawPath = req.nextUrl.searchParams.get("path");
    if (!rawPath) {
      return NextResponse.json({ ok: false, error: "Missing required query parameter: path" }, { status: 400 });
    }

    const resolved = assertInsideElevenLabsPreviewRoot(rawPath);
    if (path.extname(resolved).toLowerCase() !== ".mp3") {
      return NextResponse.json({ ok: false, error: "Only ElevenLabs preview MP3 files are allowed." }, { status: 400 });
    }

    const data = await fs.readFile(resolved);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read ElevenLabs preview file.";
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
}
'@

Write-Utf8NoBom -Path $LibPath -Content $LibContent
Write-Utf8NoBom -Path $StatusPath -Content $StatusContent
Write-Utf8NoBom -Path $DesignPath -Content $DesignContent
Write-Utf8NoBom -Path $FilePath -Content $FileContent

if (Test-Path -LiteralPath $ChecklistPath) {
  $Checklist = Get-Content -LiteralPath $ChecklistPath -Raw
  $Marker = "ElevenLabs Experimental preview-only backend Patch 1"
  if ($Checklist -notmatch [regex]::Escape($Marker)) {
    $Append = @"

- [x] ${Marker}: added server-side status/design-preview/file routes. Preview audio is saved locally only; no permanent ElevenLabs voice creation endpoint is called.
"@
    Add-Content -LiteralPath $ChecklistPath -Value $Append -Encoding UTF8
  }
}

$Checks = @(
  @{ Path = $LibPath; Pattern = "OTG_ELEVENLABS_PREVIEW_BACKEND_P1" },
  @{ Path = $LibPath; Pattern = "createElevenLabsDesignPreview" },
  @{ Path = $LibPath; Pattern = "savedToElevenLabs: false" },
  @{ Path = $LibPath; Pattern = "/text-to-voice/design" },
  @{ Path = $StatusPath; Pattern = "getElevenLabsStatus" },
  @{ Path = $DesignPath; Pattern = "Missing JSON body" },
  @{ Path = $FilePath; Pattern = "assertInsideElevenLabsPreviewRoot" }
)

foreach ($check in $Checks) {
  if (!(Test-Path -LiteralPath $check.Path)) {
    throw "Verification failed. Missing file: $($check.Path)"
  }
  $text = Get-Content -LiteralPath $check.Path -Raw
  if ($text -notmatch [regex]::Escape($check.Pattern)) {
    throw "Verification failed. Missing marker '$($check.Pattern)' in $($check.Path)"
  }
}

$BadPatterns = @(
  "/v1/text-to-voice`"",
  "/text-to-voice`""
)

foreach ($bad in $BadPatterns) {
  $found = Select-String -Path $LibPath,$DesignPath,$StatusPath,$FilePath -Pattern $bad -SimpleMatch -ErrorAction SilentlyContinue
  if ($found) {
    throw "Verification failed. Found possible permanent voice creation endpoint reference: $bad"
  }
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "ElevenLabs preview-only backend Patch 1 installed."
Write-Host "Backup: $BackupRoot"
Write-Host ""
Write-Host "Next validation:"
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Root ".otg_patch_backups\production-trim-slowdown-codec-$Stamp"
$RenderRoute = "app/api/production/edit/render/route.ts"
$StoryboardPanel = "app/app/components/StoryboardPanel.tsx"
$Targets = @($RenderRoute, $StoryboardPanel)

function Ok($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Backup-Target($RelativePath) {
  $Source = Join-Path $Root $RelativePath
  if (!(Test-Path -LiteralPath $Source)) {
    Fail "Missing target file: $RelativePath"
  }

  $Destination = Join-Path $BackupRoot $RelativePath
  $DestinationDir = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
  Ok "Backed up $RelativePath"
}

function Test-Contains($RelativePath, $Needle) {
  $Path = Join-Path $Root $RelativePath
  $Text = Get-Content -LiteralPath $Path -Raw
  return $Text.Contains($Needle)
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
foreach ($Target in $Targets) {
  Backup-Target $Target
}

$AlreadyPatched =
  (Test-Contains $RenderRoute "function atempoFilterChain") -and
  (Test-Contains $RenderRoute "setpts=`${setPtsScale}*(PTS-STARTPTS)") -and
  (Test-Contains $StoryboardPanel "renderedDurationSeconds?: number") -and
  (Test-Contains $StoryboardPanel "editRenderBlockedByTiming")

if ($AlreadyPatched) {
  Ok "Production trim slowdown patch is already present. Backups were still created."
} else {
  $PatchPath = Join-Path $BackupRoot "production-trim-slowdown-codec.patch"
  $PatchText = @'
diff --git a/app/api/production/edit/render/route.ts b/app/api/production/edit/render/route.ts
index 421e306..cc50a84 100644
--- a/app/api/production/edit/render/route.ts
+++ b/app/api/production/edit/render/route.ts
@@ -125,6 +125,8 @@ type SfxSegment = {
   fadeOutSec: number;
 };
 
+type ExpandMode = "none" | "freeze_start" | "freeze_end" | "slow_down";
+
 const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
 
 function cleanSourceName(value: unknown) {
@@ -145,6 +147,39 @@ function clampSeconds(value: unknown, fallback: number) {
   return Math.max(0, Math.round(next * 1000) / 1000);
 }
 
+function formatFilterNumber(value: number) {
+  if (!Number.isFinite(value)) return "1";
+  return String(Math.round(value * 1000000) / 1000000);
+}
+
+function normalizeExpandMode(value: unknown): ExpandMode {
+  const raw = String(value || "none").trim();
+  if (raw === "none" || raw === "freeze_start" || raw === "freeze_end" || raw === "slow_down") return raw;
+  return "none";
+}
+
+function atempoFilterChain(playbackRate: number) {
+  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
+    throw new Error("playbackRate must be greater than 0.");
+  }
+
+  const filters: string[] = [];
+  let remaining = playbackRate;
+
+  while (remaining < 0.5) {
+    filters.push("atempo=0.5");
+    remaining /= 0.5;
+  }
+
+  while (remaining > 100) {
+    filters.push("atempo=100");
+    remaining /= 100;
+  }
+
+  filters.push(`atempo=${formatFilterNumber(remaining)}`);
+  return filters.join(",");
+}
+
 function fadeFilterParts(durationSeconds: number, fadeInSec: number, fadeOutSec: number) {
   const filters: string[] = [];
   const safeDuration = Math.max(0.01, durationSeconds);
@@ -387,16 +422,22 @@ export async function POST(req: NextRequest) {
     const sourceUrl = String(body.sourceUrl || "").trim();
     const manifest = (body.manifest && typeof body.manifest === "object" ? body.manifest : {}) as EditRenderManifestInput;
     const playbackRate = numberOr(manifest.playbackRate, 1);
-    const expandMode = String(manifest.expandMode || "none").trim() || "none";
+    const expandMode = normalizeExpandMode(manifest.expandMode);
     const audioPolicy = normalizeAudioPolicy(manifest);
 
     if (!sceneId) return routeError("sceneId is required.");
     if (!sourceUrl && !manifest.sourceFileName) return routeError("sourceUrl or manifest.sourceFileName is required.");
-    if (Math.abs(playbackRate - 1) > 0.001) {
-      return routeError("Current render supports trim and basic audio cleanup only. Set playbackRate to 1 before rendering.");
+    if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
+      return routeError("playbackRate must be greater than 0.");
+    }
+    if (expandMode === "freeze_start" || expandMode === "freeze_end") {
+      return routeError("Freeze start/end expand modes are not supported by this render path yet. Use expandMode none or slow_down.");
+    }
+    if (expandMode === "slow_down" && playbackRate >= 1) {
+      return routeError("Slow down expand mode requires playbackRate below 1.");
     }
-    if (expandMode !== "none") {
-      return routeError("Current render supports trim and basic audio cleanup only. Set expandMode to none before rendering.");
+    if (expandMode === "none" && Math.abs(playbackRate - 1) > 0.001) {
+      return routeError("Playback rate changes require expandMode slow_down.");
     }
 
     const sourceFileName =
@@ -431,9 +472,21 @@ export async function POST(req: NextRequest) {
     const effectiveEnd = sourceDuration > 0 ? Math.min(endSeconds, sourceDuration) : endSeconds;
     const durationSeconds = Math.round(Math.max(0, effectiveEnd - startSeconds) * 1000) / 1000;
 
+    if (startSeconds < 0) {
+      return routeError("Trim startSeconds must be greater than or equal to 0.");
+    }
     if (durationSeconds <= 0.05) {
       return routeError("Trim end must be greater than trim start.");
     }
+    if (sourceDuration > 0 && endSeconds > sourceDuration + 0.05) {
+      return routeError("Trim end is beyond the source video duration.", 400, { sourceDuration, endSeconds });
+    }
+
+    const timingScale = expandMode === "slow_down" ? 1 / playbackRate : 1;
+    const renderDurationSeconds = Math.round(durationSeconds * timingScale * 1000) / 1000;
+    const usesSlowDown = expandMode === "slow_down" && Math.abs(playbackRate - 1) > 0.001;
+    const setPtsScale = formatFilterNumber(timingScale);
+    const atempoChain = usesSlowDown ? atempoFilterChain(playbackRate) : "";
 
     const outputName = outputNameFor(sceneId, clipIndex);
     const outputPath = safeJoin(sourceItem.scope === "user" || sourceItem.scope === "device" ? sourceItem.path ? path.dirname(sourceItem.path) : sources[0].dir : sources[0].dir, outputName);
@@ -443,9 +496,9 @@ export async function POST(req: NextRequest) {
     const replacementAudioPath = audioPolicy.mode === "replace_original"
       ? resolveAudioPathFromGallery(sources, replacementAudioName)
       : "";
-    const voiceSegments = normalizeVoiceSegments(manifest, sources, durationSeconds);
-    const musicLayer = normalizeMusicLayer(manifest, sources, durationSeconds);
-    const sfxSegments = normalizeSfxSegments(manifest, sources, durationSeconds);
+    const voiceSegments = normalizeVoiceSegments(manifest, sources, renderDurationSeconds);
+    const musicLayer = normalizeMusicLayer(manifest, sources, renderDurationSeconds);
+    const sfxSegments = normalizeSfxSegments(manifest, sources, renderDurationSeconds);
 
     if (audioPolicy.mode === "replace_original" && !replacementAudioPath) {
       return routeError("Replacement audio file was not found in the current gallery.", 404, { replacementAudioFileName: replacementAudioName });
@@ -474,6 +527,8 @@ export async function POST(req: NextRequest) {
       "-hide_banner",
       "-ss",
       String(startSeconds),
+      "-t",
+      String(durationSeconds),
       "-i",
       sourcePath,
     ];
@@ -493,7 +548,7 @@ export async function POST(req: NextRequest) {
         "-f",
         "lavfi",
         "-t",
-        String(durationSeconds),
+        String(renderDurationSeconds),
         "-i",
         "anullsrc=channel_layout=stereo:sample_rate=48000",
       );
@@ -522,15 +577,10 @@ export async function POST(req: NextRequest) {
       nextInputIndex += 1;
     }
 
-    ffmpegArgs.push(
-      "-t",
-      String(durationSeconds),
-      "-map",
-      "0:v:0",
-    );
-
     const filterParts: string[] = [];
-    const useComplexAudio = voiceSegments.length > 0 || musicLayer.enabled || sfxSegments.length > 0;
+    filterParts.push(`[0:v]setpts=${setPtsScale}*(PTS-STARTPTS),format=yuv420p[edited_video]`);
+
+    const useComplexAudio = usesSlowDown || voiceSegments.length > 0 || musicLayer.enabled || sfxSegments.length > 0;
     let outputHasAudio = useComplexAudio;
     let directAudioMap = "";
     let baseInput = "";
@@ -555,16 +605,28 @@ export async function POST(req: NextRequest) {
     }
 
     if (useComplexAudio) {
-      let baseFilter = `${baseInput}atrim=0:${durationSeconds},asetpts=PTS-STARTPTS,volume=${baseVolume}`;
+      let baseFilter = baseInput
+        ? `${baseInput}atrim=0:${baseInput === "[0:a]" ? durationSeconds : renderDurationSeconds},asetpts=PTS-STARTPTS`
+        : "";
+      if (usesSlowDown && baseInput === "[0:a]") {
+        baseFilter += `,${atempoChain}`;
+      }
+      if (baseFilter) {
+        baseFilter += `,volume=${baseVolume}`;
+      }
       voiceSegments.forEach((segment) => {
         if (segment.mode === "replace_original" || segment.mode === "mute_original_range") {
           baseFilter += `,volume=volume=0:enable='between(t,${segment.startSeconds},${segment.endSeconds})'`;
         }
       });
       baseFilter += "[base_audio]";
-      filterParts.push(baseFilter);
 
-      const mixInputs = ["[base_audio]"];
+      const mixInputs: string[] = [];
+      if (baseInput) {
+        filterParts.push(baseFilter);
+        mixInputs.push("[base_audio]");
+      }
+
       voiceSegments.forEach((segment, index) => {
         const segmentDuration = Math.max(0.01, segment.endSeconds - segment.startSeconds);
         const delayMs = Math.max(0, Math.round(segment.startSeconds * 1000));
@@ -605,10 +667,15 @@ export async function POST(req: NextRequest) {
         mixInputs.push(`[${label}]`);
       });
 
-      filterParts.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0,atrim=0:${durationSeconds},asetpts=PTS-STARTPTS[mixed_audio]`);
-      ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[mixed_audio]");
+      if (mixInputs.length) {
+        filterParts.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0,atrim=0:${renderDurationSeconds},asetpts=PTS-STARTPTS[mixed_audio]`);
+        ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-map", "[mixed_audio]");
+      } else {
+        outputHasAudio = false;
+        ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-an");
+      }
     } else if (audioPolicy.mode === "mute_original") {
-      ffmpegArgs.push("-an");
+      ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-an");
       outputHasAudio = false;
     } else if (audioPolicy.mode === "replace_original") {
       directAudioMap = `${replacementInputIndex}:a:0`;
@@ -623,11 +690,11 @@ export async function POST(req: NextRequest) {
         ffmpegArgs.push("-filter:a", `volume=${audioPolicy.originalVolume}`);
       }
     } else {
-      ffmpegArgs.push("-an");
+      ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-an");
     }
 
     if (directAudioMap) {
-      ffmpegArgs.push("-map", directAudioMap);
+      ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[edited_video]", "-map", directAudioMap);
     }
 
     ffmpegArgs.push(
@@ -637,6 +704,8 @@ export async function POST(req: NextRequest) {
       "veryfast",
       "-crf",
       "18",
+      "-pix_fmt",
+      "yuv420p",
     );
 
     if (outputHasAudio) {
@@ -674,8 +743,14 @@ export async function POST(req: NextRequest) {
           clipIndex,
           sourceFileName,
           trim: { startSeconds, endSeconds: effectiveEnd },
+          sourceTrimDurationSeconds: durationSeconds,
+          renderedDurationSeconds: renderDurationSeconds,
           playbackRate,
           expandMode,
+          ffmpegTiming: {
+            videoFilter: `setpts=${setPtsScale}*(PTS-STARTPTS)`,
+            audioFilter: usesSlowDown ? atempoChain : "",
+          },
           audioPolicy: {
             ...audioPolicy,
             replacementAudioFileName: replacementAudioName || "",
@@ -726,7 +801,8 @@ export async function POST(req: NextRequest) {
       ok: true,
       editedUrl,
       editedFileName: outputName,
-      durationSeconds,
+      durationSeconds: renderDurationSeconds,
+      sourceTrimDurationSeconds: durationSeconds,
       sourceFileName,
       ffmpeg: { version: ffmpegVersion },
     });
diff --git a/app/app/components/StoryboardPanel.tsx b/app/app/components/StoryboardPanel.tsx
index ac0447d..33c4dcd 100644
--- a/app/app/components/StoryboardPanel.tsx
+++ b/app/app/components/StoryboardPanel.tsx
@@ -233,6 +233,7 @@ type ProductionClipEditManifest = {
   status: ProductionEditStatus;
   editedUrl?: string;
   editedFileName?: string;
+  renderedDurationSeconds?: number;
   error?: string;
   updatedAt: string;
 };
@@ -4290,6 +4291,7 @@ function renderDefaultAnimateStage() {
       status: normalizeProductionEditStatus(raw.status),
       editedUrl: String(raw.editedUrl || ""),
       editedFileName: String(raw.editedFileName || ""),
+      renderedDurationSeconds: Number.isFinite(Number(raw.renderedDurationSeconds)) ? Number(raw.renderedDurationSeconds) : undefined,
       error: raw.error ? String(raw.error) : undefined,
       updatedAt: String(raw.updatedAt || new Date().toISOString()),
     };
@@ -5256,8 +5258,18 @@ function handleRenderedEditReplacementResponse(
       return;
     }
 
-    if (Math.abs(manifest.playbackRate - 1) > 0.001 || manifest.expandMode !== "none") {
-      setNotice("Current render supports trim and basic audio cleanup only. Set playback rate to 1 and expand mode to None before rendering.");
+    if (manifest.expandMode === "freeze_start" || manifest.expandMode === "freeze_end") {
+      setNotice("Freeze start/end expand modes are not supported by this render path yet. Use None or Slow down.");
+      return;
+    }
+
+    if (manifest.expandMode === "slow_down" && manifest.playbackRate >= 1) {
+      setNotice("Slow down requires playback rate below 1.");
+      return;
+    }
+
+    if (manifest.expandMode === "none" && Math.abs(manifest.playbackRate - 1) > 0.001) {
+      setNotice("Playback rate changes require expand mode Slow down.");
       return;
     }
 
@@ -5302,7 +5314,7 @@ function handleRenderedEditReplacementResponse(
         status: "render_ready",
         editedUrl: String(data.editedUrl || ""),
         editedFileName: String(data.editedFileName || ""),
-        trimEndSeconds: Number(data.durationSeconds) > 0 ? manifest.trimStartSeconds + Number(data.durationSeconds) : manifest.trimEndSeconds,
+        renderedDurationSeconds: Number(data.durationSeconds) > 0 ? Number(data.durationSeconds) : undefined,
         error: "",
         updatedAt: new Date().toISOString(),
       }, durationSec);
@@ -5748,6 +5760,10 @@ setNotice(`Rendered visual FX for Clip ${row.index + 1}. Assemble will use the e
     const durationSec = activeRow?.durationSec || clampStoryboardDuration(scene?.durationSeconds ?? DEFAULT_SCENE_DURATION_SECONDS);
     const draft = activeKey ? editDraftForClip(activeKey, durationSec) : createDefaultProductionEditManifest(activeRow, durationSec);
     const visualRange = draft.visualFxRanges[0] || createProductionEditVisualFxRange(0, durationSec);
+    const unsupportedEditExpandMode = draft.expandMode === "freeze_start" || draft.expandMode === "freeze_end";
+    const invalidSlowDownEditTiming = draft.expandMode === "slow_down" && draft.playbackRate >= 1;
+    const invalidPlaybackRateWithoutSlowDown = draft.expandMode === "none" && Math.abs(draft.playbackRate - 1) > 0.001;
+    const editRenderBlockedByTiming = unsupportedEditExpandMode || invalidSlowDownEditTiming || invalidPlaybackRateWithoutSlowDown;
     const readyCount = rows.filter((row) => {
       const rowDraft = normalizeProductionEditManifest(row, editDraftsByClipKey[row.key] || row.clip.editManifest, row.durationSec);
       return rowDraft.status === "manifest_saved" || rowDraft.status === "render_ready";
@@ -6131,8 +6147,7 @@ setNotice(`Rendered visual FX for Clip ${row.index + 1}. Assemble will use the e
                     disabled={
                       !activeKey ||
                       Boolean(renderingEditClipKey) ||
-                      Math.abs(draft.playbackRate - 1) > 0.001 ||
-                      draft.expandMode !== "none"
+                      editRenderBlockedByTiming
                     }
                     onClick={() => renderTrimOnlyEditClip(activeKey, durationSec)}
                     className="mt-2 w-full rounded-[12px] border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
@@ -6154,9 +6169,17 @@ setNotice(`Rendered visual FX for Clip ${row.index + 1}. Assemble will use the e
                       {draft.error}
                     </div>
                   ) : null}
-                  {(Math.abs(draft.playbackRate - 1) > 0.001 || draft.expandMode !== "none") ? (
+                  {unsupportedEditExpandMode ? (
+                    <div className="mt-2 rounded-[12px] border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100">
+                      Freeze start/end expand modes are not supported by this render path yet. Use None or Slow down.
+                    </div>
+                  ) : invalidSlowDownEditTiming ? (
+                    <div className="mt-2 rounded-[12px] border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100">
+                      Slow down requires playback rate below 1.
+                    </div>
+                  ) : invalidPlaybackRateWithoutSlowDown ? (
                     <div className="mt-2 rounded-[12px] border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100">
-                      Current render supports trim and basic audio cleanup only. Use playback rate 1 and expand mode None.
+                      Playback rate changes require expand mode Slow down.
                     </div>
                   ) : null}
                 </div>
@@ -7052,7 +7075,7 @@ setNotice(`Rendered visual FX for Clip ${row.index + 1}. Assemble will use the e
         originalFileName: row.sourceFileName,
         editedFileName: manifest.editedFileName || "",
         manifestStatus: manifest.status,
-        durationSec: row.durationSec,
+        durationSec: hasEdited && manifest.renderedDurationSeconds ? manifest.renderedDurationSeconds : row.durationSec,
       };
     });
   }
'@

  Set-Content -LiteralPath $PatchPath -Value $PatchText -Encoding UTF8
  & git apply --whitespace=nowarn $PatchPath
  if ($LASTEXITCODE -ne 0) {
    Fail "git apply failed. Backups are available at $BackupRoot"
  }
  Ok "Applied Production trim slowdown patch."
}

foreach ($Target in $Targets) {
  if (!(Test-Path -LiteralPath (Join-Path $Root $Target))) {
    Fail "File missing after patch: $Target"
  }
}

$Checks = @(
  @{ Path = $RenderRoute; Needle = "function atempoFilterChain"; Label = "atempo chain helper" },
  @{ Path = $RenderRoute; Needle = "setpts=`${setPtsScale}*(PTS-STARTPTS)"; Label = "setpts video slowdown" },
  @{ Path = $RenderRoute; Needle = "atempoChain"; Label = "atempo audio slowdown" },
  @{ Path = $RenderRoute; Needle = '"libx264"'; Label = "explicit H.264 codec" },
  @{ Path = $RenderRoute; Needle = '"yuv420p"'; Label = "explicit yuv420p pixel format" },
  @{ Path = $RenderRoute; Needle = '"aac"'; Label = "explicit AAC codec" },
  @{ Path = $StoryboardPanel; Needle = "Slow down requires playback rate below 1."; Label = "slowdown UI validation" },
  @{ Path = $StoryboardPanel; Needle = "renderedDurationSeconds"; Label = "rendered duration manifest field" },
  @{ Path = $StoryboardPanel; Needle = "editRenderBlockedByTiming"; Label = "render button timing gate" }
)

foreach ($Check in $Checks) {
  if (!(Test-Contains $Check.Path $Check.Needle)) {
    Fail "Verification failed for $($Check.Label) in $($Check.Path)"
  }
  Ok "Verified $($Check.Label)"
}

Write-Host ""
Ok "Production trim slowdown codec patch completed."
Write-Host "Backup directory: $BackupRoot" -ForegroundColor Cyan

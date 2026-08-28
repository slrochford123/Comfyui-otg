$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RoutePath = Join-Path $Root "app\api\vision-prompt\route.ts"
$PanelPath = Join-Path $Root "app\app\components\CharactersPanel.tsx"
$ChecklistPath = Join-Path $Root "docs\OTG_REWORK_CHECKLIST.md"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root ".patch-backups\complete-description-patch2-$Stamp"

function Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Pass($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Replace-Once([string]$Text, [string]$Needle, [string]$Replacement, [string]$Label) {
  if ($Text.Contains($Replacement.Trim())) {
    Pass "$Label already present"
    return $Text
  }
  if (-not $Text.Contains($Needle)) {
    Fail "Could not find patch target: $Label"
  }
  Pass "Applying $Label"
  return $Text.Replace($Needle, $Replacement)
}

if (-not (Test-Path $RoutePath)) { Fail "Missing $RoutePath" }
if (-not (Test-Path $PanelPath)) { Fail "Missing $PanelPath" }
if (-not (Test-Path $ChecklistPath)) { Fail "Missing $ChecklistPath" }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Copy-Item -LiteralPath $RoutePath -Destination (Join-Path $BackupDir "route.ts.bak") -Force
Copy-Item -LiteralPath $PanelPath -Destination (Join-Path $BackupDir "CharactersPanel.tsx.bak") -Force
Copy-Item -LiteralPath $ChecklistPath -Destination (Join-Path $BackupDir "OTG_REWORK_CHECKLIST.md.bak") -Force
Pass "Backed up files to $BackupDir"

$route = Get-Content -LiteralPath $RoutePath -Raw
$panel = Get-Content -LiteralPath $PanelPath -Raw
$checklist = Get-Content -LiteralPath $ChecklistPath -Raw

if (
  $route.Contains("OTG_COMPLETE_DESCRIPTION_PROVIDER") -and
  $route.Contains("openaiVisionGenerate") -and
  $route.Contains("[CompleteDescription] provider_attempt") -and
  $route.Contains("Complete Description failed. Check provider settings or use manual details.") -and
  $panel.Contains("manualDetails: details") -and
  $checklist.Contains("Complete Description Patch 2 adds an OpenAI-first provider ladder")
) {
  Set-Content -LiteralPath $RoutePath -Value $route -Encoding utf8
  Set-Content -LiteralPath $PanelPath -Value $panel -Encoding utf8
  Set-Content -LiteralPath $ChecklistPath -Value $checklist -Encoding utf8
  Pass "Complete Description Patch 2 already applied; files backed up and rewritten unchanged"
  Pass "Complete Description Patch 2 provider ladder markers verified"
  Write-Host "Run validation next:" -ForegroundColor Cyan
  Write-Host "  npm run lint -- --quiet"
  Write-Host "  npx tsc --noEmit --pretty false"
  Write-Host "  npm test"
  exit 0
}

$route = Replace-Once $route @'
const DEFAULT_AUTO_DESCRIBE_NUM_CTX = 4096;
'@ @'
const DEFAULT_AUTO_DESCRIBE_NUM_CTX = 4096;
const DEFAULT_COMPLETE_DESCRIPTION_PROVIDER = "openai";
const DEFAULT_COMPLETE_DESCRIPTION_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_COMPLETE_DESCRIPTION_LOCAL_MODEL = "moondream:latest";
const DEFAULT_COMPLETE_DESCRIPTION_TIMEOUT_MS = 12_000;
'@ "Complete Description env defaults"

$route = Replace-Once $route @'
function isEmptyVisionValue(value: string) {
'@ @'
function cleanProviderName(value: any) {
  return (value ?? "").toString().trim().toLowerCase();
}

function summarizeManualDetails(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const allowed = [
    "name",
    "age",
    "species",
    "gender",
    "height",
    "build",
    "surfaceDescription",
    "hairFurColor",
    "eyeColor",
    "clothingAccessories",
  ];
  const lines: string[] = [];
  for (const key of allowed) {
    const v = cleanDetailValue(value[key]);
    if (!isEmptyVisionValue(v)) lines.push(`${key}: ${v}`);
  }
  return lines.join("; ").slice(0, 900);
}

function hasCompleteDescriptionShape(parsed: any) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  if (typeof parsed.descriptor !== "string") return false;
  if (!parsed.details || typeof parsed.details !== "object" || Array.isArray(parsed.details)) return false;
  return ["clothingAccessories", "surfaceDescription", "hairFurColor", "eyeColor"].every(
    (key) => typeof parsed.details[key] === "string"
  );
}

function isEmptyVisionValue(value: string) {
'@ "manual detail and JSON-shape helpers"

$route = $route.Replace(
  'const distinctFeatures = cleanDetailValue(j?.distinctFeatures ?? j?.distinct_features);',
  'const distinctFeatures = cleanDetailValue(j?.distinctiveFeatures ?? j?.distinctive_features ?? j?.distinctFeatures ?? j?.distinct_features);'
)

$route = Replace-Once $route @'
export async function POST(req: NextRequest) {
'@ @'
async function openaiVisionGenerate(
  model: string,
  prompt: string,
  image: VisionImagePayload,
  timeoutMs: number,
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false as const, status: 401, body: "OPENAI_API_KEY is not configured." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${image.mime};base64,${image.b64}`,
                  detail: "low",
                },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // handled below
    }

    if (!r.ok) {
      return { ok: false as const, status: r.status, body: json?.error?.message || text };
    }

    const output = (json?.choices?.[0]?.message?.content ?? "").toString();
    if (!output.trim()) return { ok: false as const, status: 502, body: "OpenAI returned an empty response." };
    return { ok: true as const, output, elapsedMs: Date.now() - startedAt };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return {
        ok: false as const,
        status: 504,
        body: "Complete Description timed out.",
      };
    }
    return { ok: false as const, status: 502, body: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
'@ "OpenAI vision provider"

$route = $route.Replace(
  'const { imagePath, promptHint, characterName, purpose, characterAnatomyMode } = body as any;',
  'const { imagePath, promptHint, characterName, purpose, characterAnatomyMode, manualDetails } = body as any;'
)

$oldProviderBlock = @'
    const envModel = isCharacterDetails
      ? process.env.OTG_AUTO_DESCRIBE_VISION_MODEL || process.env.OLLAMA_VISION_MODEL
      : process.env.OLLAMA_VISION_MODEL;

    let model = envModel || "redule26/huihui_ai_qwen2.5-vl-7b-abliterated";
'@
$newProviderBlock = @'
    const completeDescriptionProvider = cleanProviderName(
      process.env.OTG_COMPLETE_DESCRIPTION_PROVIDER || DEFAULT_COMPLETE_DESCRIPTION_PROVIDER
    );
    const completeDescriptionOpenAiModel =
      process.env.OTG_COMPLETE_DESCRIPTION_OPENAI_MODEL || DEFAULT_COMPLETE_DESCRIPTION_OPENAI_MODEL;
    const completeDescriptionLocalModel =
      process.env.OTG_COMPLETE_DESCRIPTION_LOCAL_MODEL || DEFAULT_COMPLETE_DESCRIPTION_LOCAL_MODEL;
    const envModel = isCharacterDetails
      ? completeDescriptionLocalModel || process.env.OTG_AUTO_DESCRIBE_VISION_MODEL || process.env.OLLAMA_VISION_MODEL
      : process.env.OLLAMA_VISION_MODEL;

    let model = envModel || "redule26/huihui_ai_qwen2.5-vl-7b-abliterated";
'@
$route = Replace-Once $route $oldProviderBlock $newProviderBlock "provider env selection"

$route = Replace-Once $route @'
    const jsonSchema = isBackground
'@ @'
    const completeDescriptionTimeoutMs = readPositiveIntEnv(
      "OTG_COMPLETE_DESCRIPTION_TIMEOUT_MS",
      DEFAULT_COMPLETE_DESCRIPTION_TIMEOUT_MS,
      5_000,
      25_000
    );

    const jsonSchema = isBackground
'@ "Complete Description timeout"

$route = $route.Replace(
  '          ? `Return JSON only: {"descriptor":"","details":{"clothingAccessories":"","surfaceDescription":"","hairFurColor":"","eyeColor":"","characterType":"","bodyForm":"","lowerBodyLocomotion":"","distinctFeatures":""}}`',
  '          ? `{"descriptor":"","details":{"clothingAccessories":"","surfaceDescription":"","hairFurColor":"","eyeColor":"","characterType":"","bodyForm":"","lowerBodyLocomotion":"","distinctiveFeatures":""}}`'
).Replace(
  '          : `Return JSON only: {"descriptor":"","details":{"clothingAccessories":"","surfaceDescription":"","hairFurColor":"","eyeColor":""}}`',
  '        ? `{"descriptor":"","details":{"clothingAccessories":"","surfaceDescription":"","hairFurColor":"","eyeColor":"","characterType":"","bodyForm":"","lowerBodyLocomotion":"","distinctiveFeatures":""}}`'
)

$route = Replace-Once $route @'
    const finalPrompt = isBackground
'@ @'
    const manualSummary = summarizeManualDetails(manualDetails);
    const manualBlock = manualSummary ? ` Manual details: ${manualSummary}.` : "";

    const finalPrompt = isBackground
'@ "manual details prompt input"

$route = $route.Replace(
  '        ? `${jsonSchema} Describe visible character only. Be brief. No markdown.${isFreeformCharacter ? " Preserve natural anatomy." : ""}${name}${hint}`',
  '        ? `Return JSON only. Complete missing visible character identity details for a production character card. Describe only visible traits. Be brief. Manual user details are authoritative and must not be contradicted. Required JSON shape: ${jsonSchema}${isFreeformCharacter ? " For freeform characters include natural anatomy details if obvious. Do not force humanoid anatomy." : ""}${name}${manualBlock}${hint} Do not return markdown.`'
)

$start = $route.IndexOf('    const startedAt = Date.now();')
$end = $route.IndexOf('    let descriptor = "";')
if ($start -ge 0 -and $end -gt $start) {
  $newRunBlock = @'
    let providerOutput = "";
    let parsed: any = null;

    if (isCharacterDetails) {
      console.info("[CompleteDescription] request", {
        provider: completeDescriptionProvider,
        openaiModel: completeDescriptionOpenAiModel,
        localModel: completeDescriptionLocalModel,
        imagePath: resolved,
        width: visionImage.width,
        height: visionImage.height,
        bytes: visionImage.bytes,
        timeoutMs: completeDescriptionTimeoutMs,
      });

      if (["disabled", "manual", "none", "off"].includes(completeDescriptionProvider)) {
        return NextResponse.json(
          { error: "Complete Description provider is disabled. Use manual details or enable a provider." },
          { status: 400 }
        );
      }

      const attempts: Array<"openai" | "ollama"> =
        completeDescriptionProvider === "ollama"
          ? ["ollama"]
          : completeDescriptionProvider === "openai" && process.env.OPENAI_API_KEY
            ? ["openai", "ollama"]
            : ["ollama"];

      let lastFailure = "";
      let usedProvider = "";
      let fallbackUsed = false;
      const routeStartedAt = Date.now();

      for (const provider of attempts) {
        const attemptStartedAt = Date.now();
        console.info("[CompleteDescription] provider_attempt", {
          provider,
          model: provider === "openai" ? completeDescriptionOpenAiModel : model,
          timeoutMs: completeDescriptionTimeoutMs,
        });

        let result:
          | Awaited<ReturnType<typeof openaiVisionGenerate>>
          | Awaited<ReturnType<typeof ollamaGenerate>>;

        if (provider === "openai") {
          result = await openaiVisionGenerate(
            completeDescriptionOpenAiModel,
            finalPrompt,
            visionImage,
            completeDescriptionTimeoutMs
          );
        } else {
          model = completeDescriptionLocalModel || model;
          result = await ollamaGenerate(baseUrl, model, finalPrompt, b64, completeDescriptionTimeoutMs, {
            autoDescribe: true,
          });
          if (!result.ok && result.status === 404) {
            const fallback = await detectVisionModel(baseUrl);
            if (fallback && fallback !== model) {
              model = fallback;
              result = await ollamaGenerate(baseUrl, model, finalPrompt, b64, completeDescriptionTimeoutMs, {
                autoDescribe: true,
              });
            }
          }
        }

        console.info("[CompleteDescription] provider_response", {
          provider,
          model: provider === "openai" ? completeDescriptionOpenAiModel : model,
          elapsedMs: Date.now() - attemptStartedAt,
          ok: result.ok,
          status: result.ok ? 200 : result.status,
        });

        if (!result.ok) {
          lastFailure = `${provider} failed (${result.status}): ${result.body}`;
          console.warn("[CompleteDescription] provider_failed", {
            provider,
            status: result.status,
            message: result.body,
          });
          continue;
        }

        const candidate = tryParseJsonLoose(result.output);
        if (!hasCompleteDescriptionShape(candidate)) {
          lastFailure = `${provider} returned invalid Complete Description JSON`;
          console.warn("[CompleteDescription] invalid_json", { provider, elapsedMs: Date.now() - attemptStartedAt });
          continue;
        }

        providerOutput = result.output;
        parsed = candidate;
        usedProvider = provider;
        fallbackUsed = provider === "ollama" && attempts[0] === "openai";
        break;
      }

      console.info("[CompleteDescription] complete", {
        provider: usedProvider || "none",
        fallbackUsed,
        elapsedMs: Date.now() - routeStartedAt,
        timeoutMs: completeDescriptionTimeoutMs,
        ok: Boolean(parsed),
      });

      if (!parsed) {
        console.warn("[CompleteDescription] failed", { message: lastFailure });
        return NextResponse.json(
          { error: "Complete Description failed. Check provider settings or use manual details." },
          { status: 502 }
        );
      }
    } else {
      const startedAt = Date.now();
      let gen = await ollamaGenerate(baseUrl, model, finalPrompt, b64, autoDescribeTimeoutMs);
      if (!gen.ok && gen.status === 404) {
        const fallback = await detectVisionModel(baseUrl);
        if (fallback && fallback !== model) {
          model = fallback;
          gen = await ollamaGenerate(baseUrl, model, finalPrompt, b64, autoDescribeTimeoutMs);
        }
      }
      if (!gen.ok) {
        return NextResponse.json(
          { error: `OllamaVision request failed (${gen.status}): ${gen.body}` },
          { status: 500 }
        );
      }

      providerOutput = gen.output;
      parsed = tryParseJsonLoose(gen.output);

      if (!parsed) {
        const repairPrompt = isBackground
          ? `Rewrite the following into ONLY valid JSON (one line), keys: location,time,lighting,objects,mood. No markdown.\nTEXT:\n${gen.output}`
          : `Rewrite the following into ONLY valid JSON (one line), keys: gender,age_range,ethnicity,skin_tone,hair_style,hair_color,eye_color,outfit_top,outfit_bottom,footwear,accessories,build,notable_features. No markdown.\nTEXT:\n${gen.output}`;

        let gen2 = await ollamaGenerate(baseUrl, model, repairPrompt, b64, autoDescribeTimeoutMs);
        if (!gen2.ok && gen2.status === 404) {
          const fallback = await detectVisionModel(baseUrl);
          if (fallback && fallback !== model) {
            model = fallback;
            gen2 = await ollamaGenerate(baseUrl, model, repairPrompt, b64, autoDescribeTimeoutMs);
          }
        }

        if (gen2.ok) parsed = tryParseJsonLoose(gen2.output);
      }

      console.info("[VisionPrompt] response", {
        model,
        purpose: selectedPurpose,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: autoDescribeTimeoutMs,
        ok: Boolean(parsed),
      });
    }

'@
  $route = $route.Substring(0, $start) + $newRunBlock + $route.Substring($end)
  Pass "Applied provider ladder run block"
} elseif ($route.Contains("[CompleteDescription] provider_attempt")) {
  Pass "Provider ladder run block already present"
} else {
  Fail "Could not locate provider run block target"
}

$route = $route.Replace('if (!descriptor) descriptor = normalizeDescriptor(gen.output);', 'if (!descriptor) descriptor = normalizeDescriptor(providerOutput);')
Set-Content -LiteralPath $RoutePath -Value $route -Encoding utf8

$panel = Get-Content -LiteralPath $PanelPath -Raw
$panel = Replace-Once $panel @'
          characterName: details.name.trim(),
'@ @'
          characterName: details.name.trim(),
          manualDetails: details,
'@ "manual details request payload"
$panel = $panel.Replace(
  'throw new Error(json?.error || "Ollama Vision description failed (" + response.status + ").");',
  'throw new Error(json?.error || "Complete Description failed. Check provider settings or use manual details.");'
)
Set-Content -LiteralPath $PanelPath -Value $panel -Encoding utf8

$checklist = Get-Content -LiteralPath $ChecklistPath -Raw
if (-not $checklist.Contains("Complete Description Patch 2 adds an OpenAI-first provider ladder")) {
  $checklist = $checklist.Replace(
    "- [x] TEST only: Complete Description Patch 1 renames the Character Builder action, creates a lockable character identity data model, and saves prompt-ready continuity metadata without changing provider routing.",
    "- [x] TEST only: Complete Description Patch 1 renames the Character Builder action, creates a lockable character identity data model, and saves prompt-ready continuity metadata without changing provider routing.`r`n- [x] TEST only: Complete Description Patch 2 adds an OpenAI-first provider ladder with local Ollama fallback, compact JSON validation, provider timing logs, and manual-detail-aware prompts.`r`n- [ ] TEST only: Complete Description Patch 3 injects locked prompt-ready character continuity blocks into production scene/global prompts."
  )
}
Set-Content -LiteralPath $ChecklistPath -Value $checklist -Encoding utf8

$verifyRoute = Get-Content -LiteralPath $RoutePath -Raw
$verifyPanel = Get-Content -LiteralPath $PanelPath -Raw
$verifyChecklist = Get-Content -LiteralPath $ChecklistPath -Raw

if (-not $verifyRoute.Contains("OTG_COMPLETE_DESCRIPTION_PROVIDER")) { Fail "Missing provider env marker" }
if (-not $verifyRoute.Contains("openaiVisionGenerate")) { Fail "Missing OpenAI provider function marker" }
if (-not $verifyRoute.Contains("[CompleteDescription] provider_attempt")) { Fail "Missing provider attempt log marker" }
if (-not $verifyRoute.Contains("Complete Description failed. Check provider settings or use manual details.")) { Fail "Missing clean failure marker" }
if (-not $verifyPanel.Contains("manualDetails: details")) { Fail "Missing manual details payload marker" }
if (-not $verifyChecklist.Contains("Complete Description Patch 2 adds an OpenAI-first provider ladder")) { Fail "Missing checklist marker" }

Pass "Complete Description Patch 2 provider ladder markers verified"
Write-Host "Run validation next:" -ForegroundColor Cyan
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"

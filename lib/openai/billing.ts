import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readOpenAIReservationSummary } from "@/lib/openai/usageLedger";
import { openAIAdminConfigured, readOpenAIAdminKey } from "./adminCredential";

import { estimateOpenAIUsageCost, readOpenAIUsageRecords, type OpenAIUsageRecord, type OpenAIUseCase } from "@/lib/openai/provider";

export type OpenAICreditEventType = "starting_balance" | "purchase" | "adjustment" | "refund" | "recharge" | "manual_reconciliation";

export type OpenAICreditEvent = {
  id: string;
  ts: number;
  effectiveAt: number;
  type: OpenAICreditEventType;
  amountUsd: number;
  note: string;
  verifiedBalanceUsd?: number | null;
};

export type OpenAIBillingSettings = {
  lowBalanceWarningsUsd: number[];
  officialSyncEnabled: boolean;
  lastOfficialSyncAt: number | null;
  lastOfficialSyncStatus: string;
  lastOfficialSyncError?: string;
  lastOfficialAttemptAt?: number | null;
  officialWindowStart?: number | null;
  officialWindowEnd?: number | null;
  usageWarning?: string | null;
};

export type OpenAIOfficialCostBucket = {
  startTime: number;
  endTime: number;
  amountUsd: number;
  projectId?: string | null;
  lineItem?: string | null;
};

export type OpenAIOfficialUsageBucket = {
  endpoint: "completions" | "audio_transcriptions";
  startTime: number;
  endTime: number;
  projectId?: string | null;
  userId?: string | null;
  apiKeyId?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  audioSeconds: number;
  requestCount: number;
};

export type OpenAIBillingState = {
  version: 1;
  settings: OpenAIBillingSettings;
  credits: OpenAICreditEvent[];
  officialCosts: OpenAIOfficialCostBucket[];
  officialUsage: OpenAIOfficialUsageBucket[];
};

export type OpenAIBillingFilters = {
  environment?: string;
  user?: string;
  feature?: string;
  apiProject?: string;
  apiKeyId?: string;
  model?: string;
  start?: number;
  end?: number;
};

type UnknownRecord = Record<string, unknown>;

const FEATURE_LABELS: Record<string, string> = {
  "story-creator": "Story Creator",
  storyteller: "Storyteller",
  "ai-assistants": "AI Assistants",
  "production-studio": "Production Studio",
  "h3-director": "H3 AI Scene Director",
  "story-helper": "Story Helper",
  "story-write": "Story Creator",
  "prompt-enhance": "Prompt Enhancement",
  "vision-description": "Image Description",
  transcribe: "OpenAI Voice Transcription",
};

const DEFAULT_SETTINGS: OpenAIBillingSettings = {
  lowBalanceWarningsUsd: [10, 5],
  officialSyncEnabled: false,
  lastOfficialSyncAt: null,
  lastOfficialSyncStatus: "not_configured",
};

function dataRoot() {
  return (
    String(process.env.OTG_DATA_DIR || "").trim() ||
    String(process.env.OTG_DATA_ROOT || "").trim() ||
    path.join(os.homedir(), "AI", "runtime", "test", "data")
  );
}

function billingPath() {
  const dir = path.join(dataRoot(), "openai");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, "billing.json");
}

function writePrivateJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort only; the app may be running on a filesystem that ignores chmod.
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function readOpenAIBillingState(): OpenAIBillingState {
  try {
    const parsed = JSON.parse(fs.readFileSync(billingPath(), "utf8"));
    return normalizeBillingState(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Saved billing data cannot be read. Restore or repair it before updating; it has not been reset.");
    return {
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      credits: [],
      officialCosts: [],
      officialUsage: [],
    };
  }
}

export function writeOpenAIBillingState(state: OpenAIBillingState) {
  writePrivateJson(billingPath(), normalizeBillingState(state));
}

function normalizeBillingState(value: unknown): OpenAIBillingState {
  const source = record(value);
  const sourceSettings = record(source.settings);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...sourceSettings,
  };
  const warnings = Array.isArray(settings.lowBalanceWarningsUsd)
    ? settings.lowBalanceWarningsUsd.map((item: unknown) => Number(item)).filter((item: number) => Number.isFinite(item) && item >= 0)
    : DEFAULT_SETTINGS.lowBalanceWarningsUsd;
  return {
    version: 1,
    settings: {
      ...settings,
      lowBalanceWarningsUsd: warnings.length ? [...new Set(warnings)].sort((a, b) => b - a) : DEFAULT_SETTINGS.lowBalanceWarningsUsd,
      officialSyncEnabled: Boolean(settings.officialSyncEnabled),
      lastOfficialSyncAt: Number(settings.lastOfficialSyncAt || 0) || null,
      lastOfficialSyncStatus: String(settings.lastOfficialSyncStatus || DEFAULT_SETTINGS.lastOfficialSyncStatus),
      lastOfficialSyncError: settings.lastOfficialSyncError ? String(settings.lastOfficialSyncError).slice(0, 300) : undefined,
    },
    credits: array(source.credits).map(normalizeCreditEvent).filter((item): item is OpenAICreditEvent => Boolean(item)),
    officialCosts: array(source.officialCosts).map(normalizeCostBucket).filter((item): item is OpenAIOfficialCostBucket => Boolean(item)),
    officialUsage: array(source.officialUsage).map(normalizeUsageBucket).filter((item): item is OpenAIOfficialUsageBucket => Boolean(item)),
  } as OpenAIBillingState;
}

function normalizeCreditEvent(value: unknown): OpenAICreditEvent | null {
  const source = record(value);
  const type = String(source.type || "");
  if (!["starting_balance", "purchase", "adjustment", "refund", "recharge", "manual_reconciliation"].includes(type)) return null;
  const amountUsd = Number(source.amountUsd);
  const effectiveAt = Number(source.effectiveAt || source.ts || Date.now());
  if (!Number.isFinite(amountUsd) || !Number.isFinite(effectiveAt)) return null;
  const verified = source.verifiedBalanceUsd == null || source.verifiedBalanceUsd === ""
    ? NaN : Number(source.verifiedBalanceUsd);
  return {
    id: String(source.id || `credit-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    ts: Number(source.ts || Date.now()) || Date.now(),
    effectiveAt,
    type: type as OpenAICreditEventType,
    amountUsd,
    note: String(source.note || "").slice(0, 300),
    verifiedBalanceUsd: Number.isFinite(verified) ? verified : null,
  };
}

function normalizeCostBucket(value: unknown): OpenAIOfficialCostBucket | null {
  const source = record(value);
  const amountUsd = Number(source.amountUsd);
  const startTime = Number(source.startTime);
  const endTime = Number(source.endTime);
  if (!Number.isFinite(amountUsd) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  return {
    startTime,
    endTime,
    amountUsd,
    projectId: source.projectId ? String(source.projectId) : null,
    lineItem: source.lineItem ? String(source.lineItem) : null,
  };
}

function normalizeUsageBucket(value: unknown): OpenAIOfficialUsageBucket | null {
  const source = record(value);
  const endpoint = String(source.endpoint || "");
  const startTime = Number(source.startTime);
  const endTime = Number(source.endTime);
  if (!["completions", "audio_transcriptions"].includes(endpoint) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  return {
    endpoint: endpoint as OpenAIOfficialUsageBucket["endpoint"],
    startTime,
    endTime,
    projectId: source.projectId ? String(source.projectId) : null,
    userId: source.userId ? String(source.userId) : null,
    apiKeyId: source.apiKeyId ? String(source.apiKeyId) : null,
    model: source.model ? String(source.model) : null,
    inputTokens: Math.max(0, Number(source.inputTokens || 0) || 0),
    outputTokens: Math.max(0, Number(source.outputTokens || 0) || 0),
    cachedInputTokens: Math.max(0, Number(source.cachedInputTokens || 0) || 0),
    audioSeconds: Math.max(0, Number(source.audioSeconds || 0) || 0),
    requestCount: Math.max(0, Number(source.requestCount || 0) || 0),
  };
}

function currentEnvironment() {
  const explicit = String(process.env.OTG_ENV || process.env.APP_ENV || "").toLowerCase();
  if (explicit.includes("prod")) return "prod";
  if (explicit.includes("test")) return "test";
  const dataDir = String(process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT || "").toLowerCase();
  if (dataDir.includes("/runtime/test/") || dataDir.endsWith("/runtime/test/data")) return "test";
  if (dataDir.includes("/runtime/prod/") || dataDir.endsWith("/runtime/prod/data")) return "prod";
  if (String(process.env.PORT || "") === "3001") return "test";
  const value = String(process.env.NODE_ENV || "test").toLowerCase();
  if (value.includes("prod")) return "prod";
  if (value.includes("test")) return "test";
  return value || "test";
}

function matchesFilter(record: OpenAIUsageRecord, filters: OpenAIBillingFilters) {
  if (filters.environment && filters.environment !== "organization" && filters.environment !== currentEnvironment()) return false;
  if (filters.user && record.ownerKey !== filters.user) return false;
  if (filters.feature && (record.feature||record.useCase) !== filters.feature) return false;
  if (filters.model && record.model !== filters.model) return false;
  if (filters.start && record.ts < filters.start) return false;
  if (filters.end && record.ts > filters.end) return false;
  return true;
}

function matchesOfficialUsageFilter(record: OpenAIOfficialUsageBucket, filters: OpenAIBillingFilters) {
  if (filters.environment && filters.environment !== "organization" && filters.environment !== currentEnvironment()) return false;
  if (filters.apiProject && record.projectId !== filters.apiProject) return false;
  if (filters.apiKeyId && record.apiKeyId !== filters.apiKeyId) return false;
  if (filters.model && record.model !== filters.model) return false;
  if (filters.start && record.endTime * 1000 < filters.start) return false;
  if (filters.end && record.startTime * 1000 > filters.end) return false;
  return true;
}

function sumCost(records: OpenAIUsageRecord[]) {
  return records.reduce((sum, record) => sum + Math.max(0, estimateOpenAIUsageCost(record)), 0);
}

function monthStart(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function dayStart(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function latestStartingCredit(credits: OpenAICreditEvent[]) {
  return credits
    .filter((event) => event.type === "starting_balance" || event.type === "manual_reconciliation")
    .sort((a, b) => b.effectiveAt - a.effectiveAt)[0] || null;
}

function creditTotalAfterBaseline(credits: OpenAICreditEvent[], baseline: OpenAICreditEvent | null) {
  if (!baseline) return credits.reduce((sum, event) => sum + event.amountUsd, 0);
  return (baseline.verifiedBalanceUsd ?? baseline.amountUsd) + credits
    .filter((event) => event.id !== baseline.id && event.effectiveAt >= baseline.effectiveAt)
    .reduce((sum, event) => sum + event.amountUsd, 0);
}

export function buildOpenAIBillingSnapshot(filters: OpenAIBillingFilters = {}) {
  const state = readOpenAIBillingState();
  const allRecords = readOpenAIUsageRecords();
  const records = allRecords.filter((record) => matchesFilter(record, filters));
  const now = new Date();
  const todayStart = dayStart(now);
  const thisMonthStart = monthStart(now);
  const baseline = latestStartingCredit(state.credits);
  const spendStart = baseline ? baseline.effectiveAt : 0;
  const spendRecords = allRecords.filter((record) => record.ts >= spendStart);
  const totalCreditsUsd = creditTotalAfterBaseline(state.credits, baseline);
  const localSpendUsd = sumCost(spendRecords);
  // Costs are a bounded organization-wide snapshot, not all-time app spending or a wallet balance.
  // A successful empty result is a real zero; a failed refresh retains the last good snapshot.
  const windowStart = Number(state.settings.officialWindowStart || 0);
  const windowEnd = Number(state.settings.officialWindowEnd || 0);
  const authoritativeSpendAvailable = Boolean(windowStart && windowEnd && state.settings.lastOfficialSyncAt);
  const officialSpendUsd = state.officialCosts.reduce((sum, bucket) => sum + bucket.amountUsd, 0);
  const localWindowSpend = sumCost(allRecords.filter(row => row.ts >= windowStart && row.ts < windowEnd));
  const discrepancyUsd = authoritativeSpendAvailable ? officialSpendUsd - localWindowSpend : null;
  const effectiveSpendUsd = localSpendUsd;
  // Daily organization buckets cannot reconcile an arbitrary mid-day portal snapshot exactly.
  // Deduct only known local requests, explicitly labelled as an installation-only estimate.
  const balanceUsd = totalCreditsUsd - localSpendUsd;
  const consumedPercent = totalCreditsUsd > 0 ? Math.min(100, Math.max(0, (localSpendUsd / totalCreditsUsd) * 100)) : null;
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rateStart = utcToday - 7 * 86400000;
  const officialRateAvailable = authoritativeSpendAvailable && windowStart <= rateStart && windowEnd >= utcToday;
  const rateRows = allRecords.filter(row => row.ts >= rateStart && row.ts < utcToday);
  const dailyRateUsd = officialRateAvailable
    ? state.officialCosts.filter(b => b.startTime * 1000 >= rateStart && b.endTime * 1000 <= utcToday).reduce((sum, b) => sum + b.amountUsd, 0) / 7
    : rateRows.length ? sumCost(rateRows) / 7 : null;
  const localRecordsForPeriod = records;

  const features = new Map<string, {
    feature: string;
    label: string;
    estimatedCostUsd: number;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    audioSeconds: number;
    models: Set<string>;
  }>();

  for (const record of localRecordsForPeriod) {
    const feature=record.feature||record.useCase;
    const current = features.get(feature) || {
      feature,
      label: FEATURE_LABELS[feature] || feature,
      estimatedCostUsd: 0,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      audioSeconds: 0,
      models: new Set<string>(),
    };
    current.estimatedCostUsd += Math.max(0, estimateOpenAIUsageCost(record));
    current.requestCount += 1;
    current.inputTokens += Math.max(0, Number(record.inputTokens || 0) || 0);
    current.outputTokens += Math.max(0, Number(record.outputTokens || 0) || 0);
    current.totalTokens += Math.max(0, Number(record.totalTokens || 0) || 0);
    current.audioSeconds += Math.max(0, Number(record.audioSeconds || 0) || 0);
    if (record.model) current.models.add(record.model);
    features.set(feature, current);
  }

  const officialUsage = state.officialUsage.filter((record) => matchesOfficialUsageFilter(record, filters));
  const users = [...new Set(allRecords.map((record) => record.ownerKey).filter(Boolean))].sort();
  const models = [...new Set([
    ...allRecords.map((record) => record.model).filter(Boolean),
    ...state.officialUsage.map((record) => record.model).filter(Boolean),
  ])].sort();
  const featureIds = [...new Set(allRecords.map((record) => record.feature||record.useCase).filter(Boolean))].sort();
  const officialUsageSummary = {
    completionsRequestCount: officialUsage
      .filter((record) => record.endpoint === "completions")
      .reduce((sum, record) => sum + record.requestCount, 0),
    transcriptionRequestCount: officialUsage
      .filter((record) => record.endpoint === "audio_transcriptions")
      .reduce((sum, record) => sum + record.requestCount, 0),
    inputTokens: officialUsage.reduce((sum, record) => sum + record.inputTokens, 0),
    outputTokens: officialUsage.reduce((sum, record) => sum + record.outputTokens, 0),
    cachedInputTokens: officialUsage.reduce((sum, record) => sum + record.cachedInputTokens, 0),
    audioSeconds: officialUsage.reduce((sum, record) => sum + record.audioSeconds, 0),
  };

  return {
    ok: true,
    environment: currentEnvironment(),
    reservations: readOpenAIReservationSummary(),
    filters,
    overview: {
      totalPrepaidCreditsUsd: state.credits.length ? totalCreditsUsd : null,
      totalApiSpendingUsd: allRecords.length || state.credits.length ? effectiveSpendUsd : null,
      localEstimatedSpendingUsd: authoritativeSpendAvailable ? localWindowSpend : allRecords.length ? localSpendUsd : null,
      officialReportedSpendingUsd: authoritativeSpendAvailable ? officialSpendUsd : null,
      officialLocalDiscrepancyUsd: discrepancyUsd,
      estimatedPrepaidBalanceUsd: state.credits.length ? balanceUsd : null,
      creditBalanceVerified: false,
      consumedPercent,
      todaySpendingUsd: allRecords.length ? sumCost(allRecords.filter((record) => record.ts >= todayStart)) : null,
      monthSpendingUsd: allRecords.length ? sumCost(allRecords.filter((record) => record.ts >= thisMonthStart)) : null,
      balanceBaselineAt: baseline?.effectiveAt || null,
      spendingRate: { dailyUsd: dailyRateUsd, projected30DayUsd: dailyRateUsd == null ? null : dailyRateUsd * 30,
        source: officialRateAvailable ? "official_organization" : "local_installation_estimate", start: rateStart, end: utcToday },
      totalRecordedUsage: allRecords.length,
      lastSynchronizationTimestamp: state.settings.lastOfficialSyncAt,
      dataSource: authoritativeSpendAvailable ? "official_costs_with_local_feature_estimates" : "local_estimates_only",
      accuracyStatus: authoritativeSpendAvailable
        ? "Official spending covers the displayed organization-wide sync window. Local spending covers this installation only. A difference can include other apps and reporting delays."
        : "No official costs synchronized. Local usage is only this installation, not the entire OpenAI account. Configure the separate Admin API key to connect billing.",
      lowBalanceWarningsUsd: state.settings.lowBalanceWarningsUsd,
      warning: state.settings.lastOfficialSyncStatus === "ok" ? null : state.settings.lastOfficialSyncError || "Billing is not connected. Your normal AI connection can still work.",
    },
    official: {
      configured: openAIAdminConfigured(),
      enabled: state.settings.officialSyncEnabled,
      status: state.settings.lastOfficialSyncStatus,
      lastSyncAt: state.settings.lastOfficialSyncAt,
      lastAttemptAt: state.settings.lastOfficialAttemptAt || null,
      windowStart: windowStart || null,
      windowEnd: windowEnd || null,
      usageWarning: state.settings.usageWarning || null,
      stale: authoritativeSpendAvailable && (Date.now() - windowEnd > 3600000 || state.settings.lastOfficialSyncStatus !== "ok"),
      error: state.settings.lastOfficialSyncError || null,
      costBucketCount: state.officialCosts.length,
      usageBucketCount: state.officialUsage.length,
      usageSummary: officialUsageSummary,
    },
    limits: {
      killSwitch: ["1", "true", "yes", "on"].includes(String(process.env.OPENAI_KILL_SWITCH || "").toLowerCase()),
      dailyUserLimitUsd: Number(process.env.OPENAI_DAILY_USER_COST_LIMIT_USD || 2),
      dailyGlobalLimitUsd: Number(process.env.OPENAI_DAILY_GLOBAL_COST_LIMIT_USD || 20),
      rateLimitPerMinute: Number(process.env.OPENAI_RATE_LIMIT_PER_MINUTE || 12),
    },
    features: [...features.values()].map((item) => ({
      ...item,
      models: [...item.models].sort(),
    })).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.requestCount - a.requestCount),
    options: {
      users,
      models,
      features: featureIds.map((feature) => ({ value: feature, label: FEATURE_LABELS[feature as OpenAIUseCase] || feature })),
      environments: ["test", "prod", "organization"],
      apiProjects: [...new Set(state.officialCosts.map((item) => item.projectId).filter(Boolean))],
      apiKeyIds: [...new Set(state.officialUsage.map((item) => item.apiKeyId).filter(Boolean))],
    },
    credits: state.credits.sort((a, b) => b.effectiveAt - a.effectiveAt),
    officialCosts: state.officialCosts.slice(-100).reverse(),
    officialUsage: officialUsage.slice(-100).reverse(),
    recentUsage: records.slice(-100).reverse().map((record) => ({
      ...record,
      approximateCostUsd: estimateOpenAIUsageCost(record),
      featureLabel: FEATURE_LABELS[record.feature||record.useCase] || record.feature || record.useCase,
    })),
  };
}

export function addOpenAICreditEvent(input: {
  type: string;
  amountUsd: number;
  effectiveAt?: number;
  note?: string;
  verifiedBalanceUsd?: number | null;
}) {
  const state = readOpenAIBillingState();
  const event = normalizeCreditEvent({
    id: `credit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    effectiveAt: input.effectiveAt || Date.now(),
    type: input.type,
    amountUsd: input.amountUsd,
    note: input.note || "",
    verifiedBalanceUsd: input.verifiedBalanceUsd ?? null,
  });
  if (!event) throw new Error("Invalid credit entry.");
  state.credits.push(event);
  writeOpenAIBillingState(state);
  return event;
}

export function updateOpenAIBillingSettings(input: Partial<OpenAIBillingSettings>) {
  const state = readOpenAIBillingState();
  state.settings = {
    ...state.settings,
    ...input,
    lowBalanceWarningsUsd: Array.isArray(input.lowBalanceWarningsUsd)
      ? input.lowBalanceWarningsUsd.map(Number).filter((value) => Number.isFinite(value) && value >= 0)
      : state.settings.lowBalanceWarningsUsd,
  };
  writeOpenAIBillingState(state);
  return state.settings;
}

async function fetchOpenAIAdminJson(pathname: string, params: URLSearchParams) {
  const apiKey = readOpenAIAdminKey();
  if (!apiKey) throw new Error("OPENAI_ADMIN_API_KEY is not configured.");
  const url = new URL(`https://api.openai.com${pathname}`);
  params.forEach((value, key) => url.searchParams.append(key, value));
  let response: Response;
  try { response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  }); } catch { throw new Error("OpenAI billing could not be reached within 15 seconds. Retry later; saved costs are unchanged."); }
  const body = record(await response.json().catch(() => null));
  if (!response.ok) {
    // Provider text may contain sensitive credential/account details. Never persist or echo it.
    throw new Error(response.status === 401 || response.status === 403
      ? "Billing access was rejected. Use an organization Admin API key with access to Costs and Usage, not the ordinary generation key."
      : response.status === 429 ? "OpenAI rate-limited billing sync. Wait before trying again."
      : `OpenAI billing returned HTTP ${response.status}. Saved costs are unchanged.`);
  }
  if (!Array.isArray(body.data) || typeof body.has_more !== "boolean") throw new Error("OpenAI returned an invalid billing page; saved costs are unchanged.");
  return body;
}

async function fetchAllOpenAIPages(pathname: string, params: URLSearchParams) {
  const out: unknown[] = [];
  let page: string | null = null;
  const seen = new Set<string>();
  for (let i = 0; i < 20; i += 1) {
    const next = new URLSearchParams(params);
    if (page) next.set("page", page);
    const body = await fetchOpenAIAdminJson(pathname, next);
    if (Array.isArray(body.data)) out.push(...body.data);
    if (!body.has_more) return out;
    page = typeof body.next_page === "string" && body.next_page ? body.next_page : null;
    if (!page || seen.has(page)) throw new Error("OpenAI billing pagination was incomplete; saved costs are unchanged.");
    seen.add(page);
  }
  throw new Error("OpenAI billing page limit exceeded; saved costs are unchanged.");
}

function collectCosts(data: unknown[]): OpenAIOfficialCostBucket[] {
  const buckets: OpenAIOfficialCostBucket[] = [];
  for (const bucketValue of data) {
    const bucket = record(bucketValue);
    const startTime = Number(bucket.start_time || bucket.startTime || 0);
    const endTime = Number(bucket.end_time || bucket.endTime || 0);
    if (!startTime || endTime <= startTime || !Array.isArray(bucket.results)) throw new Error("OpenAI costs contained an invalid bucket; saved costs are unchanged.");
    const results = array(bucket.results);
    for (const resultValue of results) {
      const result = record(resultValue);
      const amount = Number(record(result.amount).value);
      if (record(result.amount).currency !== "usd" || record(result.amount).value == null || !Number.isFinite(amount)) throw new Error("OpenAI costs contained an unsupported currency or invalid amount; saved costs are unchanged.");
      buckets.push({
        startTime,
        endTime,
        amountUsd: amount,
        projectId: stringValue(result.project_id) || null,
        lineItem: stringValue(result.line_item) || null,
      });
    }
  }
  return buckets;
}

function collectUsage(endpoint: OpenAIOfficialUsageBucket["endpoint"], data: unknown[]): OpenAIOfficialUsageBucket[] {
  const buckets: OpenAIOfficialUsageBucket[] = [];
  for (const bucketValue of data) {
    const bucket = record(bucketValue);
    const startTime = Number(bucket.start_time || bucket.startTime || 0);
    const endTime = Number(bucket.end_time || bucket.endTime || 0);
    const results = array(bucket.results);
    for (const resultValue of results) {
      const result = record(resultValue);
      buckets.push({
        endpoint,
        startTime,
        endTime,
        projectId: stringValue(result.project_id) || null,
        userId: stringValue(result.user_id) || null,
        apiKeyId: stringValue(result.api_key_id) || null,
        model: stringValue(result.model) || null,
        inputTokens: Number(result.input_tokens || 0) || 0,
        outputTokens: Number(result.output_tokens || 0) || 0,
        cachedInputTokens: Number(result.input_cached_tokens || 0) || 0,
        audioSeconds: Number(result.seconds || 0) || 0,
        requestCount: Number(result.num_model_requests || 0) || 0,
      });
    }
  }
  return buckets;
}

let pendingSync: Promise<{ ok: boolean; error?: string; costBucketCount?: number; usageBucketCount?: number }> | null = null;
export async function syncOpenAIOfficialBilling(days = 30) {
  if (!Number.isInteger(days) || days < 1 || days > 180) return { ok: false, error: "Sync days must be an integer from 1 to 180." };
  if (!openAIAdminConfigured()) return { ok: false, error: "OPENAI_ADMIN_API_KEY is not configured. Connect a private Admin API key first." };
  if (pendingSync) return pendingSync;
  const state = readOpenAIBillingState();
  if (state.settings.lastOfficialAttemptAt && Date.now() - state.settings.lastOfficialAttemptAt < 60000) return { ok: false, error: "Wait one minute between official sync attempts." };
  pendingSync = syncBillingWindow(days);
  try { return await pendingSync; } finally { pendingSync = null; }
}

async function syncBillingWindow(days: number) {
  const attemptAt = Date.now();
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = Math.floor(endTime / 86400) * 86400 - days * 86400;
  const costParams = new URLSearchParams({
    start_time: String(startTime),
    end_time: String(endTime),
    bucket_width: "1d",
    limit: String(Math.max(1, Math.min(180, days))),
  });
  costParams.append("group_by[]", "project_id");
  costParams.append("group_by[]", "line_item");
  const usageParams = new URLSearchParams({
    start_time: String(startTime),
    end_time: String(endTime),
    bucket_width: "1d",
    limit: String(Math.max(1, Math.min(31, days))),
  });
  usageParams.append("group_by[]", "project_id");
  usageParams.append("group_by[]", "api_key_id");
  usageParams.append("group_by[]", "model");
  try {
    const costs = await fetchAllOpenAIPages("/v1/organization/costs", costParams);
    const parsedCosts = collectCosts(costs);
    let usage: OpenAIOfficialUsageBucket[] = [];
    let usageWarning: string | null = null;
    try {
      const completionsUsage = await fetchAllOpenAIPages("/v1/organization/usage/completions", usageParams);
      const transcriptionsUsage = await fetchAllOpenAIPages("/v1/organization/usage/audio_transcriptions", usageParams);
      usage = [...collectUsage("completions", completionsUsage), ...collectUsage("audio_transcriptions", transcriptionsUsage)];
    } catch { usageWarning = "Costs synchronized, but token/audio usage could not be refreshed. Retry later or check the Admin key permissions. No usage totals are claimed for this window."; }
    // Re-read after network waits so concurrent credit/settings edits are not overwritten.
    const state = readOpenAIBillingState();
    state.officialCosts = parsedCosts;
    state.officialUsage = usage;
    state.settings.officialSyncEnabled = true;
    state.settings.lastOfficialSyncAt = Date.now();
    state.settings.lastOfficialAttemptAt = attemptAt;
    state.settings.officialWindowStart = startTime * 1000;
    state.settings.officialWindowEnd = endTime * 1000;
    state.settings.usageWarning = usageWarning;
    state.settings.lastOfficialSyncStatus = "ok";
    delete state.settings.lastOfficialSyncError;
    writeOpenAIBillingState(state);
    return { ok: true, costBucketCount: state.officialCosts.length, usageBucketCount: state.officialUsage.length };
  } catch (error) {
    const state = readOpenAIBillingState();
    state.settings.lastOfficialAttemptAt = attemptAt;
    state.settings.lastOfficialSyncStatus = "error";
    state.settings.lastOfficialSyncError = error instanceof Error && /^(OpenAI|Billing access)/.test(error.message) ? error.message.slice(0, 300) : "Official billing sync failed. Saved costs and the last successful timestamp are unchanged.";
    writeOpenAIBillingState(state);
    return { ok: false, error: state.settings.lastOfficialSyncError };
  }
}


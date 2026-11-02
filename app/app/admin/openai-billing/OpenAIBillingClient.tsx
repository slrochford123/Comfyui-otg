"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminStyles as styles } from "../AdminShell";
import OpenAIConnectionPanel from "../../components/OpenAIConnectionPanel";

type BillingSnapshot = {
  ok: true;
  environment: string;
  reservations?: Array<{status: "pending" | "unknown"; requests: number; reservedUsd: number}>;
  overview: {
    totalPrepaidCreditsUsd: number | null;
    totalApiSpendingUsd: number | null;
    localEstimatedSpendingUsd: number | null;
    officialReportedSpendingUsd: number | null;
    officialLocalDiscrepancyUsd: number | null;
    estimatedPrepaidBalanceUsd: number | null;
    consumedPercent: number | null;
    todaySpendingUsd: number | null;
    monthSpendingUsd: number | null;
    balanceBaselineAt: number | null;
    spendingRate: { dailyUsd: number | null; projected30DayUsd: number | null; source: string; start: number; end: number };
    totalRecordedUsage: number;
    lastSynchronizationTimestamp: number | null;
    dataSource: string;
    accuracyStatus: string;
    lowBalanceWarningsUsd: number[];
    warning: string | null;
  };
  official: {
    configured: boolean;
    enabled: boolean;
    status: string;
    lastSyncAt: number | null;
    lastAttemptAt: number | null;
    windowStart: number | null;
    windowEnd: number | null;
    usageWarning: string | null;
    stale: boolean;
    error: string | null;
    costBucketCount: number;
    usageBucketCount: number;
    usageSummary: {
      completionsRequestCount: number;
      transcriptionRequestCount: number;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      audioSeconds: number;
    };
  };
  limits: {
    killSwitch: boolean;
    dailyUserLimitUsd: number;
    dailyGlobalLimitUsd: number;
    rateLimitPerMinute: number;
  };
  features: Array<{
    feature: string;
    label: string;
    estimatedCostUsd: number;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    audioSeconds: number;
    models: string[];
  }>;
  options: {
    users: string[];
    models: string[];
    features: Array<{ value: string; label: string }>;
    environments: string[];
    apiProjects: string[];
    apiKeyIds: string[];
  };
  credits: Array<{
    id: string;
    ts: number;
    effectiveAt: number;
    type: string;
    amountUsd: number;
    note: string;
    verifiedBalanceUsd?: number | null;
  }>;
  officialCosts: Array<{
    startTime: number;
    endTime: number;
    amountUsd: number;
    projectId?: string | null;
    lineItem?: string | null;
  }>;
  officialUsage: Array<{
    endpoint: string;
    startTime: number;
    endTime: number;
    projectId?: string | null;
    apiKeyId?: string | null;
    model?: string | null;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    audioSeconds: number;
    requestCount: number;
  }>;
  recentUsage: Array<{
    ts: number;
    ownerKey: string;
    useCase: string;
    featureLabel: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    audioSeconds: number;
    approximateCostUsd: number;
  }>;
};

type ApiResponse = BillingSnapshot | { ok: boolean; error?: string; snapshot?: BillingSnapshot };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function responseError(data: ApiResponse, fallback: string) {
  return "error" in data && data.error ? data.error : fallback;
}

function responseSnapshot(data: ApiResponse) {
  return "snapshot" in data && data.snapshot ? data.snapshot : "overview" in data ? data : null;
}

function usd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Not available";
  const abs = Math.abs(value);
  const maximumFractionDigits = abs > 0 && abs < 0.0001
    ? 8
    : abs > 0 && abs < 0.01
      ? 7
      : abs > 0 && abs < 1
        ? 4
        : 2;
  const minimumFractionDigits = abs > 0 && abs < 1 ? Math.min(4, maximumFractionDigits) : 2;
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

function usdFixed(value: number | null | undefined, digits: number) {
  if (value == null || !Number.isFinite(value)) return "Not available";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function usdBalance(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Not available";
  const roundedCents = Math.round(value * 100) / 100;
  const needsPrecision = Math.abs(value - roundedCents) >= 0.00005;
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: needsPrecision ? 4 : 2,
    maximumFractionDigits: needsPrecision ? 4 : 2,
  });
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Not available";
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.1 ? 4 : abs < 1 ? 3 : 1;
  return `${value.toFixed(digits)}%`;
}

function numberFmt(value: number) {
  return Math.round(value).toLocaleString();
}

function dateTime(value: number | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function compactDate(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const inputStyle = {
  width: "100%",
  minWidth: 0,
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: "10px 12px",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
} as const;

const panelStyle = {
  minWidth: 0,
  border: "1px solid var(--color-border)",
  borderRadius: 14,
  padding: 16,
  background: "var(--color-card)",
  color: "var(--color-text)",
} as const;

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function OpenAIBillingClient() {
  const mutation = useRef(false);
  const loadSequence = useRef(0);
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filters, setFilters] = useState({
    environment: "",
    user: "",
    feature: "",
    apiProject: "",
    apiKeyId: "",
    model: "",
    start: "",
    end: "",
  });
  const [credit, setCredit] = useState({
    type: "starting_balance",
    amountUsd: "",
    effectiveAt: localDateTime(),
    note: "",
    verifiedBalanceUsd: "",
  });
  const [warnings, setWarnings] = useState("10, 5");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/openai-billing${query ? `?${query}` : ""}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (sequence !== loadSequence.current) return;
      const nextSnapshot = responseSnapshot(data);
      if (!res.ok || !data.ok || !nextSnapshot) {
        setError(responseError(data, "Unable to load OpenAI billing."));
        const nextSnapshot = responseSnapshot(data);
        if (nextSnapshot) setSnapshot(nextSnapshot);
        return;
      }
      setSnapshot(nextSnapshot);
      setWarnings(nextSnapshot.overview.lowBalanceWarningsUsd.join(", "));
    } catch (err: unknown) {
      setError(errorMessage(err, "Unable to load OpenAI billing."));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const post = useCallback(async (action: string, body: Record<string, unknown>) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(action);
    setError(null);
    try {
      ++loadSequence.current;
      const res = await fetch(`/api/admin/openai-billing${query ? `?${query}` : ""}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok) {
        setError(responseError(data, "OpenAI billing update failed."));
        const nextSnapshot = responseSnapshot(data);
        if (nextSnapshot) setSnapshot(nextSnapshot);
        return;
      }
      const nextSnapshot = responseSnapshot(data);
      if (nextSnapshot) setSnapshot(nextSnapshot);
      if (action === "credit") {
        setCredit({
          type: "starting_balance",
          amountUsd: "",
          effectiveAt: localDateTime(),
          note: "",
          verifiedBalanceUsd: "",
        });
      }
    } catch (err: unknown) {
      setError(errorMessage(err, "OpenAI billing update failed."));
    } finally {
      mutation.current = false;
      setBusy(null);
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!autoRefresh) return;
    const refresh = () => {
      if (document.visibilityState !== "visible" || mutation.current) return;
      const lastAttempt = snapshot?.official.lastAttemptAt || snapshot?.official.lastSyncAt || 0;
      if (snapshot?.official.configured && Date.now() - lastAttempt >= 15 * 60000) void post("sync", { days: 30 });
      else void load();
    };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [autoRefresh, load, post, snapshot?.official.configured, snapshot?.official.lastAttemptAt, snapshot?.official.lastSyncAt]);

  const overview = snapshot?.overview;
  const warningThreshold = overview?.estimatedPrepaidBalanceUsd != null
    ? overview.lowBalanceWarningsUsd.find((value) => overview.estimatedPrepaidBalanceUsd! <= value) : undefined;

  return (
    <main className={styles.shell}>
      <div className="mx-auto max-w-[1500px]">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <h1 style={{ fontWeight: 800, margin: 0 }}>Billing & Usage</h1>
            <p className="otg-help" style={{ marginTop: 6, maxWidth: 860 }}>
              Admin-only view of local feature usage, manually tracked credits, spending controls, and official OpenAI billing sync status.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href="/app/admin" className="otg-authShowBtn" style={{ textDecoration: "none", padding: "10px 14px" }}>Admin</a>
            <a
              href="https://platform.openai.com/settings/organization/billing/overview"
              target="_blank"
              rel="noreferrer"
              className="otg-authShowBtn"
              style={{ textDecoration: "none", padding: "10px 14px" }}
            >
              Open official OpenAI portal
            </a>
            <button className="otg-authShowBtn" style={{ padding: "10px 14px" }} onClick={() => post("sync", { days: 30 })} disabled={Boolean(busy) || !snapshot?.official.configured}>
              {busy === "sync" ? "Syncing..." : "Sync Official Costs"}
            </button>
            <button className="otg-authShowBtn" style={{ padding: "10px 14px" }} onClick={() => void load()} disabled={Boolean(busy) || loading}>Refresh dashboard</button>
          </div>
        </div>

        <OpenAIConnectionPanel />
        <label style={{ display: "flex", gap: 8, margin: "14px 0" }}><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />Refresh while open (local usage each minute; official costs every 15 minutes when connected)</label>
        {error ? <p role="alert" style={{ color: "var(--color-error)" }}>{error}</p> : null}
        {loading && !snapshot ? <p className="otg-help">Loading OpenAI billing...</p> : null}

        {snapshot && overview ? (
          <>
            {!snapshot.official.configured ? <section aria-label="Connect OpenAI billing" style={{ ...panelStyle, marginBottom: 16 }}>
              <h2>Connect billing once</h2>
              <p>Your normal AI key and billing Admin key are separate. A linked ChatGPT subscription does not automatically connect this dashboard.</p>
              <ol style={{ paddingLeft: 20 }}>
                <li>Open <a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noreferrer">OpenAI Admin keys</a> in the same organization that shows your credits.</li>
                <li>Create an Admin API key for this billing connection. Keep it private; do not paste it into chat or an ordinary HTTP web form.</li>
                <li>On the TEST PC, run <code>python3 scripts/install-openai-admin-key-test.py</code> from the source checkout. It reads the key with hidden input, validates read-only Costs access, and saves it outside the release. No service restart or paid generation.</li>
                <li>Click Refresh dashboard, then Sync Official Costs.</li>
              </ol>
              <p>For remaining credit, record a current portal balance with its exact observation time below. The portal remains the authority for grants, expiration, purchases and balance.</p>
            </section> : null}
            <section style={{ ...panelStyle, marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                <Metric label="Recorded credits" value={usdFixed(overview.totalPrepaidCreditsUsd, 2)} />
                <Metric label="Local spend since balance entry" value={usd(overview.totalApiSpendingUsd)} />
                <Metric label="Estimated balance (local deduction only)" value={usdBalance(overview.estimatedPrepaidBalanceUsd)} tone={warningThreshold != null ? "warn" : undefined} />
                <Metric label="Locally consumed" value={percent(overview.consumedPercent)} />
                <Metric label="Today · local estimate" value={usd(overview.todaySpendingUsd)} />
                <Metric label="This month · local estimate" value={usd(overview.monthSpendingUsd)} />
                <Metric label="Recorded usage" value={numberFmt(overview.totalRecordedUsage)} />
                <Metric label="Last sync" value={dateTime(overview.lastSynchronizationTimestamp)} />
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ height: 12, borderRadius: 999, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
                  {overview.consumedPercent != null ? <div style={{ width: `${Math.min(100, Math.max(0, overview.consumedPercent))}%`, height: "100%", background: warningThreshold != null ? "var(--color-warning)" : "var(--color-success)" }} /> : null}
                </div>
                <p className="otg-help" style={{ marginTop: 10 }}>
                  Data source: {overview.dataSource}. {overview.accuracyStatus}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
                  <Metric label="Official reported spending" value={usd(overview.officialReportedSpendingUsd)} />
                  <Metric label="Local feature estimate" value={usd(overview.localEstimatedSpendingUsd)} />
                  <Metric label="Official vs local delta" value={overview.officialLocalDiscrepancyUsd == null ? "Not available" : usd(overview.officialLocalDiscrepancyUsd)} />
                </div>
                <p className="otg-help" style={{ marginTop: 10 }}>
                  Recorded credits and estimated balance are manually tracked in SLR Studios. Official Costs, when synchronized, are OpenAI-reported spending; they are not an OpenAI-verified prepaid balance.
                </p>
                <p className="otg-help">Portal baseline: {dateTime(overview.balanceBaselineAt)}. The estimate excludes spending by other installations/apps, new credits and credit expiration. Reconcile it against the portal regularly; it is not a spending guarantee.</p>
                {!overview.totalRecordedUsage ? <p>No local requests are recorded on this installation. This does not mean your OpenAI organization has spent $0.</p> : null}
                {overview.warning ? <p style={{ color: "#fde68a", marginTop: 8 }}>{overview.warning}</p> : null}
                {snapshot.reservations?.map(item => <p key={item.status} className="otg-help">{item.requests} {item.status === "pending" ? "in-flight" : "unconfirmed"} request(s): {usd(item.reservedUsd)} reserved against the rolling daily limit. This is a precautionary estimate, not a confirmed charge.</p>)}
                {warningThreshold != null ? <p style={{ color: "#fde68a", marginTop: 8 }}>Estimated balance is below the {usd(warningThreshold)} warning threshold.</p> : null}
              </div>
            </section>

            <section aria-label="Spending rate" style={{ ...panelStyle, marginBottom: 16 }}>
              <h2>Spending rate</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                <Metric label="Average per day" value={usd(overview.spendingRate.dailyUsd)} />
                <Metric label="30-day projection" value={usd(overview.spendingRate.projected30DayUsd)} />
              </div>
              <p className="otg-help">Based on seven complete UTC days: {dateTime(overview.spendingRate.start)} to {dateTime(overview.spendingRate.end)}. {overview.spendingRate.source === "official_organization" ? "Organization-wide official costs." : "This installation's local estimate only."} Projection assumes the same activity; it is not a future invoice or a credit-expiry prediction.</p>
            </section>

            <section style={{ ...panelStyle, marginBottom: 16 }}>
              <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Official OpenAI sync</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                <Metric label="Configuration" value={snapshot.official.configured ? "Configured" : "Not configured"} />
                <Metric label="Sync status" value={!snapshot.official.configured ? "Not configured" : snapshot.official.stale ? "Stale · refresh needed" : snapshot.official.status} />
                <Metric label="Cost buckets" value={numberFmt(snapshot.official.costBucketCount)} />
                <Metric label="Usage buckets" value={numberFmt(snapshot.official.usageBucketCount)} />
                <Metric label="Official completions" value={snapshot.official.windowStart && !snapshot.official.usageWarning ? numberFmt(snapshot.official.usageSummary.completionsRequestCount) : "Not available"} />
                <Metric label="Official transcriptions" value={snapshot.official.windowStart && !snapshot.official.usageWarning ? numberFmt(snapshot.official.usageSummary.transcriptionRequestCount) : "Not available"} />
              </div>
              <p className="otg-help" style={{ marginTop: 10 }}>
                Last successful sync: {dateTime(snapshot.official.lastSyncAt)}. Cached input tokens: {numberFmt(snapshot.official.usageSummary.cachedInputTokens)}. Official audio seconds: {numberFmt(snapshot.official.usageSummary.audioSeconds)}.
              </p>
              <p className="otg-help">Official window: {dateTime(snapshot.official.windowStart)} to {dateTime(snapshot.official.windowEnd)}. Last attempt: {dateTime(snapshot.official.lastAttemptAt)}. Reporting may lag recent requests. Filters below apply to detail tables, not the organization overview.</p>
              {snapshot.official.usageWarning ? <p role="status">{snapshot.official.usageWarning}</p> : null}
              {!snapshot.official.configured ? <p className={styles.muted}>Official billing sync is not configured. Local usage and credit records remain available.</p> : snapshot.official.error ? <p style={{ color: "var(--color-warning)", marginTop: 8 }}>The last official sync could not complete. Review diagnostics or retry.</p> : null}
              <details className={styles.diagnostics}><summary>Sync diagnostics</summary><p>Official organization cost reporting requires the server-side OPENAI_ADMIN_API_KEY configuration. No key is displayed here.</p>{snapshot.official.configured && snapshot.official.error ? <p>Sync status: {snapshot.official.status}. Review the protected server logs for details.</p> : null}</details>
            </section>

            <section style={{ ...panelStyle, marginBottom: 16 }}>
              <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Filters</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                <Select label="Environment" value={filters.environment} onChange={(value) => setFilters((prev) => ({ ...prev, environment: value }))} options={snapshot.options.environments} />
                <Select label="User" value={filters.user} onChange={(value) => setFilters((prev) => ({ ...prev, user: value }))} options={snapshot.options.users} />
                <Select label="Feature" value={filters.feature} onChange={(value) => setFilters((prev) => ({ ...prev, feature: value }))} options={snapshot.options.features.map((item) => item.value)} labels={Object.fromEntries(snapshot.options.features.map((item) => [item.value, item.label]))} />
                <Select label="API project" value={filters.apiProject} onChange={(value) => setFilters((prev) => ({ ...prev, apiProject: value }))} options={snapshot.options.apiProjects} />
                <Select label="API key id" value={filters.apiKeyId} onChange={(value) => setFilters((prev) => ({ ...prev, apiKeyId: value }))} options={snapshot.options.apiKeyIds} />
                <Select label="Model" value={filters.model} onChange={(value) => setFilters((prev) => ({ ...prev, model: value }))} options={snapshot.options.models} />
                <Field label="Start" type="date" value={filters.start} onChange={(value) => setFilters((prev) => ({ ...prev, start: value }))} />
                <Field label="End" type="date" value={filters.end} onChange={(value) => setFilters((prev) => ({ ...prev, end: value }))} />
              </div>
            </section>

            <section className={styles.billingColumns}>
              <div style={panelStyle}>
                <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Usage by feature</h2>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead>
                      <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                        <th style={th}>Feature</th>
                        <th style={th}>Cost</th>
                        <th style={th}>Requests</th>
                        <th style={th}>Tokens</th>
                        <th style={th}>Audio</th>
                        <th style={th}>Models</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.features.length ? snapshot.features.map((feature) => (
                        <tr key={feature.feature}>
                          <td style={td}>{feature.label}</td>
                          <td style={td}>{usd(feature.estimatedCostUsd)}</td>
                          <td style={td}>{numberFmt(feature.requestCount)}</td>
                          <td style={td}>{numberFmt(feature.totalTokens)}</td>
                          <td style={td}>{feature.audioSeconds ? `${Math.round(feature.audioSeconds)}s` : "-"}</td>
                          <td style={td}>{feature.models.join(", ") || "-"}</td>
                        </tr>
                      )) : (
                        <tr><td style={td} colSpan={6}>No matching usage records.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={panelStyle}>
                <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Credits</h2>
                <p className={styles.muted}>Choose Starting balance for the amount currently shown in the OpenAI portal, not your original purchase. This form does not buy credits or change the official OpenAI account balance. Subscription grants can expire; update the baseline after grants or expiry.</p>
                <div style={{ display: "grid", gap: 10 }}>
                  <Select label="Entry type" value={credit.type} onChange={(value) => setCredit((prev) => ({ ...prev, type: value }))} options={["purchase", "starting_balance", "manual_reconciliation", "adjustment", "refund", "recharge"]} />
                  <Field label="Amount USD" value={credit.amountUsd} onChange={(value) => setCredit((prev) => ({ ...prev, amountUsd: value }))} placeholder="50.00" />
                  <Field label="Observed date and time (your local time)" type="datetime-local" value={credit.effectiveAt} onChange={(value) => setCredit((prev) => ({ ...prev, effectiveAt: value }))} />
                  <Field label="Note" value={credit.note} onChange={(value) => setCredit((prev) => ({ ...prev, note: value }))} placeholder="OpenAI portal reconciliation" />
                  <button className="otg-authShowBtn" style={{ padding: "10px 14px" }} disabled={Boolean(busy) || !credit.type || !credit.amountUsd.trim() || !Number.isFinite(Number(credit.amountUsd)) || !credit.effectiveAt} onClick={() => post("credit", { ...credit, effectiveAt: new Date(credit.effectiveAt).toISOString() })}>
                    {busy === "credit" ? "Saving..." : "Record credit entry"}
                  </button>
                </div>
                <div style={{ marginTop: 18 }}>
                  <h2>Spending controls</h2>
                  <Field label="Low balance warnings" value={warnings} onChange={setWarnings} placeholder="10, 5" />
                  <button
                    className="otg-authShowBtn"
                    style={{ marginTop: 10, padding: "10px 14px" }}
                    disabled={Boolean(busy) || !warnings.trim() || warnings.split(",").some(item => !item.trim() || !Number.isFinite(Number(item)) || Number(item) < 0)}
                    onClick={() => post("settings", { lowBalanceWarningsUsd: warnings.split(",").map((item) => Number(item.trim())) })}
                  >
                    Save warnings
                  </button>
                </div>
                <p className="otg-help" style={{ marginTop: 14 }}>
                  Kill switch: {snapshot.limits.killSwitch ? "enabled" : "disabled"}. Daily global limit: {usd(snapshot.limits.dailyGlobalLimitUsd)}.
                </p>
              </div>
            </section>

            <section className={styles.billingColumns}>
              <div style={panelStyle}>
                <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Credit history</h2>
                {snapshot.credits.length ? snapshot.credits.map((item) => (
                  <div key={item.id} style={{ borderTop: "1px solid rgba(255,255,255,.1)", padding: "10px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <strong>{item.type.replaceAll("_", " ")}</strong>
                      <span>{usd(item.amountUsd)}</span>
                    </div>
                    <div className="otg-help">{compactDate(item.effectiveAt)} {item.verifiedBalanceUsd != null ? `- verified balance ${usd(item.verifiedBalanceUsd)}` : ""}</div>
                    {item.note ? <div className="otg-help">{item.note}</div> : null}
                  </div>
                )) : <p className="otg-help">No credit entries recorded yet.</p>}
              </div>

              <div style={panelStyle}>
                <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Recent usage</h2>
                {snapshot.recentUsage.length ? snapshot.recentUsage.slice(0, 20).map((item) => (
                  <div key={`${item.ts}-${item.ownerKey}-${item.useCase}`} style={{ borderTop: "1px solid rgba(255,255,255,.1)", padding: "10px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <strong>{item.featureLabel}</strong>
                      <span>{usd(item.approximateCostUsd)}</span>
                    </div>
                    <div className="otg-help">{compactDate(item.ts)} - {item.model} - {numberFmt(item.totalTokens)} tokens{item.audioSeconds ? ` - ${Math.round(item.audioSeconds)}s audio` : ""}</div>
                  </div>
                )) : <p className="otg-help">No matching usage records.</p>}
              </div>
            </section>

            <section style={{ ...panelStyle, marginTop: 16 }}>
              <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Official buckets</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 16, margin: "0 0 8px" }}>Costs</h3>
                  {snapshot.officialCosts.length ? snapshot.officialCosts.slice(0, 12).map((item) => (
                    <div key={`${item.startTime}-${item.endTime}-${item.projectId || "org"}-${item.lineItem || "cost"}`} style={{ borderTop: "1px solid rgba(255,255,255,.1)", padding: "10px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <strong>{item.projectId || "Organization total"}</strong>
                        <span>{usd(item.amountUsd)}</span>
                      </div>
                      <div className="otg-help">{compactDate(item.startTime * 1000)} - {item.lineItem || "cost"}</div>
                    </div>
                  )) : <p className="otg-help">No official cost buckets synchronized.</p>}
                </div>
                <div>
                  <h3 style={{ fontSize: 16, margin: "0 0 8px" }}>Usage</h3>
                  {snapshot.officialUsage.length ? snapshot.officialUsage.slice(0, 12).map((item) => (
                    <div key={`${item.endpoint}-${item.startTime}-${item.endTime}-${item.apiKeyId || "key"}-${item.model || "model"}`} style={{ borderTop: "1px solid rgba(255,255,255,.1)", padding: "10px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <strong>{item.endpoint.replace("_", " ")}</strong>
                        <span>{numberFmt(item.requestCount)} requests</span>
                      </div>
                      <div className="otg-help">{compactDate(item.startTime * 1000)} - {item.projectId || "organization"} - {item.model || "mixed models"} - {item.apiKeyId || "no key id"}</div>
                    </div>
                  )) : <p className="otg-help">No official usage buckets synchronized.</p>}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12, background: "var(--color-surface)" }}>
      <div className="otg-help" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone === "warn" ? "var(--color-warning)" : tone === "good" ? "var(--color-success)" : "var(--color-text)" }}>{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="otg-help">{label}</span>
      <input style={inputStyle} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Select({ label, value, onChange, options, labels = {} }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="otg-help">{label}</span>
      <select style={inputStyle} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{labels[option] || option}</option>
        ))}
      </select>
    </label>
  );
}

const th = {
  borderBottom: "1px solid rgba(255,255,255,.15)",
  padding: "10px 8px",
  fontWeight: 700,
} as const;

const td = {
  borderBottom: "1px solid rgba(255,255,255,.08)",
  padding: "10px 8px",
  verticalAlign: "top",
} as const;


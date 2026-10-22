"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BillingSnapshot = {
  ok: true;
  environment: string;
  overview: {
    totalPrepaidCreditsUsd: number;
    totalApiSpendingUsd: number;
    localEstimatedSpendingUsd: number;
    officialReportedSpendingUsd: number | null;
    officialLocalDiscrepancyUsd: number | null;
    estimatedPrepaidBalanceUsd: number;
    consumedPercent: number;
    todaySpendingUsd: number;
    monthSpendingUsd: number;
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

type ApiResponse = BillingSnapshot | { ok: false; error: string; snapshot?: BillingSnapshot };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function responseError(data: ApiResponse, fallback: string) {
  return data.ok ? fallback : data.error || fallback;
}

function responseSnapshot(data: ApiResponse) {
  return data.ok ? data : data.snapshot || null;
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
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: "10px 12px",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
} as const;

const panelStyle = {
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: 16,
  background: "var(--color-card)",
  color: "var(--color-text)",
} as const;

export default function OpenAIBillingClient() {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    environment: "test",
    user: "",
    feature: "",
    apiProject: "",
    apiKeyId: "",
    model: "",
    start: "",
    end: "",
  });
  const [credit, setCredit] = useState({
    type: "purchase",
    amountUsd: "",
    effectiveAt: new Date().toISOString().slice(0, 10),
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
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/openai-billing${query ? `?${query}` : ""}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok) {
        setError(responseError(data, "Unable to load OpenAI billing."));
        const nextSnapshot = responseSnapshot(data);
        if (nextSnapshot) setSnapshot(nextSnapshot);
        return;
      }
      setSnapshot(data);
      setWarnings(data.overview.lowBalanceWarningsUsd.join(", "));
    } catch (err: unknown) {
      setError(errorMessage(err, "Unable to load OpenAI billing."));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function post(action: string, body: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/admin/openai-billing", {
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
          type: "purchase",
          amountUsd: "",
          effectiveAt: new Date().toISOString().slice(0, 10),
          note: "",
          verifiedBalanceUsd: "",
        });
      }
    } catch (err: unknown) {
      setError(errorMessage(err, "OpenAI billing update failed."));
    } finally {
      setBusy(null);
    }
  }

  const overview = snapshot?.overview;
  const warningThreshold = overview?.lowBalanceWarningsUsd.find((value) => overview.estimatedPrepaidBalanceUsd <= value);

  return (
    <main className="min-h-screen bg-[#03050b] p-3 text-white sm:p-6">
      <div className="mx-auto max-w-[1500px]">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0 }}>OpenAI Billing & Usage</h1>
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
              Add Credits / OpenAI Billing
            </a>
            <button className="otg-authShowBtn" style={{ padding: "10px 14px" }} onClick={() => post("sync", { days: 30 })} disabled={busy === "sync"}>
              {busy === "sync" ? "Syncing..." : "Sync Official Costs"}
            </button>
          </div>
        </div>

        {error ? <p role="alert" style={{ color: "#fecaca" }}>{error}</p> : null}
        {loading && !snapshot ? <p className="otg-help">Loading OpenAI billing...</p> : null}

        {snapshot && overview ? (
          <>
            <section style={{ ...panelStyle, marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                <Metric label="Recorded credits" value={usdFixed(overview.totalPrepaidCreditsUsd, 2)} />
                <Metric label="Total API spending" value={usd(overview.totalApiSpendingUsd)} />
                <Metric label="Estimated balance" value={usdBalance(overview.estimatedPrepaidBalanceUsd)} tone={warningThreshold != null ? "warn" : "good"} />
                <Metric label="Credits consumed" value={percent(overview.consumedPercent)} />
                <Metric label="Today" value={usd(overview.todaySpendingUsd)} />
                <Metric label="This month" value={usd(overview.monthSpendingUsd)} />
                <Metric label="Recorded usage" value={numberFmt(overview.totalRecordedUsage)} />
                <Metric label="Last sync" value={dateTime(overview.lastSynchronizationTimestamp)} />
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ height: 12, borderRadius: 999, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
                  <div style={{ width: `${overview.consumedPercent}%`, height: "100%", background: warningThreshold != null ? "#f59e0b" : "#22c55e" }} />
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
                {overview.warning ? <p style={{ color: "#fde68a", marginTop: 8 }}>{overview.warning}</p> : null}
                {warningThreshold != null ? <p style={{ color: "#fde68a", marginTop: 8 }}>Estimated balance is below the {usd(warningThreshold)} warning threshold.</p> : null}
              </div>
            </section>

            <section style={{ ...panelStyle, marginBottom: 16 }}>
              <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Official OpenAI sync</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                <Metric label="Admin key configured" value={snapshot.official.configured ? "Yes" : "No"} tone={snapshot.official.configured ? "good" : undefined} />
                <Metric label="Sync status" value={snapshot.official.status} />
                <Metric label="Cost buckets" value={numberFmt(snapshot.official.costBucketCount)} />
                <Metric label="Usage buckets" value={numberFmt(snapshot.official.usageBucketCount)} />
                <Metric label="Official completions" value={numberFmt(snapshot.official.usageSummary.completionsRequestCount)} />
                <Metric label="Official transcriptions" value={numberFmt(snapshot.official.usageSummary.transcriptionRequestCount)} />
              </div>
              <p className="otg-help" style={{ marginTop: 10 }}>
                Last successful sync: {dateTime(snapshot.official.lastSyncAt)}. Cached input tokens: {numberFmt(snapshot.official.usageSummary.cachedInputTokens)}. Official audio seconds: {numberFmt(snapshot.official.usageSummary.audioSeconds)}.
              </p>
              {snapshot.official.error ? <p style={{ color: "#fecaca", marginTop: 8 }}>{snapshot.official.error}</p> : null}
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

            <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, .8fr)", gap: 16, alignItems: "start", marginBottom: 16 }}>
              <div style={panelStyle}>
                <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Usage by feature</h2>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead>
                      <tr style={{ color: "#cbd5e1", textAlign: "left" }}>
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
                <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Credits & controls</h2>
                <div style={{ display: "grid", gap: 10 }}>
                  <Select label="Entry type" value={credit.type} onChange={(value) => setCredit((prev) => ({ ...prev, type: value }))} options={["purchase", "starting_balance", "manual_reconciliation", "adjustment", "refund", "recharge"]} />
                  <Field label="Amount USD" value={credit.amountUsd} onChange={(value) => setCredit((prev) => ({ ...prev, amountUsd: value }))} placeholder="50.00" />
                  <Field label="Effective date" type="date" value={credit.effectiveAt} onChange={(value) => setCredit((prev) => ({ ...prev, effectiveAt: value }))} />
                  <Field label="Verified portal balance" value={credit.verifiedBalanceUsd} onChange={(value) => setCredit((prev) => ({ ...prev, verifiedBalanceUsd: value }))} placeholder="Optional" />
                  <Field label="Note" value={credit.note} onChange={(value) => setCredit((prev) => ({ ...prev, note: value }))} placeholder="OpenAI portal reconciliation" />
                  <button className="otg-authShowBtn" style={{ padding: "10px 14px" }} disabled={busy === "credit"} onClick={() => post("credit", credit)}>
                    {busy === "credit" ? "Saving..." : "Record credit entry"}
                  </button>
                </div>
                <div style={{ marginTop: 18 }}>
                  <Field label="Low balance warnings" value={warnings} onChange={setWarnings} placeholder="10, 5" />
                  <button
                    className="otg-authShowBtn"
                    style={{ marginTop: 10, padding: "10px 14px" }}
                    disabled={busy === "settings"}
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

            <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
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


"use client";

import { useRef, useState } from "react";

type Connection = {
  configured: boolean; enabled: boolean; officialBillingConfigured: boolean;
  probe: { checkedAt: string; authentication: string; modelAccess: Record<string, boolean>; message: string } | null;
  creditsNotice: string;
  routes: Array<{ feature: string; provider: string; model: string }>;
};

export default function OpenAIConnectionPanel() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checking = useRef(false);
  async function check() {
    if (checking.current) return;
    checking.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/openai-ai/status", { method: "POST", credentials: "include", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "OpenAI status unavailable.");
      setConnection(body.connection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OpenAI status unavailable.");
    } finally { checking.current = false; setBusy(false); }
  }
  return <section aria-label="OpenAI connection" className="space-y-3 rounded-[22px] border border-white/10 bg-black/20 p-4">
    <h2 className="text-lg font-bold">OpenAI connection</h2>
    <p className="text-sm opacity-75">Story assistance, prompt enhancement and H3 AI Director use the server connection. Image and video rendering stays local.</p>
    <button type="button" onClick={() => void check()} disabled={busy} className="rounded-xl border border-white/20 px-4 py-3 font-semibold disabled:opacity-50">{busy ? "Checking OpenAI…" : "Check OpenAI connection"}</button>
    <div role="status" aria-live="polite" className="text-sm">
      {error ? <p role="alert">{error}</p> : connection ? <>
        <p>{!connection.configured ? "API key is not configured." : !connection.enabled ? "OpenAI is disabled by the server kill switch." : connection.probe?.message}</p>
        {connection.probe ? <p>Checked: {new Date(connection.probe.checkedAt).toLocaleString()}</p> : null}
      </> : <p>Not checked this session. This check does not generate content or spend API credits.</p>}
    </div>
    {connection ? <details><summary className="cursor-pointer py-2 font-semibold">Feature routing and model access</summary>
      <ul className="space-y-2 text-sm">{connection.routes.map(route => <li key={route.feature} className="break-words">{route.feature}: {route.provider} · {route.model}</li>)}</ul>
      {connection.probe ? <ul className="mt-3 text-sm">{Object.entries(connection.probe.modelAccess).map(([model, available]) => <li key={model}>{model}: {available ? "model access verified" : "model access not verified"}</li>)}</ul> : null}
    </details> : null}
    <p className="text-sm opacity-75">{connection?.creditsNotice || "API credit balance is not available from this connection check."}</p>
    <p className="text-sm opacity-75">Eligible Pro API credits must be claimed and linked to the same API organization. Signing into this app or ChatGPT does not link billing automatically.</p>
    <div className="flex flex-wrap gap-4 text-sm underline">
      <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">OpenAI billing and credit benefit</a>
      <a href="https://developers.openai.com/api/docs/guides/chatgpt-api-credits" target="_blank" rel="noreferrer">Credit eligibility and linking guide</a>
    </div>
    {connection ? <p className="text-sm opacity-75">Official spending sync: {connection.officialBillingConfigured ? "credential configured; use Admin Billing to sync costs" : "not configured; this does not prevent AI assistance"}. Official costs are spending, not your remaining balance.</p> : null}
  </section>;
}

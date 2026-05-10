"use client";

import React, { useMemo, useState } from "react";

type JsonResult = {
  ok: boolean;
  status: number;
  data: unknown;
  raw: string;
};

type TabId = "index" | "faq" | "diagnostics" | "feedback" | "notes";
type Faq = { q: string; a: React.ReactNode };
type Severity = "Low" | "Medium" | "High" | "Blocking";

async function safeJson(res: Response): Promise<JsonResult> {
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null, raw: text };
  } catch {
    return { ok: res.ok, status: res.status, data: null, raw: text };
  }
}

async function readEndpoint(path: string): Promise<JsonResult> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    return await safeJson(res);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, data: null, raw: message };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boolLabel(value: unknown): string {
  return value === true ? "yes" : "no";
}

function errorText(result: JsonResult): string {
  if (isRecord(result.data)) {
    const fromData = pickString(result.data.error) || pickString(result.data.message);
    if (fromData) return fromData;
  }
  return result.raw || `HTTP ${result.status}`;
}

function summarizeSession(result: JsonResult): string {
  if (result.ok && isRecord(result.data) && result.data.ok === true && isRecord(result.data.user)) {
    const user = result.data.user;
    const email = pickString(user.email);
    const username = pickString(user.username);
    const tier = pickString(user.tier);
    const admin = boolLabel(user.admin);
    const name = email || username || "signed-in user";
    return `${name}${tier ? ` / tier: ${tier}` : ""} / admin: ${admin}`;
  }
  if (result.status === 401) return "not signed in or session expired";
  return `check failed: ${errorText(result)}`;
}

function summarizeComfy(result: JsonResult): string {
  if (isRecord(result.data)) {
    const hint = pickString(result.data.serverHint) || (result.ok ? "Connected" : "Disconnected");
    const state = pickString(result.data.serverState);
    const baseUrl = pickString(result.data.comfyBaseUrl);
    const upstreamStatus = result.data.upstreamStatus === undefined ? "" : String(result.data.upstreamStatus);
    const detail = [state ? `state: ${state}` : "", baseUrl ? `url: ${baseUrl}` : "", upstreamStatus ? `upstream: ${upstreamStatus}` : ""]
      .filter(Boolean)
      .join(" / ");
    return `${hint}${detail ? ` / ${detail}` : ""}`;
  }
  return result.ok ? "Connected" : `Disconnected / ${errorText(result)}`;
}

function compactText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 120)}\n\n[diagnostic report truncated: ${value.length} characters total]`;
}

function TabButton({
  id,
  label,
  active,
  onClick,
}: {
  id: TabId;
  label: string;
  active: boolean;
  onClick: (id: TabId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={[
        "px-3 py-2 text-sm rounded-xl border transition",
        active
          ? "bg-white/10 border-white/25 text-white"
          : "bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:border-white/20",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4 shadow-sm">
      <div className="text-base font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm text-white/80">{children}</div>
    </div>
  );
}

export default function SupportPanel() {
  const [tab, setTab] = useState<TabId>("index");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const [diagnosticsText, setDiagnosticsText] = useState<string>("");
  const [diagnosticsBusy, setDiagnosticsBusy] = useState<boolean>(false);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string>("");
  const [diagnosticsError, setDiagnosticsError] = useState<string>("");

  const [fbCategory, setFbCategory] = useState<string>("Generate");
  const [fbSeverity, setFbSeverity] = useState<Severity>("Medium");
  const [fbMessage, setFbMessage] = useState<string>("");
  const [fbSteps, setFbSteps] = useState<string>("");
  const [fbIncludeDiagnostics, setFbIncludeDiagnostics] = useState<boolean>(true);
  const [fbBusy, setFbBusy] = useState<boolean>(false);
  const [fbOk, setFbOk] = useState<string>("");
  const [fbErr, setFbErr] = useState<string>("");

  const categories = useMemo(
    () => [
      "Login / Account",
      "AI Assistance",
      "Generate",
      "Angles",
      "Characters",
      "Production",
      "Gallery",
      "Favorites",
      "Settings",
      "Support",
      "Other",
    ],
    [],
  );

  const severities: Severity[] = useMemo(() => ["Low", "Medium", "High", "Blocking"], []);

  const faqs: Faq[] = useMemo(
    () => [
      {
        q: "What should I use each major tab for?",
        a: (
          <div className="space-y-2">
            <p>
              Use <b>Generate</b> for direct ComfyUI image/video jobs, <b>Characters</b> for saved character assets,
              <b>Production</b> for scene-based projects, and <b>Gallery/Favorites</b> for reviewing saved output.
            </p>
            <p>
              Use <b>Settings</b> for account, appearance, connection checks, and safe recovery controls.
            </p>
          </div>
        ),
      },
      {
        q: "Why did my generation fail?",
        a: (
          <div className="space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <b>VRAM/OOM</b>: reduce duration, reduce resolution, or close other GPU-heavy tools.
              </li>
              <li>
                <b>Comfy disconnected</b>: use Settings or Diagnostics here to check the current Comfy target.
              </li>
              <li>
                <b>Workflow mismatch</b>: confirm the selected workflow matches text-to-image, text-to-video, image-to-video, or character-intro use.
              </li>
              <li>
                <b>Custom node drift</b>: check the ComfyUI console for missing node/input errors.
              </li>
            </ul>
          </div>
        ),
      },
      {
        q: "How does Production save scene work now?",
        a: (
          <div className="space-y-2">
            <p>
              Production uses locked scenes. Once a scene video is locked, it should persist through refresh, tab changes,
              and Continue Production. Completed projects are review-only and should appear under Completed Projects.
            </p>
            <p>
              The floating Production widget is guide-only. It should expand and collapse, not jump between workflow steps.
            </p>
          </div>
        ),
      },
      {
        q: "Why is my Gallery or Favorites list missing recent content?",
        a: (
          <div className="space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              <li>Open Gallery and use <b>Update Content</b> if the item was created outside the normal UI flow.</li>
              <li>Confirm the output is in the expected Comfy output folder and has not been moved or deleted.</li>
              <li>Favorites only shows items whose favorite metadata is currently saved.</li>
            </ul>
          </div>
        ),
      },
      {
        q: "What should I include in a bug report?",
        a: (
          <div className="space-y-2">
            <p>
              Include the tab name, the exact button/action, what you expected, what happened instead, and the diagnostic report from this Support tab.
            </p>
            <p>
              For generation failures, include the workflow name, prompt, size/duration settings, and the ComfyUI console error.
            </p>
          </div>
        ),
      },
    ],
    [],
  );

  const canSubmit = fbMessage.trim().length > 0 && !fbBusy;

  const collectDiagnostics = async (): Promise<string> => {
    const now = new Date().toISOString();
    const url = typeof window !== "undefined" ? window.location.href : "unavailable";
    const viewport = typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "unavailable";
    const screenSize = typeof window !== "undefined" && window.screen ? `${window.screen.width}x${window.screen.height}` : "unavailable";
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "unavailable";
    const platform = typeof navigator !== "undefined" ? navigator.platform : "unavailable";
    const language = typeof navigator !== "undefined" ? navigator.language : "unavailable";

    const [sessionResult, comfyResult] = await Promise.all([readEndpoint("/api/whoami"), readEndpoint("/api/comfy-status?mode=video")]);

    return [
      "SLR Studios OTG Support Diagnostics",
      `Timestamp: ${now}`,
      `URL: ${url}`,
      `Viewport: ${viewport}`,
      `Screen: ${screenSize}`,
      `Platform: ${platform}`,
      `Language: ${language}`,
      `Browser: ${userAgent}`,
      `Session: ${summarizeSession(sessionResult)}`,
      `Comfy: ${summarizeComfy(comfyResult)}`,
    ].join("\n");
  };

  const runDiagnostics = async () => {
    setDiagnosticsBusy(true);
    setDiagnosticsStatus("");
    setDiagnosticsError("");
    try {
      const text = await collectDiagnostics();
      setDiagnosticsText(text);
      setDiagnosticsStatus("Diagnostics updated.");
      return text;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setDiagnosticsError(message);
      throw error;
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  const copyDiagnostics = async () => {
    setDiagnosticsStatus("");
    setDiagnosticsError("");
    try {
      const text = diagnosticsText || (await runDiagnostics());
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard API is unavailable in this browser.");
      }
      await navigator.clipboard.writeText(text);
      setDiagnosticsStatus("Diagnostics copied.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setDiagnosticsError(message);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setFbBusy(true);
    setFbOk("");
    setFbErr("");
    try {
      let diagnostics = diagnosticsText;
      if (fbIncludeDiagnostics && !diagnostics) {
        diagnostics = await collectDiagnostics();
        setDiagnosticsText(diagnostics);
      }

      const parts = [
        `Severity: ${fbSeverity}`,
        "",
        "Message:",
        fbMessage.trim(),
      ];

      if (fbSteps.trim()) {
        parts.push("", "Steps to reproduce:", fbSteps.trim());
      }

      if (fbIncludeDiagnostics && diagnostics) {
        parts.push("", "Diagnostics:", diagnostics);
      }

      const message = compactText(parts.join("\n"), 7800);

      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: fbCategory,
          message,
          page: typeof window !== "undefined" ? window.location.href : "/app (Support)",
        }),
      });
      const j = await safeJson(res);
      if (!j.ok) throw new Error(isRecord(j.data) ? pickString(j.data.error) || j.raw || `Submit failed (${j.status})` : j.raw || `Submit failed (${j.status})`);
      setFbOk("Submitted.");
      setFbMessage("");
      setFbSteps("");
      setFbSeverity("Medium");
      setFbCategory("Generate");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setFbErr(message);
    } finally {
      setFbBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow">
        <div className="text-lg font-semibold">Support</div>
        <div className="text-sm text-white/75">
          Current app guide, quick diagnostics, troubleshooting notes, and bug reports.
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <TabButton id="index" label="Index" active={tab === "index"} onClick={setTab} />
          <TabButton id="faq" label="FAQ" active={tab === "faq"} onClick={setTab} />
          <TabButton id="diagnostics" label="Diagnostics" active={tab === "diagnostics"} onClick={setTab} />
          <TabButton id="feedback" label="Feedback" active={tab === "feedback"} onClick={setTab} />
          <TabButton id="notes" label="Notes" active={tab === "notes"} onClick={setTab} />
        </div>
      </div>

      {tab === "index" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <InfoCard title="Create">
              <ul className="list-disc pl-5 space-y-1">
                <li><b>AI Assistance</b>: describe images, enhance prompts, and build scene text.</li>
                <li><b>Generate</b>: submit direct ComfyUI image/video jobs.</li>
                <li><b>Angles</b>: create and review 3D model/texture outputs when the Hunyuan service is available.</li>
                <li><b>Characters</b>: save reusable character images, descriptions, intro videos, and reference audio.</li>
              </ul>
            </InfoCard>

            <InfoCard title="Organize">
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Production</b>: build scene-based projects with locked scene persistence.</li>
                <li><b>Gallery</b>: review generated images/videos and pull in new output with Update Content.</li>
                <li><b>Favorites</b>: review only favorited Gallery items.</li>
              </ul>
            </InfoCard>

            <InfoCard title="Manage">
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Settings</b>: account controls, theme/font preferences, Comfy connection check, and safe recovery tools.</li>
                <li><b>Support</b>: diagnostics, troubleshooting, and feedback.</li>
              </ul>
            </InfoCard>

            <InfoCard title="Fast bug report">
              <p>
                Run diagnostics, copy the report, then submit Feedback with the tab name, action, expected result, and actual result.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="otg-btn" onClick={() => setTab("diagnostics")}>Open Diagnostics</button>
                <button type="button" className="otg-btnPrimary" onClick={() => setTab("feedback")}>Open Feedback</button>
              </div>
            </InfoCard>
          </div>
        </div>
      ) : null}

      {tab === "faq" ? (
        <div className="space-y-2">
          {faqs.map((x, i) => (
            <div key={x.q} className="rounded-2xl border border-white/10 bg-black/25">
              <button
                type="button"
                onClick={() => setOpenFaq((v) => (v === i ? null : i))}
                className="w-full px-4 py-3 text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{x.q}</div>
                  <div className="text-xs text-white/60">{openFaq === i ? "Hide" : "Show"}</div>
                </div>
              </button>
              {openFaq === i ? <div className="px-4 pb-4 text-sm text-white/85">{x.a}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {tab === "diagnostics" ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow">
          <div className="text-lg font-semibold">Quick Diagnostics</div>
          <div className="mt-1 text-sm text-white/75">
            Checks browser context, session state, and the current Comfy connection target. This does not delete or change anything.
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="otg-btnPrimary" disabled={diagnosticsBusy} onClick={runDiagnostics}>
              {diagnosticsBusy ? "Checking..." : "Run Diagnostics"}
            </button>
            <button type="button" className="otg-btn" disabled={diagnosticsBusy} onClick={copyDiagnostics}>
              Copy Diagnostic Report
            </button>
          </div>

          {diagnosticsError ? <div className="otg-error mt-3">{diagnosticsError}</div> : null}
          {diagnosticsStatus ? <div className="otg-ok mt-3">{diagnosticsStatus}</div> : null}

          <textarea
            className="otg-textarea mt-4 font-mono text-xs"
            value={diagnosticsText}
            onChange={(event) => setDiagnosticsText(event.target.value)}
            rows={10}
            placeholder="Run diagnostics to generate a copyable report."
          />
        </div>
      ) : null}

      {tab === "feedback" ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow">
          <div className="text-lg font-semibold">Feedback</div>
          <div className="mt-1 text-sm text-white/75">
            Submit an issue or improvement request. Diagnostics can be included automatically.
          </div>

          <div className="mt-4 grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-white/60">Category</div>
                <select className="otg-authInput" value={fbCategory} onChange={(event) => setFbCategory(event.target.value)} disabled={fbBusy}>
                  {categories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-xs text-white/60">Severity</div>
                <select className="otg-authInput" value={fbSeverity} onChange={(event) => setFbSeverity(event.target.value as Severity)} disabled={fbBusy}>
                  {severities.map((severity) => (
                    <option key={severity} value={severity}>{severity}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-white/60">Message</div>
              <textarea
                className="otg-textarea"
                value={fbMessage}
                onChange={(event) => setFbMessage(event.target.value)}
                placeholder="What broke, or what should be improved?"
                rows={5}
                disabled={fbBusy}
              />
            </div>

            <div>
              <div className="mb-1 text-xs text-white/60">Steps to reproduce (optional)</div>
              <textarea
                className="otg-textarea"
                value={fbSteps}
                onChange={(event) => setFbSteps(event.target.value)}
                placeholder="Example: Open Gallery -> click Update Content -> expected X -> got Y."
                rows={4}
                disabled={fbBusy}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={fbIncludeDiagnostics}
                onChange={(event) => setFbIncludeDiagnostics(event.target.checked)}
                disabled={fbBusy}
              />
              Include diagnostics with this report
            </label>

            {fbErr ? <div className="otg-error">{fbErr}</div> : null}
            {fbOk ? <div className="otg-ok">{fbOk}</div> : null}

            <div className="flex justify-end">
              <button type="button" className="otg-btnPrimary" disabled={!canSubmit} onClick={submit} style={{ minWidth: 160 }}>
                {fbBusy ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow">
          <div className="text-lg font-semibold">Troubleshooting Notes</div>
          <div className="mt-1 text-sm text-white/75">
            Use these before reporting a bug. They cover the common failure paths in this app.
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <InfoCard title="Generation failed">
              <ul className="list-disc pl-5 space-y-1">
                <li>Copy the workflow name, prompt, negative prompt, size, duration, and error text.</li>
                <li>If the error mentions VRAM or OOM, reduce resolution/duration and retry.</li>
                <li>If the error mentions a node or missing input, the Comfy workflow/custom node set needs repair.</li>
              </ul>
            </InfoCard>

            <InfoCard title="Job stuck or already running">
              <ul className="list-disc pl-5 space-y-1">
                <li>Use Settings to check Comfy status.</li>
                <li>Use the safe clear pipeline/recovery control if a stale running state is blocking new jobs.</li>
                <li>Do not repeatedly click Generate while a job is queued.</li>
              </ul>
            </InfoCard>

            <InfoCard title="Gallery or Favorites stale">
              <ul className="list-disc pl-5 space-y-1">
                <li>Use Gallery Update Content.</li>
                <li>Confirm the file still exists in the output folder.</li>
                <li>Favorites depends on saved favorite metadata; unfavoriting removes it from Favorites immediately.</li>
              </ul>
            </InfoCard>

            <InfoCard title="Login or account issue">
              <ul className="list-disc pl-5 space-y-1">
                <li>Refresh once, then log out and back in if the session is stale.</li>
                <li>Use Settings for password changes or account deletion.</li>
                <li>Run Diagnostics before reporting the issue.</li>
              </ul>
            </InfoCard>

            <InfoCard title="Production persistence issue">
              <ul className="list-disc pl-5 space-y-1">
                <li>Report whether the scene was locked before leaving the page.</li>
                <li>Include whether the issue happened after refresh, tab change, Continue Production, or Completed Projects.</li>
                <li>Completed projects should be read-only.</li>
              </ul>
            </InfoCard>

            <InfoCard title="What not to change from Support">
              <p>
                Support does not edit workflows, clear projects, delete Gallery files, or change server environment variables. Those controls belong in scoped admin or Settings flows.
              </p>
            </InfoCard>
          </div>
        </div>
      ) : null}
    </div>
  );
}

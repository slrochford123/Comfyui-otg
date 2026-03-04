"use client";

import React, { useMemo, useState } from "react";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null, raw: text };
  } catch {
    return { ok: res.ok, status: res.status, data: null, raw: text };
  }
}

type TabId = "index" | "faq" | "feedback" | "notes";
type Faq = { q: string; a: React.ReactNode };

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
        "px-3 py-2 text-sm rounded-xl border",
        active
          ? "bg-white/10 border-white/20"
          : "bg-black/20 border-white/10 hover:bg-white/5 hover:border-white/20",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default function SupportPanel() {
  const [tab, setTab] = useState<TabId>("index");

  const faqs: Faq[] = useMemo(
    () => [
      {
        q: "How do I generate content?",
        a: (
          <div className="space-y-2">
            <p>
              Go to <b>Generate</b>, pick a workflow, paste your prompt, optionally add LoRAs, then press <b>Generate</b>.
              Use <b>Show Content</b> after completion to display the latest result under the progress bar.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <b>Default/480p/512p/720p</b> changes output size (Default keeps workflow native size).
              </li>
              <li>
                <b>Duration</b> converts seconds → frames using the workflow FPS.
              </li>
              <li>
                Use <b>Clear pipeline</b> in Settings if you ever get an “already running” error.
              </li>
            </ul>
          </div>
        ),
      },
      {
        q: "Why did my generation fail?",
        a: (
          <div className="space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <b>OOM / VRAM</b>: drop from 720p → 512p/480p, reduce duration, or close other GPU apps.
              </li>
              <li>
                <b>Queue</b>: if multiple jobs are running, wait for the queue to drain or clear the queue (admin tools).
              </li>
              <li>
                <b>Workflow mismatch</b>: confirm the workflow you selected matches the type of content you expect.
              </li>
            </ul>
          </div>
        ),
      },
      {
        q: "How do I use AI Assistance?",
        a: (
          <div className="space-y-2">
            <p>
              AI Assistance helps turn your story beats into a multi-scene plan and then into formatted prompts
              (e.g., <b>Next Scene 1/2/3…</b>). You can type, or record audio and transcribe.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <b>Start Mic</b> records audio in the browser (availability depends on device/browser support).
              </li>
              <li>
                <b>Transcribe</b> converts audio to text (requires server tooling).
              </li>
              <li>
                <b>Generate Scene Plan</b> creates editable beats.
              </li>
              <li>
                <b>Generate Prompt</b> converts a plan into scene prompts.
              </li>
            </ul>
          </div>
        ),
      },
      {
        q: "How do Gallery actions work?",
        a: (
          <div className="space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <b>Open</b>: view the image/video larger.
              </li>
              <li>
                <b>Show Prompt</b>: view the saved prompt/negative/workflow meta that generated it.
              </li>
              <li>
                <b>Redo</b>: resubmits the original payload and shows <b>Sent</b> once queued.
              </li>
            </ul>
          </div>
        ),
      },
      {
        q: "How do I report a bug?",
        a: (
          <div className="space-y-2">
            <p>
              Include a screenshot + the failing API route (DevTools → Network). If possible include the response body and
              console stack trace.
            </p>
          </div>
        ),
      },
    ],
    [],
  );

  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Feedback
  const categories = useMemo(
    () => [
      "Login",
      "AI Assistant",
      "Generate",
      "Angles",
      "Storyboard",
      "Gallery",
      "Favorites",
      "Voices",
      "Invoices",
      "Settings",
      "Other",
    ],
    [],
  );

  const [fbCategory, setFbCategory] = useState<string>("Generate");
  const [fbMessage, setFbMessage] = useState<string>("");
  const [fbBusy, setFbBusy] = useState<boolean>(false);
  const [fbOk, setFbOk] = useState<string>("");
  const [fbErr, setFbErr] = useState<string>("");

  const canSubmit = !!fbMessage.trim() && !fbBusy;

  const submit = async () => {
    if (!canSubmit) return;
    setFbBusy(true);
    setFbOk("");
    setFbErr("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: fbCategory,
          message: fbMessage,
          page: "/app (Support)",
        }),
      });
      const j = await safeJson(res);
      if (!j.ok) throw new Error((j.data as any)?.error || j.raw || `Submit failed (${j.status})`);
      setFbOk("Submitted. Thank you.");
      setFbMessage("");
      setFbCategory("Generate");
    } catch (e: any) {
      setFbErr(e?.message || String(e));
    } finally {
      setFbBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow">
        <div className="text-lg font-semibold">Support</div>
        <div className="text-sm opacity-80">
          Usage notes, quick answers, and feedback. If something is broken, include screenshots and the failing API route.
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <TabButton id="index" label="Index" active={tab === "index"} onClick={setTab} />
          <TabButton id="faq" label="FAQ" active={tab === "faq"} onClick={setTab} />
          <TabButton id="feedback" label="Feedback" active={tab === "feedback"} onClick={setTab} />
          <TabButton id="notes" label="Notes" active={tab === "notes"} onClick={setTab} />
        </div>
      </div>

      {tab === "index" ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow">
          <div className="text-lg font-semibold">Index</div>
          <div className="text-sm opacity-80 mt-1">
            What the main buttons do in each section of the app.
          </div>

          <div className="mt-4 space-y-4 text-sm opacity-90">
            <div className="space-y-2">
              <div className="font-medium">Generate</div>
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Workflow</b>: selects the generation pipeline.</li>
                <li><b>Generate</b>: submits a job to ComfyUI.</li>
                <li><b>Show Content</b>: reveals the latest output preview after completion.</li>
                <li><b>Duration / Size presets</b>: adjusts frames/output scale for supported workflows.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="font-medium">AI Assistant</div>
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Start Mic</b>: records in-browser audio (device/browser dependent).</li>
                <li><b>Transcribe</b>: converts recorded audio to text (server tool required).</li>
                <li><b>Generate Scene Plan</b>: builds a multi-scene plan from your text.</li>
                <li><b>Generate Prompt</b>: turns the plan into scene-formatted prompts.</li>
                <li><b>Copy</b>: copies prompt text to clipboard.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="font-medium">Gallery</div>
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Open</b>: view in full.</li>
                <li><b>Show Prompt</b>: shows the prompt/workflow metadata saved with the file.</li>
                <li><b>Redo</b>: re-submits the original payload.</li>
                <li><b>Animate → LTX2</b>: uses an image as input to create a video (when available on the item).</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="font-medium">Voices</div>
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Upload reference clip</b>: uploads audio or MP4/MOV and extracts audio.</li>
                <li><b>Create Voice</b>: runs the voice pipeline (requires server models/tools).</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="font-medium">Settings</div>
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Clear pipeline</b>: resets stuck running states (use if jobs are stuck).</li>
                <li><b>Comfy targets</b>: selects backend device/instance (if configured).</li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "faq" ? (
        <div className="space-y-2">
          {faqs.map((x, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-black/25">
              <button
                type="button"
                onClick={() => setOpenFaq((v) => (v === i ? null : i))}
                className="w-full px-4 py-3 text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{x.q}</div>
                  <div className="text-xs opacity-70">{openFaq === i ? "Hide" : "Show"}</div>
                </div>
              </button>
              {openFaq === i ? <div className="px-4 pb-4 text-sm opacity-90">{x.a}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {tab === "feedback" ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow">
          <div className="text-lg font-semibold">Feedback</div>
          <div className="text-sm opacity-80" style={{ marginTop: 6 }}>
            Send notes to the admin. Choose a category, write your message, then submit.
          </div>

          <div className="mt-4 grid gap-3">
            <div>
              <div className="text-xs opacity-70" style={{ marginBottom: 6 }}>
                Category
              </div>
              <select
                className="otg-authInput"
                value={fbCategory}
                onChange={(e) => setFbCategory(e.target.value)}
                disabled={fbBusy}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-xs opacity-70" style={{ marginBottom: 6 }}>
                Message
              </div>
              <textarea
                className="otg-textarea"
                value={fbMessage}
                onChange={(e) => setFbMessage(e.target.value)}
                placeholder="What should be fixed or improved?"
                rows={5}
                disabled={fbBusy}
              />
            </div>

            {fbErr ? <div className="otg-error">{fbErr}</div> : null}
            {fbOk ? <div className="otg-ok">{fbOk}</div> : null}

            <div className="flex justify-end">
              <button
                type="button"
                className="otg-btnPrimary"
                disabled={!canSubmit}
                onClick={submit}
                style={{ minWidth: 160 }}
              >
                {fbBusy ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow">
          <div className="text-lg font-semibold">Notes</div>
          <div className="text-sm opacity-80 mt-1">
            What to include when reporting problems (so fixes are fast and deterministic).
          </div>

          <div className="mt-4 text-sm opacity-90 space-y-3">
            <div className="space-y-1">
              <div className="font-medium">If a generation failed</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>Screenshot of the error toast or result panel.</li>
                <li>ComfyUI console error block (node name + stack trace).</li>
                <li>Workflow name + size/duration settings used.</li>
              </ul>
            </div>

            <div className="space-y-1">
              <div className="font-medium">If a button does nothing</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>Browser + device (iPhone/Android/Desktop) and the exact page.</li>
                <li>Browser console error (full stack) if present.</li>
                <li>DevTools → Network: failing request URL + response JSON.</li>
              </ul>
            </div>

            <div className="space-y-1">
              <div className="font-medium">Common causes</div>
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Auth/session</b>: stale cookie → refresh / logout/login.</li>
                <li><b>OOM</b>: reduce size/duration or stop other GPU apps.</li>
                <li><b>Backend drift</b>: custom node dependency mismatch in ComfyUI.</li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

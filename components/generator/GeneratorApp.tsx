'use client';

import React, { useEffect, useMemo, useState } from "react";
import { useGeneratorState } from "../../lib/generator/useGeneratorState";
import { buildComfySubmitPayloadFromState } from "../../lib/generator/buildComfyPayload";
import { WorkflowSelect, type WorkflowOption } from "./WorkflowSelect";
import { VideoProfilePicker } from "./VideoProfilePicker";
import { DurationPicker } from "./DurationPicker";
import { EnhancePanel } from "./EnhancePanel"; // ✅ ADD

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function GeneratorApp() {
  const [state, dispatch] = useGeneratorState();
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loadingWf, setLoadingWf] = useState(false);

  // using one "sending" flag for both enhance + generate keeps UI simple
  const [sending, setSending] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);

  async function loadWorkflows() {
    setLoadingWf(true);
    setMsg(null);
    try {
      const res = await fetch("/api/workflows", { cache: "no-store" });
      const data = await safeJson<any>(res); // shape may be {list} or array
      const list: WorkflowOption[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.list)
        ? data.list
        : [];
      setWorkflows(list);

      // auto-select saved preset if still exists, otherwise first
      if (list.length && !list.some((w) => w.id === state.presetId)) {
        dispatch({ type: "setPreset", presetId: list[0].id });
      }
    } catch (e: any) {
      setMsg(e?.message || "Failed to load workflows");
    } finally {
      setLoadingWf(false);
    }
  }

  useEffect(() => {
    loadWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ ADD: Enhance handler (Small/Medium/Large)
  async function onEnhance() {
    const text = state.prompt?.trim();
    if (!text) {
      setMsg("Enter a prompt to enhance.");
      return;
    }

    setSending(true);
    setMsg(null);

    try {
      const res = await fetch("/api/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          level: state.enhanceLevel, // "small" | "medium" | "large"
        }),
      });

      const data = await safeJson<any>(res);

      // Accept {text}, or {ok:true,text}, or error payloads
      const enhanced =
        typeof data?.text === "string"
          ? data.text
          : typeof data?.result === "string"
          ? data.result
          : typeof data?.enhanced === "string"
          ? data.enhanced
          : null;

      if (!res.ok || !enhanced) {
        setMsg(data?.error || `Enhance failed (${res.status})`);
        return;
      }

      dispatch({ type: "setPrompt", prompt: enhanced });
      setMsg("Prompt enhanced.");
    } catch (e: any) {
      setMsg(e?.message || "Enhance failed");
    } finally {
      setSending(false);
    }
  }

  async function onGenerate() {
    setSending(true);
    setMsg(null);
    try {
      const payload = buildComfySubmitPayloadFromState(state);

      // OTG expects a device id header; keep existing behavior if present
      const deviceId =
        (typeof window !== "undefined" && window.localStorage.getItem("otg_device_id")) || "";

      const res = await fetch("/api/comfy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(deviceId ? { "x-otg-device-id": deviceId } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await safeJson<any>(res);
      if (!res.ok || data?.ok === false) {
        setMsg(data?.error || `Generate failed (${res.status})`);
        return;
      }
      setMsg("Submitted to ComfyUI. Check Gallery for results.");
    } catch (e: any) {
      setMsg(e?.message || "Generate failed");
    } finally {
      setSending(false);
    }
  }

  const wfValue = useMemo(() => state.presetId, [state.presetId]);

  return (
    <div className="otg-shell">
      <div className="otg-main">
        <div className="otg-card">
          <div className="otg-cardTitle">Generate</div>
          <div className="otg-muted">New UI (Storybook-driven). Add ?ui=old to use legacy.</div>
        </div>

        <WorkflowSelect
          workflows={workflows}
          value={wfValue}
          onChange={(presetId) => dispatch({ type: "setPreset", presetId })}
          onSync={loadWorkflows}
          syncing={loadingWf}
        />


        <div className="otg-card">
          <div className="otg-cardTitle">Prompts</div>

          <div className="otg-label">Positive</div>
          <textarea
            className="otg-textarea"
            placeholder="Describe what you want..."
            value={state.prompt}
            onChange={(e) => dispatch({ type: "setPrompt", prompt: e.target.value })}
          />

          <EnhancePanel
            level={state.enhanceLevel}
            onChangeLevel={(v) => dispatch({ type: "setEnhanceLevel", enhanceLevel: v })}
            onEnhance={onEnhance}
            disabled={sending}
            busy={sending}
          />


          <div className="otg-label" style={{ marginTop: 10 }}>
            Negative (optional)
          </div>
          <textarea
            className="otg-textarea"
            placeholder="Things you don't want..."
            value={state.negative}
            onChange={(e) => dispatch({ type: "setNegative", negative: e.target.value })}
          />
        </div>

        <VideoProfilePicker
          ratio={state.ratio}
          size={state.size}
          onChangeRatio={(ratio) => dispatch({ type: "setRatio", ratio })}
          onChangeSize={(size) => dispatch({ type: "setSize", size })}
        />

        <DurationPicker
          value={state.seconds}
          onChange={(seconds) => dispatch({ type: "setSeconds", seconds })}
        />

        <div className="otg-card">
          <div className="otg-row otg-between otg-center">
            <div>
              <div className="otg-cardTitle">Generate</div>
              <div className="otg-muted">
                Workflow: <span className="otg-mono">{state.presetId}</span>
              </div>
            </div>
            <button className="otg-btn otg-btnPrimary" onClick={onGenerate} disabled={sending}>
              {sending ? "Sending..." : "Generate"}
            </button>
          </div>

          {msg ? <div className="otg-muted" style={{ marginTop: 10 }}>{msg}</div> : null}
        </div>
      </div>
    </div>
  );
}

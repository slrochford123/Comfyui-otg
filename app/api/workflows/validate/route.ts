import { NextResponse } from "next/server";
import { getWorkflowList, loadWorkflowById, extractPromptGraph, validatePromptGraph } from "@/lib/workflows";

export const runtime = "nodejs";

export async function GET() {
  const lst = getWorkflowList();
  if (!lst.ok) return NextResponse.json({ error: lst.error }, { status: 500 });

  const report = lst.list.map((w) => {
    if (!w.exists) return { id: w.id, ok: false, stage: "exists", error: w.error ?? "missing file" };
    if (!w.parseOk) return { id: w.id, ok: false, stage: "parse", error: w.error ?? "parse error" };

    const wf = loadWorkflowById(w.id);
    if (!wf.ok) return { id: w.id, ok: false, stage: "load", error: wf.error };

    const extracted = extractPromptGraph(wf.json);
    if (!extracted.ok) return { id: w.id, ok: false, stage: "convert", error: extracted.error, format: extracted.format };

    const valid = validatePromptGraph(extracted.graph);
    if (!valid.ok) return { id: w.id, ok: false, stage: "validate", error: valid.error };

    return { id: w.id, ok: true, format: w.format, sha256: w.sha256 ?? null };
  });

  const okCount = report.filter((r) => r.ok).length;
  return NextResponse.json({ ok: okCount === report.length, okCount, total: report.length, report });
}

import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const COMFY_BASE_URL = (process.env.COMFY_BASE_URL || process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");

function parseLooseJsonBlocks(text: string): any[] {
  const out: any[] = [];
  if (!text) return out;

  // Fast path: true JSONL (one object per line)
  const lines = text.split(/\r?\n/).filter(Boolean);
  let jsonlOk = 0;
  for (const line of lines.slice(-400)) {
    const t = line.trim();
    if (!t.startsWith("{") || !t.endsWith("}")) continue;
    try {
      out.push(JSON.parse(t));
      jsonlOk++;
    } catch {
      // ignore
    }
  }
  if (jsonlOk > 0) return out;

  // Slow path: scan for balanced JSON object blocks (tolerates pretty JSON blocks)
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const block = text.slice(start, i + 1);
        start = -1;
        try {
          out.push(JSON.parse(block));
        } catch {
          // ignore
        }
      }
    }
  }
  return out;
}

async function enrichStatus(items: any[], limit: number) {
  const slice = items.slice(0, limit);
  const tasks = slice.map(async (it) => {
    const pid = String(it?.prompt_id || it?.rawResponse?.prompt_id || "").trim();
    if (!pid) return it;
    try {
      const r = await fetch(`${COMFY_BASE_URL}/history/${encodeURIComponent(pid)}`, { cache: "no-store" });
      const hj = await r.json().catch(() => ({}));
      const entry = (hj as any)?.[pid];
      const outputs = entry?.outputs;
      const hasOutputs = outputs && typeof outputs === "object" && Object.keys(outputs).length > 0;
      const statusStr = String(entry?.status?.status_str || "");
      const isError = statusStr.toLowerCase().includes("error");
      return {
        ...it,
        status: isError ? "error" : (hasOutputs ? "complete" : "running"),
        prompt_error: isError ? statusStr : null,
      };
    } catch {
      return it;
    }
  });

  const enriched = await Promise.all(tasks);
  return [...enriched, ...items.slice(limit)];
}

export async function GET(req: NextRequest) {
  try {
    const ownerCtx = await getOwnerContext(req);
    const ownerKey = ownerCtx.ownerKey;

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50) || 50));
    const withStatus = url.searchParams.get("withStatus") === "1";

    if (!fs.existsSync(JOBS_DIR)) {
      return Response.json({ ok: true, ownerKey, items: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith(".jsonl"));

    const all: any[] = [];
    for (const f of files) {
      try {
        const p = path.join(JOBS_DIR, f);
        const raw = fs.readFileSync(p, "utf-8");
        const blocks = parseLooseJsonBlocks(raw);
        for (const b of blocks) {
          if (!b) continue;
          if (String(b.ownerKey || "").trim() !== ownerKey) continue;
          all.push(b);
        }
      } catch {
        // ignore per-file
      }
    }

    const items = all
      .map((x) => {
        const pid = String(x?.prompt_id || x?.rawResponse?.prompt_id || "").trim() || null;
        return {
          ts: Number(x?.ts ?? x?.at ?? 0) || 0,
          ownerKey: x?.ownerKey ?? ownerKey,
          deviceId: x?.deviceId ?? null,
          title: x?.title ?? null,
          preset: x?.preset ?? null,
          prompts: Array.isArray(x?.prompts) ? x.prompts : null,
          positivePrompt: x?.positivePrompt ?? null,
          negativePrompt: x?.negativePrompt ?? null,
          seed: x?.seed ?? null,
          loras: x?.loras ?? null,
          imagePath: x?.imagePath ?? null,
          useImg2Img: x?.useImg2Img ?? null,
          prompt_id: pid,
          submitPayload: x?.submitPayload ?? null,
          status: x?.status ?? "submitted",
          prompt_error: x?.prompt_error ?? null,
        };
      })
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
      .slice(0, limit);

    const finalItems = withStatus ? await enrichStatus(items, Math.min(15, items.length)) : items;

    return Response.json({ ok: true, ownerKey, items: finalItems }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

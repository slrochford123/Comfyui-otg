"use client";

import React from "react";
import { cn } from "@/lib/cn";
import EditVideoEditAnythingPanel from "./EditVideoEditAnythingPanel";
import type {LtxStudioRuntimeTool} from "@/lib/ltxStudiosRuntime";

type Entry = { id: string; name: string; category: string; workflowKind: string; description: string; recommendedStrength: number; compatibility: string[]; status: string; installed: boolean; runtimeReady: boolean; executable?:boolean;statusReason?:string;notes: string[] };

export default function LtxStudiosPanel() {
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("Loading LTX 2.5 capability catalog...");

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/ltx-studios/catalog", { cache: "no-store" }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (cancelled) return;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Catalog unavailable.");
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setStatus("Catalog loaded. Runtime use is gated until each asset and workflow is verified.");
    }).catch((error) => { if (!cancelled) setStatus(error?.message || "Catalog unavailable."); });
    return () => { cancelled = true; };
  }, []);

  const categories = ["all", ...Array.from(new Set(entries.map((entry) => entry.category)))];
  const visible = entries.filter((entry) => {
    const haystack = `${entry.name} ${entry.description} ${entry.category}`.toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (category === "all" || entry.category === category);
  });

  return <div className="space-y-5">
    <section className="rounded-[28px] border border-cyan-300/20 bg-cyan-400/[0.06] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-200/75">Additive LTX 2.5 workspace</p><h2 className="mt-2 text-3xl font-black text-white">LTX Studios</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">Explore the requested LoRA set for video modification. The existing Edit Video LTX 2.3 workflow remains unchanged.</p></div>
        <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">3090 primary · TEST</span>
      </div>
      <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/65">{status}</p>
    </section>
    <section className="rounded-[28px] border border-white/10 bg-black/35 p-4">
      <div className="flex flex-col gap-3 md:flex-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search LoRAs..." className="min-h-11 flex-1 rounded-full border border-white/10 bg-black/35 px-4 text-sm text-white outline-none focus:border-cyan-300/40" /><select value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-11 rounded-full border border-white/10 bg-black/35 px-4 text-sm text-white outline-none">{categories.map((item) => <option key={item} value={item}>{item === "all" ? "All categories" : item}</option>)}</select></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((entry) => <button key={entry.id} type="button" onClick={() => setSelected(entry.id)} className={cn("text-left rounded-2xl border p-4 transition", selected === entry.id ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]")}><div className="flex items-start justify-between gap-3"><h3 className="font-black text-white">{entry.name}</h3><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-bold uppercase text-white/55">{entry.workflowKind}</span></div><p className="mt-2 text-sm leading-5 text-white/60">{entry.description}</p><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/55"><span>{entry.category}</span><span>·</span><span>Strength {entry.recommendedStrength}</span><span className={entry.runtimeReady ? "text-emerald-200" : "text-amber-200"}>{entry.statusReason||"Workflow unavailable"}</span></div></button>)}</div>
      {selected&&entries.find(entry=>entry.id===selected)?.executable ? <EditVideoEditAnythingPanel key={selected} studioTool={selected as LtxStudioRuntimeTool} /> : selected ? <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/[0.06] p-4 text-sm text-amber-50/80"><p className="font-bold">{entries.find((entry) => entry.id === selected)?.name}</p><p className="mt-1">The required official model or workflow is not available on this worker. Publisher approval may be required. No generation action is offered.</p></div> : null}
    </section>
  </div>;
}

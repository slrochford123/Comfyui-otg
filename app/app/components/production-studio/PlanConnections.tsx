"use client";
import { useState } from "react";
import type { useStudio } from "./useStudio";
import type { StoryProductionPlan } from "@/lib/storyCreator/productionPlan";
import { previewFromPlan } from "@/lib/productionStudio/storyPreview";
import StoryPreview from "./StoryPreview";
import { Button, Field, Section, inputClass } from "./Controls";
type Revision = { revision: number; updatedAt: string; summary: string; plan?: StoryProductionPlan };
export default function PlanConnections({ s, run }: { s: ReturnType<typeof useStudio>; run: (f: () => Promise<unknown>) => void }) {
  const [panel, setPanel] = useState<"story" | "history" | null>(null), [stories, setStories] = useState<Array<{id:string;title:string}>>([]),
    [story, setStory] = useState(""), [rows, setRows] = useState<Revision[]>([]), [selected, setSelected] = useState<Revision | null>(null);
  const p = s.project!, preview = selected?.plan ? previewFromPlan(selected.plan) : undefined;
  return <div className="space-y-3"><div className="flex flex-wrap gap-2">
    <Button aria-expanded={panel === "story"} onClick={() => run(async () => { setPanel(panel === "story" ? null : "story"); const data = await s.request(s.url + "/catalog"); setStories(data.stories); })}>+ Connect Story Creator</Button>
    <Button aria-expanded={panel === "history"} onClick={() => run(async () => { setPanel(panel === "history" ? null : "history"); const data = await s.request(s.url + "?revisions=1"); setRows(data.revisions); setSelected(null); })}>History / Recovery</Button>
  </div>
  {panel === "story" && <Section title="Connect Story Creator"><Button onClick={() => setPanel(null)}>Close Story Creator</Button>
    <Field label="Choose an existing Story Creator story"><select className={inputClass} value={story} onChange={e => setStory(e.target.value)}><option value="">Choose a story</option>{stories.map(st => <option key={st.id} value={st.id}>{st.title}</option>)}</select></Field>
    <Button disabled={!story || !s.saved} onClick={() => { if (confirm("Import this story as a draft? Your current plan remains recoverable in History. No media will be generated.")) run(async () => { await s.request(s.url + "/catalog", {method:"POST",body:JSON.stringify({kind:"story",sourceId:story,revision:p.revision})}); await s.refresh(); setPanel(null); }); }}>Import and Review Story</Button>
    <Button disabled={!s.saved || p.plan.status !== "approved"} onClick={() => { if (confirm("Save this approved plan as a new Story Creator version? Existing versions will remain recoverable.")) run(async () => { await s.request(s.url + "/catalog", {method:"POST",body:JSON.stringify({kind:"publish-story",expectedVersion:p.storyPlanVersion,revision:p.revision})}); await s.refresh(); }); }}>Save Approved Plan to Story Creator</Button>
    <p className="text-xs text-white/60">Only approved plans can be shared. A changed linked story cannot be overwritten without review.</p>
  </Section>}
  {panel === "history" && <Section title="Plan History / Recovery"><Button onClick={() => setPanel(null)}>Close History</Button>
    <p className="text-sm text-white/60">Preview an earlier saved version. Restoring Plan does not roll back your cast, media or editing timeline.</p>
    <div className="max-h-72 overflow-y-auto space-y-2">{rows.length === 0 && <p>No previous saved revisions yet.</p>}{rows.map(r => <div key={r.revision} className="rounded-xl border border-white/10 p-3 space-y-2"><p>Revision {r.revision} · {new Date(r.updatedAt).toLocaleString()}</p><p className="text-sm text-white/60">{r.summary}</p><Button onClick={() => run(async () => setSelected(await s.request(s.url + "?previewRevision=" + r.revision)))}>Preview revision {r.revision}</Button></div>)}</div>
    {selected && <div className="space-y-3"><h3 className="font-semibold">Preview · revision {selected.revision}</h3>{preview ? <StoryPreview story={preview} /> : <p>No readable story had been written in this revision.</p>}<Button disabled={!s.saved} onClick={() => { if(confirm("Restore this Plan as a draft for review? Your current version remains in History.")) run(async () => { await s.commit({type:"story.restore",revision:selected.revision}); setPanel(null); }); }}>Restore This Plan</Button></div>}
  </Section>}
  </div>;
}

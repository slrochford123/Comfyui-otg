"use client";

import { useMemo, useState } from "react";
import { ConflictReviewPanel, type StoryConflictAction } from "./ConflictReviewPanel";

type StoryBibleEntity = { id: string; entityType: string; name: string; sourceRole: "user" | "assistant" | "system" };
type StoryBibleFactStatus = "canon" | "suggestion" | "unknown";
type StoryBibleFact = { id: string; subjectEntityId: string | null; predicate: string; valueText: string; objectEntityId: string | null; canonStatus: StoryBibleFactStatus; sourceRole: "user" | "assistant" | "system" };
type StoryConflict = { id: string; factId: string; conflictsWithFactId: string; summary: string; status: "open" | "resolved" | "dismissed"; sourceRole: "user" | "assistant" | "system" };

type Props = {
  storyBibleEntities: StoryBibleEntity[];
  storyBibleFacts: StoryBibleFact[];
  storyBibleEntityNames: Map<string, string>;
  storyBibleLoading: boolean;
  storyBibleError: string;
  storyConflicts: StoryConflict[];
  storyConflictsLoading: boolean;
  storyConflictsBusy: boolean;
  storyConflictBusyId: string;
  storyConflictsError: string;
  onBack: () => void;
  onCheckConflicts: () => void;
  onUpdateFact: (factId: string, valueText: string) => void;
  onDeleteFact: (factId: string) => void;
  onResolveConflict: (conflictId: string, action: StoryConflictAction, valueText?: string) => void;
};

const categories = ["Characters", "Appearance", "Personality", "Powers and abilities", "Relationships", "Locations", "Objects and weapons", "Organizations and factions", "World rules", "Timeline", "Important events", "Other story details"] as const;

function categoryFor(fact: StoryBibleFact, entity?: StoryBibleEntity) {
  const predicate = fact.predicate.toLowerCase();
  const entityType = entity?.entityType.toLowerCase() || "";
  if (/appearance|age|gender|hair|eye|skin|face|body|build|costume|clothing|wardrobe|color/.test(predicate)) return "Appearance";
  if (/personality|temperament|trait|fear|motivation|behavior/.test(predicate)) return "Personality";
  if (/power|ability|skill|strength|speed|weakness/.test(predicate)) return "Powers and abilities";
  if (/relationship|friend|enemy|parent|sibling|loves|member_of/.test(predicate)) return "Relationships";
  if (/location|environment|place|setting/.test(entityType) || /location|lives|located|home/.test(predicate)) return "Locations";
  if (/object|weapon|vehicle|prop|item/.test(entityType) || /weapon|object|owns|carries|uses/.test(predicate)) return "Objects and weapons";
  if (/organization|faction|team|group/.test(entityType) || /organization|faction|team/.test(predicate)) return "Organizations and factions";
  if (/rule|law|magic|physics|world/.test(predicate)) return "World rules";
  if (/timeline|date|year|before|after|age_at/.test(predicate)) return "Timeline";
  if (/event|happened|death|battle|discovery|incident/.test(predicate)) return "Important events";
  if (/character|person|hero|villain/.test(entityType)) return "Characters";
  return "Other story details";
}

export function BibleTab(props: Props) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editValue, setEditValue] = useState("");
  const canon = props.storyBibleFacts.filter((fact) => fact.canonStatus === "canon");
  const legacy = props.storyBibleFacts.filter((fact) => fact.canonStatus === "suggestion");
  const grouped = useMemo(() => {
    const entities = new Map(props.storyBibleEntities.map((entity) => [entity.id, entity]));
    const value = query.trim().toLowerCase();
    return categories.map((category) => [category, canon.filter((fact) => {
      const entity = fact.subjectEntityId ? entities.get(fact.subjectEntityId) : undefined;
      const haystack = `${entity?.name || "Story"} ${fact.predicate} ${fact.valueText}`.toLowerCase();
      return categoryFor(fact, entity) === category && (!value || haystack.includes(value));
    })] as const).filter(([, facts]) => facts.length);
  }, [canon, props.storyBibleEntities, query]);

  return (
    <div className="min-w-0 space-y-4">
      <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-cyan-300/20 bg-[#090d18]/95 p-3 shadow-xl backdrop-blur">
        <button type="button" onClick={props.onBack} className="min-h-11 rounded-[12px] bg-cyan-300 px-4 py-2 text-sm font-black text-black">← Back to Story Director</button>
        <span className="text-xs text-white/45">{canon.length} saved details · {props.storyConflicts.length} conflicts</span>
      </div>

      <section className="rounded-[20px] border border-white/10 bg-black/35 p-5">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/60">Story Memory</p>
        <h2 className="mt-2 text-xl font-black text-white">Canon Library</h2>
        <p className="mt-2 text-sm leading-6 text-white/55">Search and correct the established details for this story. Only genuine contradictions need a separate decision.</p>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search story details" className="mt-4 min-h-11 w-full rounded-[12px] border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-cyan-300/45" />

        {props.storyBibleError ? <div className="mt-3 rounded-[12px] border border-red-400/20 bg-red-500/10 p-3 text-xs text-red-100">{props.storyBibleError}</div> : null}
        {props.storyBibleLoading ? <p className="mt-4 text-sm text-white/45">Loading story details...</p> : null}
        {!props.storyBibleLoading && !grouped.length ? <p className="mt-4 rounded-[12px] border border-dashed border-white/10 p-4 text-sm text-white/45">No matching canon details yet.</p> : null}

        <div className="mt-4 space-y-4">
          {grouped.map(([category, facts]) => (
            <details key={category} open className="rounded-[16px] border border-white/10 bg-white/[0.025] p-3">
              <summary className="cursor-pointer font-black text-white">{category} <span className="ml-2 text-xs text-white/35">{facts.length}</span></summary>
              <div className="mt-3 space-y-2">
                {facts.map((fact) => {
                  const subject = fact.subjectEntityId ? props.storyBibleEntityNames.get(fact.subjectEntityId) || "Story" : "Story";
                  const editing = editingId === fact.id;
                  return <article key={fact.id} className="rounded-[12px] border border-white/10 bg-black/25 p-3">
                    <div className="text-xs font-black text-cyan-100/70">{subject} · {fact.predicate.replace(/_/g, " ")}</div>
                    {editing ? <textarea value={editValue} onChange={(event) => setEditValue(event.target.value)} rows={3} className="mt-2 w-full rounded-[10px] border border-white/10 bg-black/40 p-2 text-sm text-white" /> : <p className="mt-1 break-words text-sm leading-6 text-white/78">{fact.valueText}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {editing ? <>
                        <button type="button" disabled={!editValue.trim()} onClick={() => { props.onUpdateFact(fact.id, editValue); setEditingId(""); }} className="rounded-[10px] bg-cyan-300 px-3 py-2 text-xs font-black text-black disabled:opacity-40">Save</button>
                        <button type="button" onClick={() => setEditingId("")} className="rounded-[10px] border border-white/10 px-3 py-2 text-xs font-black text-white/65">Cancel</button>
                      </> : <>
                        <button type="button" onClick={() => { setEditingId(fact.id); setEditValue(fact.valueText); }} className="rounded-[10px] border border-white/10 px-3 py-2 text-xs font-black text-white/70">Edit</button>
                        <button type="button" onClick={() => { if (window.confirm("Delete this story detail?")) props.onDeleteFact(fact.id); }} className="rounded-[10px] border border-red-300/20 px-3 py-2 text-xs font-black text-red-100/75">Delete</button>
                      </>}
                      <span className="ml-auto self-center text-[10px] uppercase tracking-[0.1em] text-white/28">Source: {fact.sourceRole}</span>
                    </div>
                  </article>;
                })}
              </div>
            </details>
          ))}
        </div>

        {legacy.length ? <details className="mt-4 rounded-[14px] border border-white/10 p-3 text-sm text-white/55">
          <summary className="cursor-pointer font-black">Legacy proposed details ({legacy.length})</summary>
          <p className="mt-2 text-xs leading-5 text-white/40">These older proposals were preserved during migration. They are not automatically accepted or restored.</p>
        </details> : null}
      </section>

      <ConflictReviewPanel conflicts={props.storyConflicts} facts={props.storyBibleFacts} entityNames={props.storyBibleEntityNames} loading={props.storyConflictsLoading} busy={props.storyConflictsBusy} busyConflictId={props.storyConflictBusyId} error={props.storyConflictsError} onCheckConflicts={props.onCheckConflicts} onResolveConflict={props.onResolveConflict} />
    </div>
  );
}

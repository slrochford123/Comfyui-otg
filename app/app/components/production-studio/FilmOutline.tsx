"use client";
import { useState } from "react";
import type {useStudio} from "./useStudio";
import {filmRuntime} from "@/lib/productionStudio/filmStructure";
import {Button,Field,Section,inputClass} from "./Controls";
type S=ReturnType<typeof useStudio>;
export default function FilmOutline({s,run,busy}:{s:S;run:(f:()=>Promise<unknown>)=>void;busy:boolean}){
  const p=s.project!,pending=[...p.assistant].reverse().find(m=>m.outlineSuggestion&&!m.decision),outline=pending?.outlineSuggestion||p.film?.outline;
  const [direction,setDirection]=useState("");
  const ask=(mode:string,sceneId?:string)=>{if(confirm("Ask the filmmaker to plan this section using your AI allowance? Existing plans stay unchanged until accepted."))run(()=>s.job({kind:"assistant",planMode:true,planningScope:{mode,sceneId},message:direction.trim()|| (mode==="outline"?`Recommend runtime, acts and working segments for: ${p.brief.description}`:sceneId?"Develop distinct camera coverage for this scene. Preserve its approved events and timing.":"Develop only the selected working segment into timed story beats, scenes and distinct camera shots. Use approved continuity from earlier segments.")}));};
  return <Section title="Film structure & runtime">
    <p className="text-sm text-white/70">Start with a story or outline. Acts are optional; working segments let you develop a long film a section at a time.</p>
    <Field label="Planning direction · optional"><input className={inputClass} value={direction} onChange={e=>setDirection(e.target.value)} placeholder="A half-hour episode; develop Act One first…"/></Field>
    <Button disabled={!s.saved||busy||!p.brief.description.trim()} onClick={()=>ask("outline")}>Suggest Runtime & Outline</Button>
    {outline&&<>
      <p>{outline.rationale}</p><p className="text-sm">About {Math.round(outline.acts.flatMap(a=>a.segments).reduce((n,s)=>n+s.estimatedSeconds,0))} seconds · {outline.acts.length>1?`${outline.acts.length} acts · `:""}{outline.acts.flatMap(a=>a.segments).length} working segments. Estimates, not limits.</p>
      {!p.brief.durationOptional&&outline.acts.flatMap(a=>a.segments).reduce((n,s)=>n+s.estimatedSeconds,0)!==p.brief.targetSeconds&&<p className="text-amber-200">This estimate differs from your requested {p.brief.targetSeconds}s. Discuss pacing or approve the different outline explicitly; the target has not been changed.</p>}
      {pending?<><p>Proposed outline — your developed scenes are unchanged.</p><Button disabled={!s.saved||busy} onClick={()=>run(()=>s.commit({type:"film.outline.accept",messageId:pending.id}))}>Approve Outline</Button><Button disabled={!s.saved||busy} onClick={()=>run(()=>s.commit({type:"story.reject",messageId:pending.id}))}>Keep Current Structure</Button></>:<>
        <Field label="Current working segment"><select className={inputClass} value={p.film?.activeSegmentId||""} onChange={e=>run(()=>s.commit({type:"film.segment.select",segmentId:e.target.value}))}><option value="" disabled>Choose a section to develop</option>{outline.acts.map(a=><optgroup label={a.title} key={a.id}>{a.segments.map(segment=><option key={segment.id} value={segment.id}>{segment.title} · {p.film?.segments[segment.id]?.approved?"approved":p.film?.segments[segment.id]?"draft":`${segment.estimatedSeconds}s estimate`}</option>)}</optgroup>)}</select></Field>
        <Button disabled={!s.saved||busy||!p.film?.activeSegmentId} onClick={()=>ask("segment")}>Develop Current Segment</Button>
        <p className="text-xs">Current combined estimate: {Math.round(filmRuntime(p))}s. Other sections and their approved media are preserved.</p>
      </>}
      <details><summary>Complete outline & open questions</summary>{outline.acts.map(a=><div key={a.id} className="py-2"><h4>{a.title}</h4><p className="text-sm">{a.summary}</p>{a.segments.map(segment=><p key={segment.id} className="text-sm py-1">{segment.title} · {segment.estimatedSeconds}s — {segment.summary}</p>)}</div>)}{outline.unresolvedQuestions.map((q,i)=><p key={i}>Unresolved: {q}</p>)}</details>
    </>}
    {p.plan.storyPreview?.segments.length? <details><summary>Refine one scene’s camera coverage</summary><p className="text-xs py-2">Works on one scene without rewriting the rest of the film. Review the proposal before accepting it.</p>{[...new Set(p.plan.storyPreview.segments.map(b=>b.sceneId))].map(id=><Button key={id} disabled={!s.saved||busy} onClick={()=>ask("scene",id)}>{p.plan.storyPreview!.segments.find(b=>b.sceneId===id)?.title}</Button>)}</details>:null}
  </Section>;
}

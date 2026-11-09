"use client";
import { useEffect, useState } from "react";
import { newClientRequestId } from "@/lib/client/requestId";
import { emptySegment, previewFromPlan, storyDuration, type StorySegment } from "@/lib/productionStudio/storyPreview";
import type { useStudio } from "./useStudio";
import { useStoredDraft } from "./useStoredDraft";
import { Button, Field, Section, inputClass } from "./Controls";
import StoryPreview from "./StoryPreview";
import StorySceneEditor from "./StorySceneEditor";
import PlanConnections from "./PlanConnections";
import Dictation from "./Dictation";
import FilmOutline from "./FilmOutline";
import {useTalkback,PlaybackControls,AssistantSpeech} from "./Talkback";
type S = ReturnType<typeof useStudio>;
export default function Plan({ s, run, onContinue }: { s: S; run: (f: () => Promise<unknown>) => void; onContinue?: () => void }) {
  const p = s.project!, current = previewFromPlan(p.plan);
  const pending = [...p.assistant].reverse().find(m => m.storySuggestion && !m.decision);
  const visible = pending?.storySuggestion || current;
  const narration=useTalkback();
  const [confirmation,setConfirmation]=useState("");
  const [question, setQuestion] = useStoredDraft(s.scopeKey + ":filmmaker-question", ""),
    [editing, setEditing] = useStoredDraft<StorySegment | null>(s.scopeKey + ":editing-scene", null),
    [manualIndex, setManualIndex] = useStoredDraft(s.scopeKey + ":manual-index", 0), [sending, setSending] = useState(false);
  const activeJob = s.jobs.find(j => j.kind === "assistant" && ["queued","running","canceling"].includes(j.status));
  const latestJob = s.jobs.find(j => j.kind === "assistant");
  const busy = sending || !!activeJob;
  const activeJobId = activeJob?.id;
  const refresh = s.refresh;
  useEffect(() => { if (!activeJobId) return; const poll = setInterval(() => void refresh().catch(() => {}), 1200); return () => clearInterval(poll); }, [activeJobId, refresh]);
  const ask = async (message: string, initial = false) => {
    if (!confirm("Create a story proposal using your AI allowance? Your saved story stays unchanged until you accept it.")) return;
    setSending(true); s.setError("");
    try {
      if (p.planningMode !== "ai") await s.commit({type:"story.mode",mode:"ai"});
      const outline=initial&&!p.film?.activeSegmentId&&((!p.brief.durationOptional&&p.brief.targetSeconds>600)||/feature[- ](?:length|film)|half[- ]hour|two[- ]hour|30[- ]minute|two.hour movie/i.test(message));
      await s.job({kind:"assistant",planMode:true,message,...(outline?{planningScope:{mode:"outline"}}:{}),...(!initial && pending ? {proposalId:pending.id} : {})});
      setQuestion("");
    } catch (e) { s.setError(e instanceof Error ? e.message : "Unable to ask the filmmaker."); }
    finally { setSending(false); }
  };
  const openManual = () => run(async () => {
    await s.commit({type:"story.mode",mode:"manual"});
    // A pending AI proposal is never applied merely by switching modes.
    if (!current?.segments.length && !editing) setEditing(emptySegment(newClientRequestId(), p.brief.targetSeconds, p.brief.clipName || ""));
  });
  const startNew = () => setEditing(emptySegment(newClientRequestId(), Math.max(1, p.brief.targetSeconds - (current ? storyDuration(current) : 0))));
  const activeSegment = current?.segments[Math.min(manualIndex, (current?.segments.length || 1) - 1)];
  return <div className="space-y-4">
    <Section title="Set the Stage">
      <Field label="Scene / Clip Name"><input className={inputClass} value={p.brief.clipName || ""} onChange={e => s.change({type:"brief",patch:{clipName:e.target.value}})} /></Field>
      <Field label="Story idea"><textarea className={inputClass} rows={4} value={p.brief.description} placeholder="A quiet coffee shop becomes an unexpected adventure…" onChange={e => s.change({type:"brief",patch:{description:e.target.value}})} /></Field>
      <Dictation url={s.url} scope={s.scopeKey+":story-idea"} disabled={busy} onStart={narration.stop} onAdd={text=>s.change({type:"brief",patch:{description:[p.brief.description,text].filter(Boolean).join("\n")}})}/>
      <div className="grid grid-cols-2 gap-3"><Field label="Aspect ratio"><select className={inputClass} value={p.brief.aspect} onChange={e => s.change({type:"brief",patch:{aspect:e.target.value}})}>{["landscape","portrait","square"].map(v => <option key={v}>{v}</option>)}</select></Field>
        <Field label="Target duration · optional seconds"><input className={inputClass} type="number" min={1} value={p.brief.durationOptional ? "" : p.brief.targetSeconds} placeholder="Let the filmmaker estimate" onChange={e => { s.change({type:"brief",patch:e.target.value ? {targetSeconds:Number(e.target.value),durationOptional:false} : {durationOptional:true}}); }} /></Field>
        <Field label="Visual style"><input className={inputClass} value={p.brief.style} onChange={e => s.change({type:"brief",patch:{style:e.target.value}})} /></Field>
        <Field label="Atmosphere"><input className={inputClass} value={p.brief.atmosphere} onChange={e => s.change({type:"brief",patch:{atmosphere:e.target.value}})} /></Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2"><Button disabled={!p.brief.description.trim() || !s.saved || busy || !!editing} onClick={() => void ask(p.brief.description, true)}>Chat with AI</Button><Button disabled={!s.saved || busy} onClick={openManual}>Manual Story Plan</Button></div>
    </Section>
    {(p.planningMode||visible)&&<FilmOutline s={s} run={run} busy={busy}/>}
    {p.planningReview && <p className="rounded-xl border border-amber-400/30 p-3 text-sm text-amber-200">{p.planningReview}</p>}
    {busy && <div role="status" className="rounded-xl border border-purple-400/30 p-4"><p>The filmmaker is developing your timed story and production details…</p>{activeJob?.message && <p className="text-sm" aria-live="polite">{activeJob.status === "canceling" ? "Canceling planning…" : activeJob.message}</p>}<p className="text-sm text-white/60">You can leave and return; the planning job is saved.</p>{activeJob && <Button disabled={activeJob.status === "canceling"} onClick={() => run(async () => { await s.request(s.url + "/jobs", {method:"PATCH",body:JSON.stringify({jobId:activeJob.id})}); await s.refresh(); })}>Cancel Planning</Button>}</div>}
    {latestJob && ["failed","attention"].includes(latestJob.status) && !busy && <div role="alert" className="rounded-xl border border-amber-400/30 p-3"><p>{latestJob.message}</p><p className="text-sm">Your saved story is unchanged. Revise your request and ask again, or choose Manual Story Plan.</p></div>}
    {editing ? <StorySceneEditor key={editing.id} scope={s.scopeKey} segment={editing} saving={!s.saved || busy} onClose={() => setEditing(null)} onReviewLatest={async () => { const data = await s.request(s.url); const latest = previewFromPlan(data.project.plan)?.segments.find(b => b.id === editing.id); if (!latest) throw new Error("This scene was removed. Its draft is still kept on this device."); return latest; }} onSave={(segment,baseSegment) => s.commit({type:"story.segment.save",segment,baseSegment,reviewed:true})} /> : <>
      {visible && <Section title="Your Story Preview">
        <div className="flex flex-wrap gap-2 items-center"><Button onClick={()=>void narration.play()}>🔊 Listen to Full Story</Button><PlaybackControls/></div>
        {narration.error&&<p role="alert" className="text-amber-200 text-sm">{narration.error}</p>}
        <p className="text-sm text-white/60">Version {visible.version} · {storyDuration(visible)} / {visible.targetSeconds} seconds{pending ? " · not applied to your saved story" : ""}</p>
        {pending && <><p className="whitespace-pre-wrap">{pending.text}</p><AssistantSpeech id={pending.id}/><ul className="list-disc pl-5 text-sm text-white/70">{pending.changes?.map((c,i) => <li key={i}>{c}</li>)}</ul></>}
        <StoryPreview story={visible} onEdit={!pending ? segment => setEditing(segment) : undefined} onListen={id=>void narration.play(id)} narratedId={narration.activeId}/>
        {pending && <div className="flex flex-wrap gap-2"><Button disabled={!s.saved || busy} onClick={() => run(() => s.commit({type:"story.accept",messageId:pending.id}))}>Accept Proposed Revisions</Button><Button disabled={!s.saved || busy} onClick={() => run(() => s.commit({type:"story.reject",messageId:pending.id}))}>Keep Current Story</Button></div>}
        {!pending && !p.brief.durationOptional && !p.film?.activeSegmentId && storyDuration(visible) !== p.brief.targetSeconds && <p role="alert" className="text-amber-300">Your scenes total {storyDuration(visible)} seconds; the target is {p.brief.targetSeconds}. Adjust scene durations, add a scene, or ask the filmmaker to retime the story.</p>}
      </Section>}
      {p.planningMode === "manual" && <Section title="Manual Story Plan">
        {activeSegment && <><p>Scene {manualIndex + 1} · {activeSegment.title}</p><Button onClick={() => setEditing(activeSegment)}>Edit Selected Scene</Button></>}
        <div className="flex flex-wrap gap-2">{manualIndex > 0 && <Button onClick={() => setManualIndex(i => i - 1)}>Previous Scene</Button>}{current && manualIndex < current.segments.length - 1 && <Button onClick={() => setManualIndex(i => i + 1)}>Next Scene</Button>}<Button disabled={!s.saved} onClick={startNew}>Add New Scene</Button></div>
      </Section>}
      {visible&&<div className="space-y-2"><div className="grid gap-2 sm:grid-cols-2"><Button disabled={!s.saved||busy} onClick={()=>run(async()=>{await s.commit({type:"story.save",messageId:pending?.id});setConfirmation("Story saved as a recoverable version. You are still in Plan; no assets were generated.");})}>Save Story</Button><Button disabled={!s.saved||busy} onClick={()=>{if(confirm("Confirm this story version for creation? The filmmaker will analyze its required assets using your AI allowance. No images, voices, RefMods or videos will be generated."))run(async()=>{await s.commit({type:"story.continue",messageId:pending?.id});await s.job({kind:"asset-analysis"});narration.stop();onContinue?.();});}}>Continue to Cast &amp; World</Button></div>{confirmation&&<p role="status" className="text-sm text-emerald-200">{confirmation}</p>}</div>}
    </>}
    {(p.planningMode || visible || p.assistant.length > 0) && <Section title="Your Filmmaker">
      {p.assistant.length > 0 && <details><summary className="cursor-pointer">Conversation history</summary><div className="max-h-80 overflow-y-auto space-y-3 pt-3">{p.assistant.map(m => <article key={m.id} className="rounded-xl bg-white/5 p-3"><p className="text-xs text-white/50">{m.role === "user" ? "You" : "Filmmaker"}{m.decision ? ` · ${m.decision}` : ""}</p><p className="whitespace-pre-wrap text-sm">{m.text}</p>{m.role==="assistant"&&<AssistantSpeech id={m.id}/>}{m.suggestion && <LegacySuggestion plan={m.suggestion} disabled={!s.saved || busy || !!editing} apply={() => run(() => s.commit({type:"plan.replace",plan:m.suggestion}))} />}</article>)}</div></details>}
      <Field label="Tell your filmmaker what to change"><textarea className={inputClass} rows={3} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Make the robbery happen earlier, change the ending, or make this a nighttime scene…" /></Field>
      <Dictation url={s.url} scope={s.scopeKey+":plan"} disabled={busy||!!editing} onStart={narration.stop} onAdd={text=>setQuestion(previous=>previous?previous+"\n"+text:text)}/>
      <Button disabled={!question.trim() || !s.saved || busy || !!editing} onClick={() => void ask(question)}>Revise Story with AI</Button>
      {editing && <p className="text-xs text-white/60">Save this scene before asking the filmmaker so your latest edits are included.</p>}
      <p className="text-xs text-white/60">Revisions are proposals until you accept them. Story approval never creates images, voices or video.</p>
    </Section>}
    <PlanConnections s={s} run={run} />
  </div>;
}
function LegacySuggestion({plan, disabled, apply}: {plan: NonNullable<S["project"]>["plan"]; disabled: boolean; apply: () => void}) {
  const story = previewFromPlan(plan);
  if (!story) return null;
  return <details className="mt-2"><summary className="cursor-pointer">Review earlier story suggestion</summary><StoryPreview story={story} /><Button disabled={disabled} onClick={() => {if (confirm("Use this earlier suggestion as a draft? Your current story remains recoverable in History; no media will be generated.")) apply();}}>Use Earlier Suggestion as Draft</Button></details>;
}

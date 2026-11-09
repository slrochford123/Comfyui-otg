"use client";
import { useState } from "react";
import type { StorySegment } from "@/lib/productionStudio/storyPreview";
import { useStoredDraft } from "./useStoredDraft";
import { Button, Field, inputClass, Section } from "./Controls";
import StoryPreview from "./StoryPreview";
export default function StorySceneEditor({ segment, scope, saving, onSave, onClose, onReviewLatest }: {
  segment: StorySegment; scope: string; saving: boolean; onSave: (s: StorySegment, base: StorySegment) => Promise<void>; onClose: () => void; onReviewLatest: () => Promise<StorySegment>;
}) {
  const [draft, setDraft] = useStoredDraft<StorySegment | null>(`${scope}:scene:${segment.id}`, null),
    [reviewed, setReviewed] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [latest, setLatest] = useState<StorySegment | null>(null);
  const value = draft || segment;
  const patch = (p: Partial<StorySegment>) => { setDraft({ ...value, ...p }); setReviewed(false); };
  return <Section title="Scene editor">
    <p className="text-sm text-white/60">One scene at a time. Unsaved typing is kept on this device; Save Scene stores this scene and its details together.</p>
    <Field label="Scene title"><input className={inputClass} value={value.title} onChange={e => patch({ title: e.target.value })} /></Field>
    <Field label="What's Happening in This Scene"><textarea className={inputClass} rows={5} value={value.narrative} onChange={e => patch({ narrative: e.target.value })} /></Field>
    <Field label="Scene duration · seconds"><input className={inputClass} type="number" min={0.1} step={0.1} value={value.durationSeconds} onChange={e => patch({ durationSeconds: Number(e.target.value) })} /></Field>
    <div className="grid gap-3 sm:grid-cols-2">{([['location','Location'],['timeOfDay','Time of day'],['lighting','Lighting'],['emotionalTone','Emotional tone']] as const).map(([key,label]) => <Field key={key} label={label}><input className={inputClass} value={value[key]} onChange={e => patch({ [key]: e.target.value })} /></Field>)}</div>
    <Field label="Characters · one name per line"><textarea className={inputClass} rows={2} value={value.characters.join('\n')} onChange={e => patch({ characters: e.target.value.split('\n') })} /></Field>
    <Field label="Continuity"><textarea className={inputClass} rows={3} value={value.continuity.join('\n')} onChange={e => patch({ continuity: e.target.value.split('\n') })} /></Field>
    <details><summary className="cursor-pointer">More scene details · sound, dialogue & camera</summary><div className="space-y-3 pt-3">
      {([['purpose','Purpose'],['plotline','Plotline'],['music','Music'],['soundEffects','Sound effects'],['ambience','Ambience'],['cameraFraming','Camera framing'],['cameraMovement','Camera movement']] as const).map(([key,label]) => <Field key={key} label={label}><textarea className={inputClass} rows={2} value={value[key]} onChange={e => patch({ [key]: e.target.value })} /></Field>)}
      {value.dialogue.map((d,i) => <fieldset className="rounded-xl border border-white/10 p-3 space-y-2" key={i}><legend>Dialogue {i+1}</legend>
        {(['speaker','line','delivery'] as const).map(key => <Field key={key} label={key === 'line' ? 'Dialogue' : key === 'speaker' ? 'Speaker' : 'Delivery'}><input className={inputClass} value={d[key]} onChange={e => patch({ dialogue: value.dialogue.map((x,n) => n === i ? {...x,[key]:e.target.value} : x) })} /></Field>)}
        <div className="grid grid-cols-2 gap-2">{(['startSeconds','endSeconds'] as const).map(key => <Field key={key} label={key === 'startSeconds' ? 'Starts · seconds' : 'Ends · seconds'}><input className={inputClass} type="number" min={0} step={0.1} value={d[key]} onChange={e => patch({ dialogue: value.dialogue.map((x,n) => n === i ? {...x,[key]:Number(e.target.value)} : x) })} /></Field>)}</div>
        <Button onClick={() => patch({ dialogue: value.dialogue.filter((_,n) => n !== i) })}>Remove dialogue</Button>
      </fieldset>)}
      <Button onClick={() => patch({ dialogue: [...value.dialogue, {speaker:'',line:'',delivery:'',startSeconds:0,endSeconds:Math.min(3,value.durationSeconds)}] })}>Add dialogue</Button>
    </div></details>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked that the story, time of day, lighting, dialogue and continuity agree.</label>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
    {conflict && <Button onClick={() => { void onReviewLatest().then(v => {setLatest(v);setReviewed(false);setConflict(false);}).catch(e => setError(e.message)); }}>Review Latest Saved Scene</Button>}
    {latest && <div className="rounded-xl border border-amber-400/30 p-3 space-y-2"><h4>Latest saved scene · compare with your draft above</h4><StoryPreview story={{schemaVersion:1,version:1,title:latest.title,summary:"",source:"manual",targetSeconds:latest.durationSeconds,segments:[latest]}} /><p className="text-sm">Saving applies your draft over this version. Recheck the details and confirm above before saving.</p></div>}
    <div className="flex flex-wrap gap-2"><Button disabled={saving || conflict || !reviewed || !value.title.trim() || !value.narrative.trim()} onClick={() => { setError(''); void onSave(value,latest || segment).then(() => { setDraft(null); onClose(); }).catch(e => {setError(e.message);setConflict(e.status === 409);}); }}>Save Scene</Button><Button onClick={() => { if (!draft || confirm("Discard only this scene's unsaved changes? The saved story will not change.")) { setDraft(null); onClose(); } }}>{draft ? "Discard Unsaved Scene Changes" : "Back to Story"}</Button></div>
  </Section>;
}

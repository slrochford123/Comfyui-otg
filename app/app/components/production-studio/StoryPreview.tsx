"use client";
import { useId, useState } from "react";
import { timedSegments, storyTime, type StoryPreview as Story, type StorySegment } from "@/lib/productionStudio/storyPreview";
import { Button } from "./Controls";
export default function StoryPreview({ story, onEdit, onListen, narratedId }: { story: Story; onEdit?: (segment: StorySegment) => void; onListen?:(id:string)=>void; narratedId?:string }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}), prefix = useId();
  return <div className="space-y-3" aria-label="Timed story preview">
    {story.summary && <p className="text-sm text-white/70 whitespace-pre-wrap">{story.summary}</p>}
    {timedSegments(story).map(({ segment: s, index, start, end }) => <article key={s.id} aria-current={narratedId===s.id?"true":undefined} className={`rounded-2xl border p-4 space-y-3 ${narratedId===s.id?"border-purple-300 bg-purple-500/15":"border-purple-300/20 bg-white/[0.025]"}`}>
      <p className="text-xs text-purple-300">Scene {index + 1} · {storyTime(start)}–{storyTime(end)}</p>
      <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-semibold">{s.title || `Scene ${index + 1}`}</h3>{onListen&&<Button aria-label={`Listen to This Scene: ${s.title}`} title="Listen to this scene" onClick={()=>onListen(s.id)}>🔊</Button>}</div>
      <p className="whitespace-pre-wrap leading-relaxed">{s.narrative}</p>
      <div className="flex flex-wrap gap-2"><Button aria-expanded={!!expanded[s.id]} aria-controls={`${prefix}-${s.id}`} onClick={() => setExpanded(v => ({ ...v, [s.id]: !v[s.id] }))}>{expanded[s.id] ? "Hide Details" : "View Details"}</Button>
        {onEdit && <Button onClick={() => onEdit(s)}>Edit Scene</Button>}</div>
      {expanded[s.id] && <div id={`${prefix}-${s.id}`} className="space-y-3 border-t border-white/10 pt-3 text-sm">
        {s.shots?.length ? <div><h4>Camera coverage · {s.shots.length} shots</h4>{s.shots.map((shot,i)=><p key={shot.id} className="py-1">{i+1}. {shot.durationSeconds}s · {shot.framing} — {shot.action}</p>)}</div>:<p className="text-amber-200">Legacy or manual beat: ask the filmmaker to refine camera coverage before generating. Existing images and takes remain safe.</p>}
        <dl className="grid gap-3 sm:grid-cols-2">{[
          ["Purpose", s.purpose], ["Location", s.location], ["Time of day", s.timeOfDay], ["Lighting", s.lighting],
          ["Emotional tone", s.emotionalTone], ["Characters", s.characters.join(", ")], ["Plotline", s.plotline],
          ["Continuity", s.continuity.join("\n")], ["Music", s.music], ["Sound effects", s.soundEffects], ["Ambience", s.ambience],
          ["Camera framing", s.cameraFraming], ["Camera movement", s.cameraMovement],
        ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="font-medium text-white/70">{label}</dt><dd className="whitespace-pre-wrap">{value}</dd></div>)}</dl>
        {s.dialogue.length > 0 && <div><h4 className="font-medium">Dialogue · timing within this scene</h4>{s.dialogue.map((d, i) => <p key={i} className="mt-2"><span className="text-purple-300">{storyTime(d.startSeconds)}–{storyTime(d.endSeconds)}</span> · <strong>{d.speaker}</strong>: {d.line}{d.delivery ? ` (${d.delivery})` : ""}</p>)}</div>}
      </div>}
    </article>)}
  </div>;
}

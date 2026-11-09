"use client";
import {createContext,useContext,useEffect,type ReactNode} from "react";
import {STORY_VOICES} from "@/lib/storyCreator/speechVoices";
import {previewFromPlan} from "@/lib/productionStudio/storyPreview";
import type {useStudio} from "./useStudio";
import {useNarration} from "./useNarration";
import {Button,inputClass} from "./Controls";
const Context=createContext<ReturnType<typeof useNarration>|null>(null);
export function useTalkback(){const value=useContext(Context);if(!value)throw Error("Production narrator is unavailable");return value;}
export function TalkbackProvider({s,workspace,children}:{s:ReturnType<typeof useStudio>;workspace:string;children:ReactNode}){
  const p=s.project!,pending=[...p.assistant].reverse().find(m=>m.storySuggestion&&!m.decision),story=pending?.storySuggestion||previewFromPlan(p.plan);
  const talkback=useNarration(s.url,story,pending?.id,p.narratorVoice||"af_heart",p.assistant);
  return <Context.Provider value={talkback}>
    <div className="rounded-xl border border-white/10 p-2 space-y-2" aria-label="Production CPU narrator">
      <label className="flex flex-wrap items-center gap-2 text-sm">Narrator<select aria-label="Narrator voice" className={inputClass+" !w-auto min-w-0 flex-1"} value={p.narratorVoice||"af_heart"} disabled={!s.saved} onChange={e=>{talkback.stop();void s.commit({type:"narrator.voice",voice:e.target.value}).catch(e=>s.setError(e.message));}}>{STORY_VOICES.paradee.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
      <p className="text-xs text-white/50">Story Creator · Paradee 1.2 · CPU only</p>
      <PlaybackControls/>
      <audio ref={talkback.bindAudio} controls aria-label="Production narrator audio" className={`w-full h-10 ${talkback.hasAudio?"":"hidden"}`}/>
      {talkback.hasAudio&&<p className="text-xs text-white/50">{talkback.duration.toFixed(1)} seconds · selected passage</p>}
      {talkback.error&&<p role="alert" className="text-sm text-amber-200">{talkback.error}</p>}
    </div>
    <WorkspaceStop key={workspace}/>{children}
  </Context.Provider>;
}
function WorkspaceStop(){const{stop}=useTalkback();/* Cleanup only: navigation never starts narration. */
  // A keyed child scopes playback to the active workspace, not character voice players.
  return <StopOnUnmount stop={stop}/>;
}
function StopOnUnmount({stop}:{stop:()=>void}){useEffect(()=>()=>stop(),[stop]);return null;}
export function PlaybackControls(){const n=useTalkback();return n.status!=="idle"?<div className="flex flex-wrap items-center gap-2"><span role="status" className="text-xs">{n.status==="loading"?"Preparing Paradee CPU narration…":n.status==="ready"?"Audio ready — tap Play":n.status}</span>{n.status!=="loading"&&<Button onClick={n.togglePause}>{n.status==="playing"?"Pause":n.status==="ready"?"Play":"Resume"}</Button>}<Button onClick={n.stop}>Stop Narration</Button></div>:null;}
export function AssistantSpeech({id}:{id:string}){const n=useTalkback();return <div className="space-y-1"><Button aria-label="Listen to filmmaker response" title="Listen to this reply with your CPU narrator" onClick={()=>void n.playMessage(id)}>🔊 Listen</Button>{n.messageId===id&&<PlaybackControls/>}</div>;}

import {ROOM_PROFILES,type RoomProfile} from "./acoustics";
export type AudioFinishSettings={roomAmount:number;phoneLowHz:number;phoneHighHz:number;phoneGainDb:number;dialogueGainDb:number;targetLufs:number;sourceEffects:boolean;sources:{identity:string;roomAmount:number;gainDb:number;pan:number;roomProfile:RoomProfile|"direction"}[]};
export const DEFAULT_AUDIO_FINISH:AudioFinishSettings={roomAmount:.30,phoneLowHz:300,phoneHighHz:3400,phoneGainDb:-2,dialogueGainDb:0,targetLufs:-18,sourceEffects:true,sources:[]};
export function audioFinishSettings(value:unknown):AudioFinishSettings{
 const v={...DEFAULT_AUDIO_FINISH,...value as object};
 for(const [k,min,max]of [["roomAmount",0,.7],["phoneLowHz",150,600],["phoneHighHz",2400,5000],["phoneGainDb",-18,3],["dialogueGainDb",-6,3],["targetLufs",-24,-14]] as const){if(typeof v[k]!=="number"||!Number.isFinite(v[k])||v[k]<min||v[k]>max)throw Error("Invalid cinematic audio setting: "+k);}
 if(typeof v.sourceEffects!=="boolean")throw Error("Choose whether to process separated speech.");
 if(!Array.isArray(v.sources)||v.sources.length>30)throw Error("Invalid source adjustments.");
 const identities=new Set<string>();
 for(const s of v.sources){if(!s||typeof s.identity!=="string"||s.identity.length>200||identities.has(s.identity)||!Number.isFinite(s.roomAmount)||s.roomAmount<0||s.roomAmount>.7||!Number.isFinite(s.gainDb)||s.gainDb< -18||s.gainDb>3||!Number.isFinite(s.pan)||Math.abs(s.pan)>.35||!["direction",...ROOM_PROFILES].includes(s.roomProfile))throw Error("Invalid source adjustment.");identities.add(s.identity);}
 return Object.fromEntries(Object.keys(DEFAULT_AUDIO_FINISH).map(k=>[k,v[k as keyof AudioFinishSettings]])) as AudioFinishSettings;
}
export function selectedAudioAsset(settings:{audioSelections?:Record<string,string>}|undefined,id:string){return settings?.audioSelections?.[id]||id;}
